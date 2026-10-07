"""Domain services: numbering, availability, pricing and policy helpers.

Kept separate from the routes so the same rules can be unit tested and
reused (e.g. by a future job scheduler or cloud worker).
"""

from datetime import date, datetime, timedelta
from .models import localdate, localnow, utcnow  # noqa: F401

from sqlalchemy import func

from .models import (
    ACTIVE_STATUSES,
    Booking,
    Invoice,
    Notification,
    Product,
    STATUS_CANCELLED,
    STATUS_NO_SHOW,
    User,
    db,
)


def wallclock_now():
    """Naive wall-clock time at the centre.

    ``booking_date`` + ``slot_start`` describe local appointment time, so any
    comparison against them must use local time - subtracting UTC used to make
    this morning's slots look bookable for an extra 5 1/2 hours and stretch the
    cancellation window by the same amount.
    """
    return localnow().replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Sequential numbering (gap-free per prefix, safe under a transaction)
# ---------------------------------------------------------------------------

def next_number(Model, column, prefix, width=6):
    """Return e.g. ``BK-000123`` for the next free sequence."""
    last = (
        db.session.query(func.max(getattr(Model, column)))
        .filter(getattr(Model, column).like(f"{prefix}-%"))
        .scalar()
    )
    if last:
        try:
            sequence = int(str(last).rsplit("-", 1)[-1])
        except ValueError:
            sequence = 0
    else:
        sequence = 0
    return f"{prefix}-{sequence + 1:0{width}d}"


def next_booking_no():
    return next_number(Booking, "booking_no", "BK")


def next_patient_code():
    from .models import Patient

    return next_number(Patient, "code", "PAT")


def next_invoice_no():
    return next_number(Invoice, "invoice_no", "INV")


# ---------------------------------------------------------------------------
# Slot availability engine
# ---------------------------------------------------------------------------

DEFAULT_SCHEDULE = {
    # ISO weekday: 0 = Monday ... 6 = Sunday
    "0": ["08:00-13:00", "14:00-19:00"],
    "1": ["08:00-13:00", "14:00-19:00"],
    "2": ["08:00-13:00", "14:00-19:00"],
    "3": ["08:00-13:00", "14:00-19:00"],
    "4": ["08:00-13:00", "14:00-19:00"],
    "5": ["08:00-13:00", "14:00-19:00"],
    "6": ["08:00-10:00"],
}

DEFAULT_SLOT_MINUTES = 30


def _minutes(hhmm: str) -> int:
    hours, minutes = hhmm.split(":")
    return int(hours) * 60 + int(minutes)


def _hhmm(total: int) -> str:
    return f"{total // 60:02d}:{total % 60:02d}"


def get_setting(key, default=None):
    from .models import Setting

    row = db.session.get(Setting, key)
    if row is None:
        return default
    return row.value


def schedule_for(target: date):
    import json

    raw = get_setting("working_hours")
    schedule = json.loads(raw) if raw else DEFAULT_SCHEDULE
    return schedule.get(str(target.weekday()), [])


