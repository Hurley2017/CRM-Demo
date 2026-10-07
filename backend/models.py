"""SQLAlchemy models for Suraksha Diagnostic.

Designed to be database agnostic: today it runs on SQLite, tomorrow the
same models run on PostgreSQL/MySQL by swapping ``DATABASE_URL``.
"""

import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import UniqueConstraint, Index
from werkzeug.security import check_password_hash, generate_password_hash

db = SQLAlchemy()


def utcnow():
    """Timezone-naive UTC timestamp (datetime.utcnow() is deprecated).

    Timestamps are stored in UTC so the data stays portable across servers
    and daylight-saving history; use :func:`localdate` for calendar logic.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _app_timezone():
    """The centre's timezone, e.g. ``Asia/Kolkata`` (matches config.TIMEZONE)."""
    name = os.environ.get("TIMEZONE", "Asia/Kolkata")
    try:
        return ZoneInfo(name)
    except Exception:  # pragma: no cover - no tz database (bare Windows)
        # Fall back to the fixed IST offset - India observes no DST.
        return timezone(timedelta(hours=5, minutes=30), name=name)


APP_TIMEZONE = _app_timezone()


def localdate():
    """Today's calendar date as the centre's staff experience it.

    A UTC date drifts behind the local one between 00:00 and 05:30 IST, which
    would make "bookings today", slot availability and past-date validation
    disagree with the front desk's wall clock - so date logic uses this.
    """
    return datetime.now(APP_TIMEZONE).date()


def localnow():
    """Current wall-clock time at the centre (timezone aware)."""
    return datetime.now(APP_TIMEZONE)

# ---------------------------------------------------------------------------
# Booking lifecycle
# ---------------------------------------------------------------------------

STATUS_PENDING = "PENDING"
STATUS_CONFIRMED = "CONFIRMED"
STATUS_SAMPLE = "SAMPLE_COLLECTED"
STATUS_LAB = "IN_LAB"
STATUS_COMPLETED = "COMPLETED"
STATUS_REPORT = "REPORT_READY"
STATUS_CANCELLED = "CANCELLED"
STATUS_NO_SHOW = "NO_SHOW"

BOOKING_STATUSES = [
    STATUS_PENDING,
    STATUS_CONFIRMED,
    STATUS_SAMPLE,
    STATUS_LAB,
    STATUS_COMPLETED,
    STATUS_REPORT,
    STATUS_CANCELLED,
    STATUS_NO_SHOW,
]

#: Statuses that still occupy a slot in the availability engine.
ACTIVE_STATUSES = [
    STATUS_PENDING,
    STATUS_CONFIRMED,
    STATUS_SAMPLE,
    STATUS_LAB,
    STATUS_COMPLETED,
    STATUS_REPORT,
]

#: Terminal statuses can never move again.
TERMINAL_STATUSES = [STATUS_CANCELLED, STATUS_NO_SHOW, STATUS_REPORT]

#: Allowed transitions - anything not listed here is rejected with 409.
TRANSITIONS = {
    STATUS_PENDING: [STATUS_CONFIRMED, STATUS_CANCELLED, STATUS_NO_SHOW],
    STATUS_CONFIRMED: [STATUS_SAMPLE, STATUS_CANCELLED, STATUS_NO_SHOW],
    STATUS_SAMPLE: [STATUS_LAB],
    STATUS_LAB: [STATUS_COMPLETED],
    STATUS_COMPLETED: [STATUS_REPORT],
    STATUS_REPORT: [],
    STATUS_CANCELLED: [],
    STATUS_NO_SHOW: [],
}

STATUS_LABELS = {
    STATUS_PENDING: "Pending",
    STATUS_CONFIRMED: "Confirmed",
    STATUS_SAMPLE: "Sample Collected",
    STATUS_LAB: "In Lab",
    STATUS_COMPLETED: "Completed",
    STATUS_REPORT: "Report Ready",
    STATUS_CANCELLED: "Cancelled",
    STATUS_NO_SHOW: "No Show",
}

BOOKING_TYPES = {"center": "Centre Visit", "home": "Home Collection"}

GENDERS = ["male", "female", "other"]
PAYMENT_METHODS = ["cash", "card", "upi", "insurance", "bank_transfer"]
PAYMENT_STATUSES = ["paid", "refunded", "void"]


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------

