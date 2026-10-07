"""Slot availability endpoints."""

from datetime import date, datetime, timedelta
from ..models import localdate, utcnow  # noqa: F401

from flask import Blueprint, request

from ..auth import ApiError, login_required, ok
from ..services import availability, schedule_for, slot_minutes

bp = Blueprint("slots", __name__, url_prefix="/api/slots")


@bp.get("")
@login_required
def slots():
    raw = request.args.get("date")
    if raw:
        try:
            target = date.fromisoformat(str(raw)[:10])
        except ValueError:
            raise ApiError("'date' must be YYYY-MM-DD.", 422)
    else:
        target = localdate()

    today = localdate()
    if target < today:
        return ok({
            "date": target.isoformat(),
            "closed": True,
            "open_count": 0,
            "slots": [],
            "message": "Past dates are not bookable.",
        })
    if target > today + timedelta(days=180):
        raise ApiError("Bookings can only be made 180 days ahead.", 422)

    return ok(availability(target))


@bp.get("/calendar")
@login_required
def calendar():
    """Month overview: open-slot counts per day for the calendar picker."""
    raw = request.args.get("month")  # YYYY-MM
    today = localdate()
    try:
        start = date.fromisoformat(f"{raw}-01") if raw else today.replace(day=1)
    except ValueError:
        raise ApiError("'month' must be YYYY-MM.", 422)

    year, month = start.year, start.month
    if month == 12:
        nxt = date(year + 1, 1, 1)
    else:
        nxt = date(year, month + 1, 1)

    days = []
    cursor = start
    while cursor < nxt:
        info = availability(cursor)
        days.append({
            "date": cursor.isoformat(),
            "weekday": cursor.weekday(),
            "open_count": info["open_count"],
            "closed": info["closed"],
            "past": cursor < today,
            "is_today": cursor == today,
        })
        cursor += timedelta(days=1)
    return ok({"month": f"{year:04d}-{month:02d}", "days": days})


@bp.get("/schedule")
@login_required
def schedule():
    raw = request.args.get("date")
    try:
        target = date.fromisoformat(str(raw)[:10]) if raw else localdate()
    except ValueError:
        raise ApiError("'date' must be YYYY-MM-DD.", 422)
    return ok({
        "date": target.isoformat(),
        "windows": schedule_for(target),
        "slot_minutes": slot_minutes(),
    })