def slot_minutes() -> int:
    raw = get_setting("slot_minutes", str(DEFAULT_SLOT_MINUTES))
    try:
        return max(10, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_SLOT_MINUTES


def generate_slots(target: date):
    """All theoretical slots for a date based on working hours."""
    step = slot_minutes()
    slots = []
    for window in schedule_for(target):
        if "-" not in window:
            continue
        start_s, end_s = window.split("-")
        start, end = _minutes(start_s), _minutes(end_s)
        cursor = start
        while cursor + step <= end:
            slots.append((_hhmm(cursor), _hhmm(cursor + step)))
            cursor += step
    return slots


def booked_slots(target: date):
    """Slots already reserved for a given date (active bookings only)."""
    rows = (
        db.session.query(Booking.slot_start, Booking.slot_end)
        .filter(
            Booking.booking_date == target,
            Booking.status.in_(ACTIVE_STATUSES),
        )
        .all()
    )
    return {(r.slot_start, r.slot_end) for r in rows}


def availability(target: date):
    """Return slot availability with per-slot state and reason."""
    now = wallclock_now()
    is_today = target == localdate()
    theoretical = generate_slots(target)
    taken = booked_slots(target)

    result = []
    for start, end in theoretical:
        start_dt = datetime.combine(target, datetime.min.time()).replace(
            hour=int(start[:2]), minute=int(start[3:])
        )
        if start_dt <= now:
            state, reason = "unavailable", "past"
        elif (start, end) in taken:
            state, reason = "booked", "occupied"
        else:
            state, reason = "open", ""
        result.append({"start": start, "end": end, "state": state, "reason": reason})

    open_count = sum(1 for s in result if s["state"] == "open")
    return {
        "date": target.isoformat(),
        "closed": not result,
        "slot_minutes": slot_minutes(),
        "open_count": open_count,
        "slots": result,
        "is_today": is_today,
    }


def slot_conflicts(target: date, start: str, end: str, exclude_booking_id=None):
    query = Booking.query.filter(
        Booking.booking_date == target,
        Booking.status.in_(ACTIVE_STATUSES),
        Booking.slot_start == start,
    )
    if exclude_booking_id:
        query = query.filter(Booking.id != exclude_booking_id)
    return query.first()


# ---------------------------------------------------------------------------
# Pricing
# ---------------------------------------------------------------------------

def price_booking(product_ids, discount=0.0):
    """Resolve products, expand packages, compute totals."""
    if not product_ids:
        raise ValueError("At least one test or package is required")

    products = Product.query.filter(
        Product.id.in_(list(set(product_ids))), Product.active.is_(True)
    ).all()
    if not products:
        raise ValueError("Selected tests are no longer available")

    lines = []
    seen = set()
    for product in products:
        targets = product.components if product.kind == "package" else [product]
        for target in targets:
            if target.id in seen:
                continue
            seen.add(target.id)
            lines.append({
                "product_id": target.id,
                "code": target.code,
                "name": target.name,
                "category": target.category,
                "price": float(target.price),
                "sample_type": target.sample_type,
                "tat_hours": target.tat_hours,
            })

    subtotal = round(sum(line["price"] for line in lines), 2)
    discount = max(0.0, min(float(discount or 0), subtotal))
    total = round(subtotal - discount, 2)
    return lines, subtotal, discount, total


# ---------------------------------------------------------------------------
# Cancellation / refund policy
# ---------------------------------------------------------------------------

def cancellation_policy(booking):
    """Decide whether a cancellation is 'early' (full refund eligible)."""
    window_hours = float(get_setting("cancellation_window_hours", "2"))
    if booking.booking_date is None or not booking.slot_start:
        return {"window_hours": window_hours, "late": False, "refundable": booking.paid_amount}

    slot_dt = datetime.combine(booking.booking_date, datetime.min.time()).replace(
        hour=int(booking.slot_start[:2]), minute=int(booking.slot_start[3:])
    )
    hours_left = (slot_dt - wallclock_now()).total_seconds() / 3600
    late = hours_left < window_hours
    refund = 0.0 if late else round(booking.paid_amount, 2)
    return {
        "window_hours": window_hours,
        "hours_before_slot": round(hours_left, 2),
        "late": late,
        "refundable": refund,
        "message": (
            f"Cancellation is within {window_hours:g}h of the slot - late fee applies."
            if late
            else "Cancelled within policy - eligible for full refund."
        ),
    }


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

def notify(title, body="", link="", level="info", role=None, user_id=None):
    db.session.add(Notification(
        title=title, body=body, link=link, level=level, role=role, user_id=user_id,
    ))


def notify_role(role_name, title, body="", link="", level="info"):
    notify(title=title, body=body, link=link, level=level, role=role_name)


# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------

def technician_pool():
    return User.query.filter(
        User.status == "active", User.role.has(name="technician")
    ).order_by(User.name).all()


def parse_date(value, field="date"):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        raise ValueError(f"'{field}' must be an ISO date (YYYY-MM-DD)")


def reminder_digest():
    """Bookings scheduled for tomorrow that are still awaiting confirmation."""
    tomorrow = localdate() + timedelta(days=1)
    return Booking.query.filter(
        Booking.booking_date == tomorrow,
        Booking.status.in_([ "PENDING", "CONFIRMED"]),
    ).count()