ALL_PERMISSIONS = [
    "dashboard.view",
    "reports.view",
    "patients.view",
    "patients.edit",
    "products.view",
    "products.edit",
    "bookings.view",
    "bookings.create",
    "bookings.edit",
    "bookings.cancel",
    "bookings.status",
    "bookings.refund",
    "billing.view",
    "billing.pay",
    "billing.refund",
    "users.view",
    "users.manage",
    "settings.manage",
    "audit.view",
    "notifications.view",
]

ROLE_PERMISSIONS = {
    "admin": list(ALL_PERMISSIONS),
    "manager": [
        "dashboard.view",
        "reports.view",
        "patients.view",
        "patients.edit",
        "products.view",
        "products.edit",
        "bookings.view",
        "bookings.create",
        "bookings.edit",
        "bookings.cancel",
        "bookings.status",
        "bookings.refund",
        "billing.view",
        "billing.pay",
        "billing.refund",
        "users.view",
        "audit.view",
        "notifications.view",
    ],
    "receptionist": [
        "dashboard.view",
        "patients.view",
        "patients.edit",
        "products.view",
        "bookings.view",
        "bookings.create",
        "bookings.edit",
        "bookings.cancel",
        "bookings.status",
        "billing.view",
        "billing.pay",
        "notifications.view",
    ],
    "technician": [
        "dashboard.view",
        "patients.view",
        "products.view",
        "bookings.view",
        "bookings.status",
        "notifications.view",
    ],
}

ROLE_LABELS = {
    "admin": "Administrator",
    "manager": "Centre Manager",
    "receptionist": "Receptionist",
    "technician": "Lab Technician",
}


# ---------------------------------------------------------------------------
# Mixins / helpers
# ---------------------------------------------------------------------------

class TimestampMixin:
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


def _dict(model, columns=None):
    """Serialize a model to a plain dict, skipping unloaded relations."""
    data = {}
    keys = columns or [c.key for c in model.__table__.columns]
    for key in keys:
        value = getattr(model, key, None)
        if isinstance(value, datetime):
            value = value.isoformat(sep=" ", timespec="seconds")
        data[key] = value
    return data


# ---------------------------------------------------------------------------
# Identity & access
# ---------------------------------------------------------------------------

class Role(db.Model):
    __tablename__ = "roles"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(40), unique=True, nullable=False)
    label = db.Column(db.String(80), nullable=False)
    description = db.Column(db.String(255), default="")

    users = db.relationship("User", back_populates="role", lazy="selectin")

    @property
    def permissions(self):
        return list(ROLE_PERMISSIONS.get(self.name, []))

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "permissions": self.permissions,
        }


class User(db.Model, TimestampMixin):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.String(20), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(160), unique=True, nullable=False)
    phone = db.Column(db.String(20), default="")
    password_hash = db.Column(db.String(300), nullable=False)
    role_id = db.Column(db.Integer, db.ForeignKey("roles.id"), nullable=False)
    status = db.Column(db.String(20), default="active", nullable=False)
    designation = db.Column(db.String(80), default="")
    last_login_at = db.Column(db.DateTime, nullable=True)
    failed_attempts = db.Column(db.Integer, default=0, nullable=False)
    locked_until = db.Column(db.DateTime, nullable=True)

    role = db.relationship("Role", back_populates="users", lazy="joined")

    # -- password helpers ---------------------------------------------------
    def set_password(self, raw_password: str) -> None:
        self.password_hash = generate_password_hash(raw_password)
        self.failed_attempts = 0
        self.locked_until = None

    def check_password(self, raw_password: str) -> bool:
        return check_password_hash(self.password_hash, raw_password)

    def is_locked(self) -> bool:
        return bool(self.locked_until and self.locked_until > utcnow())

    @property
    def permissions(self):
        return list(ROLE_PERMISSIONS.get(self.role.name, [])) if self.role else []

    @property
    def role_name(self):
        return self.role.name if self.role else "technician"

    def to_dict(self):
        return {
            "id": self.id,
            "employee_id": self.employee_id,
            "name": self.name,
            "email": self.email,
            "phone": self.phone,
            "designation": self.designation,
            "status": self.status,
            "role": self.role.to_dict() if self.role else None,
            "last_login_at": _fmt(self.last_login_at),
            "created_at": _fmt(self.created_at),
        }


def _fmt(value):
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    return value


# ---------------------------------------------------------------------------
# Clinical catalogue
# ---------------------------------------------------------------------------

