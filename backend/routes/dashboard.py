"""Dashboard KPIs for the signed-in employee."""

from datetime import datetime, timedelta
from ..models import localdate, utcnow  # noqa: F401

from flask import Blueprint

from ..auth import current_user, login_required, ok
from ..models import (
    AuditLog,
    Booking,
    Notification,
    Patient,
    Payment,
    Product,
    STATUS_CANCELLED,
    STATUS_CONFIRMED,
    STATUS_NO_SHOW,
    STATUS_PENDING,
    STATUS_REPORT,
    db,
)

bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")


@bp.get("")
@login_required
def dashboard():
    user = current_user()
    today = localdate()
    tomorrow = today + timedelta(days=1)

    def count(**filters):
        return Booking.query.filter_by(**filters).count()

    # Today's schedule -----------------------------------------------------
    todays = (
        Booking.query.filter(Booking.booking_date == today)
        .order_by(Booking.slot_start)
        .limit(12)
        .all()
    )

    # Revenue trend (last 14 days) ----------------------------------------
    start = today - timedelta(days=13)
    rows = (
        db.session.query(
            db.func.date(Payment.created_at),
            db.func.coalesce(db.func.sum(Payment.amount), 0),
        )
        .filter(Payment.status == "paid",
                db.func.date(Payment.created_at) >= start)
        .group_by(db.func.date(Payment.created_at))
        .all()
    )
    revenue_map = {str(r[0]): float(r[1]) for r in rows}
    trend = []
    for offset in range(14):
        day = start + timedelta(days=offset)
        trend.append({"date": day.isoformat(),
                      "label": f"{day:%d %b}",
                      "value": round(revenue_map.get(day.isoformat(), 0.0), 2)})

    # Status mix ------------------------------------------------------------
    status_rows = (
        db.session.query(Booking.status, db.func.count(Booking.id))
        .filter(Booking.booking_date >= today - timedelta(days=30))
        .group_by(Booking.status).all()
    )
    status_mix = [{"status": s, "count": int(c)} for s, c in status_rows]

    month_start = today.replace(day=1)
    month_end = today
    month_bookings = Booking.query.filter(
        Booking.booking_date >= month_start, Booking.booking_date <= month_end
    ).count()
    month_revenue = float(
        db.session.query(db.func.coalesce(db.func.sum(Payment.amount), 0))
        .filter(Payment.status == "paid",
                db.func.date(Payment.created_at) >= month_start)
        .scalar() or 0
    )
    month_noshows = Booking.query.filter(
        Booking.status == STATUS_NO_SHOW,
        Booking.booking_date >= month_start,
    ).count()
    no_show_rate = round(100 * month_noshows / month_bookings, 1) if month_bookings else 0.0

    # Recent activity -------------------------------------------------------
    activity = (
        AuditLog.query.order_by(AuditLog.created_at.desc()).limit(8).all()
    )

    # Notifications for this user ------------------------------------------
    notes = Notification.query.filter(
        (Notification.user_id == user.id)
        | ((Notification.user_id.is_(None)) & (Notification.role == user.role_name))
    ).order_by(Notification.created_at.desc()).limit(6).all()

    return ok({
        "kpis": {
            "bookings_today": count(booking_date=today),
            "confirmed_today": count(booking_date=today, status=STATUS_CONFIRMED),
            "pending": count(status=STATUS_PENDING),
            "revenue_today": round(float(
                db.session.query(db.func.coalesce(db.func.sum(Payment.amount), 0))
                .filter(Payment.status == "paid",
                        db.func.date(Payment.created_at) == today)
                .scalar() or 0), 2),
            "revenue_month": round(month_revenue, 2),
            "bookings_month": month_bookings,
            "no_show_rate": no_show_rate,
            "tomorrow": count(booking_date=tomorrow),
            "reports_due": count(status=STATUS_REPORT),
            "patients_total": Patient.query.filter_by(active=True).count(),
            "patients_new_month": Patient.query.filter(
                Patient.created_at >= month_start).count(),
            "tests_active": Product.query.filter_by(active=True).count(),
            "cancelled_month": Booking.query.filter(
                Booking.status == STATUS_CANCELLED,
                Booking.booking_date >= month_start).count(),
        },
        "today_schedule": [b.to_dict() for b in todays],
        "revenue_trend": trend,
        "status_mix": status_mix,
        "activity": [a.to_dict() for a in activity],
        "notifications": [n.to_dict() for n in notes],
        "date": today.isoformat(),
    })
