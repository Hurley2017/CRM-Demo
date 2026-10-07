"""Settings, audit trail, notifications and global search (admin areas)."""

import json

from flask import Blueprint, request

from ..auth import ApiError, audit, body, current_user, login_required, ok, paginated, perm_required
from ..models import AuditLog, Notification, Patient, Product, Setting, Booking, User, db

bp = Blueprint("admin", __name__, url_prefix="/api")


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

SETTING_DEFINITIONS = [
    {"key": "center_name", "label": "Centre name", "group": "general",
     "value": "Suraksha Diagnostic", "type": "text"},
    {"key": "center_address", "label": "Centre address", "group": "general",
     "value": "214, Lakeview Road, Kolkata 700029", "type": "text"},
    {"key": "center_phone", "label": "Contact number", "group": "general",
     "value": "+91 33 4000 1200", "type": "text"},
    {"key": "currency", "label": "Currency symbol", "group": "general",
     "value": "₹", "type": "text"},
    {"key": "cancellation_window_hours", "label": "Free cancellation window (hours before slot)",
     "group": "booking", "value": "2", "type": "number"},
    {"key": "slot_minutes", "label": "Slot duration (minutes)", "group": "booking",
     "value": "30", "type": "number"},
    {"key": "booking_horizon_days", "label": "Bookings open this many days ahead",
     "group": "booking", "value": "180", "type": "number"},
    {"key": "working_hours", "label": "Working hours (JSON: weekday -> windows)",
     "group": "schedule",
     "value": json.dumps({
         "0": ["08:00-13:00", "14:00-19:00"], "1": ["08:00-13:00", "14:00-19:00"],
         "2": ["08:00-13:00", "14:00-19:00"], "3": ["08:00-13:00", "14:00-19:00"],
         "4": ["08:00-13:00", "14:00-19:00"], "5": ["08:00-13:00", "14:00-19:00"],
         "6": ["08:00-10:00"],
     }),
     "type": "json"},
    {"key": "report_ready_tat_alert", "label": "Alert when TAT exceeds (hours)",
     "group": "operations", "value": "48", "type": "number"},
]


@bp.get("/settings")
@perm_required("settings.manage", "dashboard.view", any_of=True)
def get_settings():
    stored = {s.key: s.value for s in Setting.query.all()}
    out = []
    for definition in SETTING_DEFINITIONS:
        item = dict(definition)
        item["value"] = stored.get(definition["key"], definition["value"])
        out.append(item)
    return ok(out)


@bp.put("/settings")
@perm_required("settings.manage")
def update_settings():
    data = body()
    changes = {}
    for definition in SETTING_DEFINITIONS:
        key = definition["key"]
        if key not in data:
            continue
        value = str(data[key]).strip()
        if definition["type"] == "number":
            try:
                float(value)
            except ValueError:
                raise ApiError(f"{definition['label']} must be a number.", 422, field=key)
        if definition["type"] == "json":
            try:
                json.loads(value)
            except ValueError:
                raise ApiError(f"{definition['label']} must be valid JSON.", 422, field=key)
        row = db.session.get(Setting, key)
        if row is None:
            row = Setting(key=key, label=definition["label"], group=definition["group"])
            db.session.add(row)
        if row.value != value:
            changes[key] = {"from": row.value, "to": value}
        row.value = value

    db.session.commit()
    if changes:
        audit("settings_updated", "settings", "", changes)
    return ok(message="Settings saved." if changes else "No changes to save.")


# ---------------------------------------------------------------------------
# Audit trail
# ---------------------------------------------------------------------------

@bp.get("/audit")
@perm_required("audit.view")
def audit_logs():
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, int(request.args.get("per_page", 25)))
    q = AuditLog.query
    action = request.args.get("action")
    if action:
        q = q.filter(AuditLog.action == action)
    search = (request.args.get("q") or "").strip()
    if search:
        like = f"%{search}%"
        q = q.outerjoin(User, AuditLog.user_id == User.id).filter(
            AuditLog.detail.ilike(like)
            | AuditLog.action.ilike(like)
            | User.name.ilike(like)
            | User.employee_id.ilike(like)
        )
    q = q.order_by(AuditLog.created_at.desc())
    total = q.count()
    rows = q.offset((page - 1) * per_page).limit(per_page).all()

    actions = [r[0] for r in db.session.query(AuditLog.action).distinct().order_by(AuditLog.action)]
    return paginated([r.to_dict() for r in rows], page, per_page, total,
                     extra={"actions": actions})


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

@bp.get("/notifications")
@login_required
def notifications():
    user = current_user()
    q = Notification.query.filter(
        (Notification.user_id == user.id)
        | ((Notification.user_id.is_(None)) & (Notification.role == user.role_name))
    )
    unread = q.filter(Notification.is_read.is_(False)).count()
    rows = q.order_by(Notification.created_at.desc()).limit(20).all()
    return ok({"items": [n.to_dict() for n in rows], "unread": unread})


@bp.post("/notifications/read-all")
@login_required
def read_all():
    user = current_user()
    Notification.query.filter(
        (Notification.user_id == user.id)
        | ((Notification.user_id.is_(None)) & (Notification.role == user.role_name))
    ).update({"is_read": True}, synchronize_session=False)
    db.session.commit()
    return ok(message="All notifications marked read.")


@bp.post("/notifications/<int:note_id>/read")
@login_required
def read_one(note_id):
    note = db.session.get(Notification, note_id)
    if note is not None:
        note.is_read = True
        db.session.commit()
    return ok()


# ---------------------------------------------------------------------------
# Global search (top-bar command palette)
# ---------------------------------------------------------------------------

@bp.get("/search")
@login_required
def global_search():
    query = (request.args.get("q") or "").strip()
    if len(query) < 2:
        return ok({"patients": [], "bookings": [], "products": []})
    like = f"%{query}%"

    user = current_user()
    perms = set(user.permissions)

    patients = []
    if "patients.view" in perms:
        patients = [p.to_dict() for p in Patient.query.filter(
            Patient.name.ilike(like) | Patient.phone.ilike(like) | Patient.code.ilike(like)
        ).limit(5).all()]

    bookings = []
    if "bookings.view" in perms:
        from ..models import Patient as P

        bookings = [b.to_dict() for b in Booking.query.join(
            P, Booking.patient_id == P.id, isouter=True
        ).filter(
            Booking.booking_no.ilike(like) | P.name.ilike(like) | P.phone.ilike(like)
        ).order_by(Booking.booking_date.desc()).limit(5).all()]

    products = []
    if "products.view" in perms:
        products = [p.to_dict() for p in Product.query.filter(
            Product.name.ilike(like) | Product.code.ilike(like)
        ).limit(5).all()]

    return ok({"patients": patients, "bookings": bookings, "products": products})