class Patient(db.Model, TimestampMixin):
    __tablename__ = "patients"

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), unique=True, nullable=False, index=True)
    name = db.Column(db.String(140), nullable=False, index=True)
    phone = db.Column(db.String(20), index=True)
    email = db.Column(db.String(160), default="")
    dob = db.Column(db.Date, nullable=True)
    gender = db.Column(db.String(10), default="other")
    address = db.Column(db.String(255), default="")
    city = db.Column(db.String(80), default="")
    blood_group = db.Column(db.String(8), default="")
    allergies = db.Column(db.String(255), default="")
    notes = db.Column(db.Text, default="")
    active = db.Column(db.Boolean, default=True, nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    creator = db.relationship("User", foreign_keys=[created_by])
    bookings = db.relationship(
        "Booking", back_populates="patient", order_by="Booking.booking_date.desc()",
        cascade="all, delete-orphan", passive_deletes=True,
    )

    @property
    def age(self):
        if not self.dob:
            return None
        today = localdate()
        return today.year - self.dob.year - (
            (today.month, today.day) < (self.dob.month, self.dob.day)
        )

    @property
    def total_bookings(self):
        return len(self.bookings)

    @property
    def last_visit(self):
        dates = [b.booking_date for b in self.bookings if b.booking_date]
        return max(dates).isoformat() if dates else None

    def to_dict(self):
        data = _dict(self, [
            "id", "code", "name", "phone", "email", "gender",
            "address", "city", "blood_group", "allergies", "notes", "active",
        ])
        data["dob"] = self.dob.isoformat() if self.dob else None
        data["age"] = self.age
        data["total_bookings"] = self.total_bookings
        data["last_visit"] = self.last_visit
        data["created_at"] = _fmt(self.created_at)
        return data


class Product(db.Model, TimestampMixin):
    """A diagnostic test, health package or add-on service."""

    __tablename__ = "products"

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(24), unique=True, nullable=False, index=True)
    name = db.Column(db.String(160), nullable=False, index=True)
    category = db.Column(db.String(80), nullable=False, index=True)
    kind = db.Column(db.String(16), default="test", nullable=False)  # test|package|addon
    price = db.Column(db.Float, default=0, nullable=False)
    cost = db.Column(db.Float, default=0, nullable=False)
    sample_type = db.Column(db.String(60), default="")
    tat_hours = db.Column(db.Integer, default=24)  # turnaround time
    prep_instructions = db.Column(db.Text, default="")
    description = db.Column(db.Text, default="")
    active = db.Column(db.Boolean, default=True, nullable=False)

    components = db.relationship(
        "Product", secondary="package_items",
        primaryjoin="Product.id==PackageItem.package_id",
        secondaryjoin="Product.id==PackageItem.test_id",
        lazy="selectin",
    )

    @property
    def margin(self):
        return round(self.price - self.cost, 2)

    def to_dict(self):
        data = _dict(self, [
            "id", "code", "name", "category", "kind", "price", "cost",
            "sample_type", "tat_hours", "prep_instructions", "description", "active",
        ])
        data["margin"] = self.margin
        data["components"] = [
            {"id": c.id, "code": c.code, "name": c.name, "price": c.price}
            for c in self.components
        ]
        return data


class PackageItem(db.Model):
    __tablename__ = "package_items"
    __table_args__ = (UniqueConstraint("package_id", "test_id", name="uq_pkg_test"),)

    id = db.Column(db.Integer, primary_key=True)
    package_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=False)
    test_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=False)


# ---------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------

