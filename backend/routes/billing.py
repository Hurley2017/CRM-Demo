"""Invoices, payments and refunds."""

from datetime import datetime
from ..models import localdate, utcnow  # noqa: F401

from flask import Blueprint, request

from ..auth import ApiError, audit, body, current_user, login_required, ok, paginated, perm_required
from ..models import PAYMENT_METHODS, Invoice, Payment, STATUS_CANCELLED, db
from ..services import notify

bp = Blueprint("billing", __name__, url_prefix="/api/billing")


def _query():
    q = Invoice.query
    status = request.args.get("status")
    if status and status != "all":
        q = q.filter(Invoice.status == status)
    search = (request.args.get("q") or "").strip()
    if search:
        like = f"%{search}%"
        from ..models import Patient

        q = q.join(Patient, Invoice.patient_id == Patient.id, isouter=True).filter(
            Invoice.invoice_no.ilike(like) | Patient.name.ilike(like)
            | Patient.phone.ilike(like)
        )
    return q.order_by(Invoice.created_at.desc())


@bp.get("/invoices")
@perm_required("billing.view")
def list_invoices():
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, int(request.args.get("per_page", 20)))
    q = _query()
    total = q.count()
    rows = q.offset((page - 1) * per_page).limit(per_page).all()

    unpaid = Invoice.query.filter(Invoice.status.in_(("unpaid", "partial"))).count()
    return paginated([i.to_dict() for i in rows], page, per_page, total,
                     extra={"unpaid_count": unpaid})


@bp.get("/invoices/<int:invoice_id>")
@perm_required("billing.view")
def get_invoice(invoice_id):
    invoice = db.session.get(Invoice, invoice_id)
    if invoice is None:
        raise ApiError("Invoice not found.", 404)
    return ok(invoice.to_dict())


@bp.post("/payments")
@perm_required("billing.pay")
def create_payment():
    data = body()
    invoice = db.session.get(Invoice, int(data.get("invoice_id") or 0))
    if invoice is None:
        raise ApiError("Invoice not found.", 422, field="invoice_id")

    method = (data.get("method") or "cash").lower()
    if method not in PAYMENT_METHODS:
        raise ApiError("Unsupported payment method.", 422, field="method")

    try:
        amount = round(float(data.get("amount")), 2)
    except (TypeError, ValueError):
        raise ApiError("Amount must be a number.", 422, field="amount")

    if amount <= 0:
        raise ApiError("Amount must be greater than zero.", 422, field="amount")
    if amount - 0.01 > (invoice.total - invoice.paid_amount):
        raise ApiError(
            f"Amount exceeds the outstanding balance of "
            f"{invoice.total - invoice.paid_amount:,.2f}.",
            422, field="amount",
        )

    payment = Payment(
        invoice_id=invoice.id,
        booking_id=invoice.booking_id,
        amount=amount,
        method=method,
        reference=(data.get("reference") or "").strip(),
        status="paid",
        user_id=current_user().id,
    )
    db.session.add(payment)
    db.session.flush()
    invoice.sync()
    db.session.commit()

    audit("payment_received", "invoice", invoice.id,
          {"invoice_no": invoice.invoice_no, "amount": amount, "method": method})
    return ok(invoice.to_dict(),
              message=f"Payment of {amount:,.2f} recorded ({method}).", status=201)


def record_refund(invoice, amount, reason, user):
    """Record a refund payment. Returns the refunded amount.

    Called from the booking cancel flow as well as the billing screen.
    """
    refundable = round(invoice.paid_amount, 2)
    amount = round(min(max(0.0, float(amount)), refundable), 2)
    if amount <= 0:
        return 0.0

    payment = Payment(
        invoice_id=invoice.id,
        booking_id=invoice.booking_id,
        amount=amount,
        method="refund",
        reference=reason or "Refund",
        status="refunded",
        user_id=user.id if user else None,
    )
    db.session.add(payment)
    db.session.flush()
    invoice.sync()
    return amount


@bp.post("/invoices/<int:invoice_id>/refund")
@perm_required("billing.refund")
def refund(invoice_id):
    invoice = db.session.get(Invoice, invoice_id)
    if invoice is None:
        raise ApiError("Invoice not found.", 404)
    if invoice.paid_amount <= 0:
        raise ApiError("Nothing has been paid on this invoice.", 409)

    data = body()
    reason = (data.get("reason") or "").strip()
    if len(reason) < 3:
        raise ApiError("A refund reason is required.", 422, field="reason")
    try:
        amount = round(float(data.get("amount", invoice.paid_amount)), 2)
    except (TypeError, ValueError):
        raise ApiError("Amount must be a number.", 422)

    refunded = record_refund(invoice, amount, reason, current_user())
    if refunded <= 0:
        raise ApiError("Refund amount must be greater than zero.", 422)

    # queued before the commit so it is persisted with the refund
    notify(title=f"Refund issued {invoice.invoice_no}",
           body=f"{refunded:,.2f} - {reason}", level="warning",
           user_id=current_user().id)
    db.session.commit()
    audit("refund_issued", "invoice", invoice.id,
          {"invoice_no": invoice.invoice_no, "amount": refunded, "reason": reason})
    return ok(invoice.to_dict(), message=f"Refund of {refunded:,.2f} recorded.")


@bp.get("/summary")
@perm_required("billing.view")
def summary():
    """Outstanding balances and today's collection."""
    today = localdate()
    from ..models import Booking

    collected_today = float(
        db.session.query(db.func.coalesce(db.func.sum(Payment.amount), 0))
        .filter(Payment.status == "paid",
                db.func.date(Payment.created_at) == today)
        .scalar() or 0
    )
    outstanding = float(
        db.session.query(
            db.func.coalesce(db.func.sum(Invoice.total - Invoice.paid_amount), 0)
        )
        .filter(Invoice.status.in_(("unpaid", "partial"))).scalar() or 0
    )
    refunded_month = float(
        db.session.query(db.func.coalesce(db.func.sum(Payment.amount), 0))
        .filter(Payment.status == "refunded",
                db.extract("month", Payment.created_at) == today.month,
                db.extract("year", Payment.created_at) == today.year)
        .scalar() or 0
    )
    return ok({
        "collected_today": round(collected_today, 2),
        "outstanding": round(outstanding, 2),
        "refunded_this_month": round(refunded_month, 2),
        "unpaid_invoices": Invoice.query.filter(
            Invoice.status.in_(("unpaid", "partial"))).count(),
        "cancelled_today": Booking.query.filter(
            Booking.status == STATUS_CANCELLED,
            db.func.date(Booking.cancelled_at) == today).count(),
    })
