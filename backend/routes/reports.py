"""Operational reports and CSV exports."""

import csv
import io
from datetime import datetime, timedelta
from ..models import localdate, utcnow  # noqa: F401

from flask import Blueprint, Response, request

from ..auth import ApiError, perm_required, ok
from ..models import (
    Booking,
    Payment,
    Product,
    STATUS_CANCELLED,
    STATUS_NO_SHOW,
    db,
)

bp = Blueprint("reports", __name__, url_prefix="/api/reports")


def _range():
    today = localdate()
    raw_from = request.args.get("from")
    raw_to = request.args.get("to")
    period = request.args.get("period", "30d")

    if raw_from and raw_to:
        try:
            start = datetime.fromisoformat(raw_from[:10]).date()
            end = datetime.fromisoformat(raw_to[:10]).date()
        except ValueError:
            raise ApiError("Dates must be YYYY-MM-DD.", 422)
    else:
        days = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}.get(period, 30)
        end = today
        start = today - timedelta(days=days - 1)
    if start > end:
        raise ApiError("'from' must be before 'to'.", 422)
    return start, end


@bp.get("/overview")
@perm_required("reports.view")
def overview():
    start, end = _range()
    bookings = Booking.query.filter(
        Booking.booking_date >= start, Booking.booking_date <= end
    )
    total_bookings = bookings.count()
    by_status = dict(
        db.session.query(Booking.status, db.func.count(Booking.id))
        .filter(Booking.booking_date >= start, Booking.booking_date <= end)
        .group_by(Booking.status).all()
    )
    revenue = float(
        db.session.query(db.func.coalesce(db.func.sum(Payment.amount), 0))
        .filter(Payment.status == "paid",
                db.func.date(Payment.created_at) >= start,
                db.func.date(Payment.created_at) <= end)
        .scalar() or 0
    )
    refunds = float(
        db.session.query(db.func.coalesce(db.func.sum(Payment.amount), 0))
        .filter(Payment.status == "refunded",
                db.func.date(Payment.created_at) >= start,
                db.func.date(Payment.created_at) <= end)
        .scalar() or 0
    )
    cancelled = int(by_status.get(STATUS_CANCELLED, 0))
    noshows = int(by_status.get(STATUS_NO_SHOW, 0))
    completed = int(by_status.get("COMPLETED", 0) + by_status.get("REPORT_READY", 0))

    # Daily series
    rows = (
        db.session.query(
            db.func.date(Booking.booking_date),
            db.func.count(Booking.id),
            db.func.coalesce(db.func.sum(Booking.total), 0),
        )
        .filter(Booking.booking_date >= start, Booking.booking_date <= end,
                Booking.status.notin_((STATUS_CANCELLED, STATUS_NO_SHOW)))
        .group_by(db.func.date(Booking.booking_date))
        .order_by(db.func.date(Booking.booking_date))
        .all()
    )
    series = []
    cursor = start
    lookup = {str(r[0]): (int(r[1]), float(r[2])) for r in rows}
    while cursor <= end:
        count, amount = lookup.get(cursor.isoformat(), (0, 0.0))
        series.append({"date": cursor.isoformat(), "label": f"{cursor:%d %b}",
                       "bookings": count, "revenue": round(amount, 2)})
        cursor += timedelta(days=1)

    return ok({
        "from": start.isoformat(),
        "to": end.isoformat(),
        "bookings": total_bookings,
        "completed": completed,
        "cancelled": cancelled,
        "no_shows": noshows,
        "no_show_rate": round(100 * noshows / total_bookings, 1) if total_bookings else 0,
        "revenue": round(revenue, 2),
        "refunds": round(refunds, 2),
        "net": round(revenue - refunds, 2),
        "avg_ticket": round(revenue / total_bookings, 2) if total_bookings else 0,
        "series": series,
        "by_status": [{"status": s, "count": int(c)} for s, c in by_status.items()],
    })


@bp.get("/top-tests")
@perm_required("reports.view")
def top_tests():
    start, end = _range()
    return ok(_top_tests(start, end))


def _top_tests(start, end):
    from ..models import BookingItem

    rows = (
        db.session.query(
            BookingItem.name,
            BookingItem.category,
            db.func.count(BookingItem.id).label("orders"),
        )
        .join(Booking, Booking.id == BookingItem.booking_id)
        .filter(
            Booking.booking_date >= start,
            Booking.booking_date <= end,
            Booking.status.notin_((STATUS_CANCELLED, STATUS_NO_SHOW)),
        )
        .group_by(BookingItem.name, BookingItem.category)
        .order_by(db.func.count(BookingItem.id).desc())
        .limit(12)
        .all()
    )
    return [{"name": r[0], "category": r[1], "orders": int(r[2])} for r in rows]


@bp.get("/category-mix")
@perm_required("reports.view")
def category_mix():
    start, end = _range()
    from ..models import BookingItem

    rows = (
        db.session.query(
            BookingItem.category,
            db.func.count(BookingItem.id),
            db.func.coalesce(db.func.sum(BookingItem.price), 0),
        )
        .join(Booking, Booking.id == BookingItem.booking_id)
        .filter(Booking.booking_date >= start, Booking.booking_date <= end,
                Booking.status.notin_((STATUS_CANCELLED, STATUS_NO_SHOW)))
        .group_by(BookingItem.category)
        .order_by(db.func.sum(BookingItem.price).desc())
        .all()
    )
    return ok([{"category": r[0] or "Uncategorised", "orders": int(r[1]),
                "revenue": round(float(r[2]), 2)} for r in rows])


@bp.get("/staff")
@perm_required("reports.view")
def staff_performance():
    start, end = _range()
    from ..models import User

    rows = (
        db.session.query(
            User.name, User.employee_id,
            db.func.count(Booking.id),
            db.func.coalesce(db.func.sum(Booking.total), 0),
        )
        .join(User, User.id == Booking.created_by, isouter=True)
        .filter(Booking.booking_date >= start, Booking.booking_date <= end)
        .group_by(User.name, User.employee_id)
        .order_by(db.func.count(Booking.id).desc())
        .all()
    )
    return ok([{"name": r[0] or "System", "employee_id": r[1] or "",
                "bookings": int(r[2]), "revenue": round(float(r[3]), 2)}
               for r in rows])


@bp.get("/export")
@perm_required("reports.view")
def export_csv():
    """CSV export of bookings in the selected range."""
    start, end = _range()
    rows = (
        Booking.query
        .filter(Booking.booking_date >= start, Booking.booking_date <= end)
        .order_by(Booking.booking_date, Booking.slot_start)
        .limit(5000)
        .all()
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "Booking No", "Date", "Time", "Patient", "Phone", "Type",
        "Status", "Priority", "Items", "Subtotal", "Discount", "Total", "Paid",
    ])
    for b in rows:
        writer.writerow([
            b.booking_no, b.booking_date.isoformat(), b.slot_start,
            b.patient.name if b.patient else "", b.phone, b.type_label,
            b.status_label, b.priority, "; ".join(i.name for i in b.items),
            f"{b.subtotal:.2f}", f"{b.discount:.2f}", f"{b.total:.2f}",
            f"{b.paid_amount:.2f}",
        ])
    buffer.seek(0)
    filename = f"suraksha-bookings-{start}-{end}.csv"
    return Response(
        buffer.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