class Booking(db.Model, TimestampMixin):
    __tablename__ = "bookings"
    __table_args__ = (
        Index("ix_bookings_date_slot", "booking_date", "slot_start"),
        Index("ix_bookings_status_date", "status", "booking_date"),
    )

    id = db.Column(db.Integer, primary_key=True)
    booking_no = db.Column(db.String(24), unique=True, nullable=False, index=True)
    patient_id = db.Column(db.Integer, db.ForeignKey("patients.id"), nullable=False)
    booking_date = db.Column(db.Date, nullable=False, index=True)
    slot_start = db.Column(db.String(5), nullable=False)  # "09:30"
    slot_end = db.Column(db.String(5), nullable=False)
    booking_type = db.Column(db.String(10), default="center", nullable=False)
    address = db.Column(db.String(255), default="")
    phone = db.Column(db.String(20), default="")
    phlebotomist_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    priority = db.Column(db.String(10), default="routine", nullable=False)
    status = db.Column(db.String(24), default=STATUS_PENDING, nullable=False, index=True)
    subtotal = db.Column(db.Float, default=0, nullable=False)
    discount = db.Column(db.Float, default=0, nullable=False)
    total = db.Column(db.Float, default=0, nullable=False)
    paid_amount = db.Column(db.Float, default=0, nullable=False)
    notes = db.Column(db.Text, default="")
    cancel_reason = db.Column(db.String(255), default="")
    cancelled_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    cancelled_at = db.Column(db.DateTime, nullable=True)
    followup_of_id = db.Column(db.Integer, db.ForeignKey("bookings.id"), nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    patient = db.relationship("Patient", back_populates="bookings", lazy="joined")
    phlebotomist = db.relationship("User", foreign_keys=[phlebotomist_id])
    canceller = db.relationship("User", foreign_keys=[cancelled_by])
    creator = db.relationship("User", foreign_keys=[created_by])
    followup_of = db.relationship("Booking", remote_side=[id])
    items = db.relationship(
        "BookingItem", back_populates="booking", cascade="all, delete-orphan",
        order_by="BookingItem.id",
    )
    history = db.relationship(
        "BookingStatusHistory", back_populates="booking",
        order_by="BookingStatusHistory.created_at.desc()",
        cascade="all, delete-orphan",
    )
    invoice = db.relationship("Invoice", back_populates="booking", uselist=False)

    @property
    def status_label(self):
        return STATUS_LABELS.get(self.status, self.status)

    @property
    def type_label(self):
        return BOOKING_TYPES.get(self.booking_type, self.booking_type)

    def to_dict(self, detail=False):
        data = {
            "id": self.id,
            "booking_no": self.booking_no,
            "booking_date": self.booking_date.isoformat() if self.booking_date else None,
            "slot_start": self.slot_start,
            "slot_end": self.slot_end,
            "booking_type": self.booking_type,
            "type_label": self.type_label,
            "address": self.address,
            "phone": self.phone,
            "priority": self.priority,
            "status": self.status,
            "status_label": self.status_label,
            "subtotal": self.subtotal,
            "discount": self.discount,
            "total": self.total,
            "paid_amount": self.paid_amount,
            "due": round(self.total - self.paid_amount, 2),
            "notes": self.notes,
            "cancel_reason": self.cancel_reason,
            "cancelled_at": _fmt(self.cancelled_at),
            "followup_of_id": self.followup_of_id,
            "created_at": _fmt(self.created_at),
            "patient": self.patient.to_dict() if self.patient else None,
            "phlebotomist": self.phlebotomist.name if self.phlebotomist else None,
            "created_by": self.creator.name if self.creator else None,
            "items": [i.to_dict() for i in self.items],
        }
        if detail:
            data["history"] = [h.to_dict() for h in self.history]
            data["invoice"] = self.invoice.to_dict() if self.invoice else None
        return data


class BookingItem(db.Model):
    __tablename__ = "booking_items"

    id = db.Column(db.Integer, primary_key=True)
    booking_id = db.Column(
        db.Integer, db.ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False
    )
    product_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=True)
    code = db.Column(db.String(24), default="")
    name = db.Column(db.String(160), nullable=False)
    category = db.Column(db.String(80), default="")
    price = db.Column(db.Float, default=0, nullable=False)
    sample_type = db.Column(db.String(60), default="")
    tat_hours = db.Column(db.Integer, default=24)
    item_status = db.Column(db.String(24), default="pending", nullable=False)

    booking = db.relationship("Booking", back_populates="items")
    product = db.relationship("Product")

    def to_dict(self):
        return _dict(self, [
            "id", "booking_id", "product_id", "code", "name", "category",
            "price", "sample_type", "tat_hours", "item_status",
        ])


class BookingStatusHistory(db.Model):
    __tablename__ = "booking_status_history"

    id = db.Column(db.Integer, primary_key=True)
    booking_id = db.Column(
        db.Integer, db.ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False
    )
    from_status = db.Column(db.String(24), default="")
    to_status = db.Column(db.String(24), nullable=False)
    reason = db.Column(db.String(255), default="")
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    booking = db.relationship("Booking", back_populates="history")
    user = db.relationship("User")

    def to_dict(self):
        return {
            "id": self.id,
            "booking_id": self.booking_id,
            "from_status": self.from_status,
            "to_status": self.to_status,
            "status_label": STATUS_LABELS.get(self.to_status, self.to_status),
            "reason": self.reason,
            "user": self.user.name if self.user else "System",
            "created_at": _fmt(self.created_at),
        }


# ---------------------------------------------------------------------------
# Billing
# ---------------------------------------------------------------------------

class Invoice(db.Model, TimestampMixin):
    __tablename__ = "invoices"

    id = db.Column(db.Integer, primary_key=True)
    invoice_no = db.Column(db.String(24), unique=True, nullable=False, index=True)
    booking_id = db.Column(
        db.Integer, db.ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False
    )
    patient_id = db.Column(db.Integer, db.ForeignKey("patients.id"), nullable=False)
    subtotal = db.Column(db.Float, default=0, nullable=False)
    discount = db.Column(db.Float, default=0, nullable=False)
    total = db.Column(db.Float, default=0, nullable=False)
    paid_amount = db.Column(db.Float, default=0, nullable=False)
    status = db.Column(db.String(16), default="unpaid", nullable=False)

    booking = db.relationship("Booking", back_populates="invoice")
    patient = db.relationship("Patient")
    payments = db.relationship(
        "Payment", back_populates="invoice", cascade="all, delete-orphan",
        order_by="Payment.created_at.desc()",
    )

    def sync(self):
        paid = sum(p.amount for p in self.payments if p.status == "paid")
        refunded = sum(p.amount for p in self.payments if p.status == "refunded")
        self.paid_amount = round(max(0.0, paid - refunded), 2)
        if refunded > 0 and self.paid_amount <= 0:
            self.status = "refunded"
        elif self.paid_amount <= 0:
            self.status = "unpaid"
        elif self.paid_amount + 0.01 >= self.total:
            self.status = "paid"
        else:
            self.status = "partial"
        if self.booking:
            self.booking.paid_amount = self.paid_amount

    def to_dict(self):
        data = _dict(self, [
            "id", "invoice_no", "booking_id", "patient_id",
            "subtotal", "discount", "total", "paid_amount", "status",
        ])
        data["due"] = round(self.total - self.paid_amount, 2)
        data["payments"] = [p.to_dict() for p in self.payments]
        data["booking_no"] = self.booking.booking_no if self.booking else None
        data["patient_name"] = self.patient.name if self.patient else None
        data["patient_phone"] = self.patient.phone if self.patient else None
        data["updated_at"] = _fmt(self.updated_at)
        return data


class Payment(db.Model, TimestampMixin):
    __tablename__ = "payments"

    id = db.Column(db.Integer, primary_key=True)
    invoice_id = db.Column(
        db.Integer, db.ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False
    )
    booking_id = db.Column(db.Integer, db.ForeignKey("bookings.id"), nullable=True)
    amount = db.Column(db.Float, nullable=False)
    method = db.Column(db.String(20), default="cash", nullable=False)
    reference = db.Column(db.String(80), default="")
    status = db.Column(db.String(16), default="paid", nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    invoice = db.relationship("Invoice", back_populates="payments")
    user = db.relationship("User")

    def to_dict(self):
        return {
            "id": self.id,
            "invoice_id": self.invoice_id,
            "booking_id": self.booking_id,
            "amount": self.amount,
            "method": self.method,
            "reference": self.reference,
            "status": self.status,
            "received_by": self.user.name if self.user else None,
            "created_at": _fmt(self.created_at),
        }


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

class Notification(db.Model):
    __tablename__ = "notifications"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    role = db.Column(db.String(24), nullable=True)  # broadcast to a role
    title = db.Column(db.String(160), nullable=False)
    body = db.Column(db.String(255), default="")
    link = db.Column(db.String(120), default="")
    level = db.Column(db.String(12), default="info")
    is_read = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    user = db.relationship("User")

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "body": self.body,
            "link": self.link,
            "level": self.level,
            "is_read": self.is_read,
            "created_at": _fmt(self.created_at),
        }


class AuditLog(db.Model):
    __tablename__ = "audit_logs"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    action = db.Column(db.String(40), nullable=False, index=True)
    entity = db.Column(db.String(40), default="", index=True)
    entity_id = db.Column(db.String(40), default="")
    detail = db.Column(db.Text, default="")
    ip = db.Column(db.String(45), default="")
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False, index=True)

    user = db.relationship("User")

    def to_dict(self):
        return {
            "id": self.id,
            "action": self.action,
            "entity": self.entity,
            "entity_id": self.entity_id,
            "detail": self.detail,
            "user": self.user.name if self.user else "System",
            "employee_id": self.user.employee_id if self.user else "",
            "ip": self.ip,
            "created_at": _fmt(self.created_at),
        }


class Setting(db.Model):
    __tablename__ = "settings"

    key = db.Column(db.String(60), primary_key=True)
    value = db.Column(db.Text, nullable=False)
    label = db.Column(db.String(120), default="")
    group = db.Column(db.String(40), default="general")

    def to_dict(self):
        return {
            "key": self.key,
            "value": self.value,
            "label": self.label,
            "group": self.group,
        }
