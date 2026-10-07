"""Booking lifecycle: create, modify, reschedule, cancel, status flow."""

from datetime import date, datetime
from ..models import localdate, utcnow  # noqa: F401

from flask import Blueprint, request
from sqlalchemy.exc import IntegrityError

from ..auth import ApiError, audit, body, current_user, login_required, ok, paginated, perm_required
from ..models import (
    ACTIVE_STATUSES,
    Booking,
    BookingItem,
    BookingStatusHistory,
    Invoice,
    Patient,
    STATUS_CANCELLED,
    STATUS_CONFIRMED,
    STATUS_NO_SHOW,
    STATUS_PENDING,
    STATUS_REPORT,
    TERMINAL_STATUSES,
    TRANSITIONS,
    Product,
    User,
    db,
)
from ..services import (
    cancellation_policy,
    next_booking_no,
    next_invoice_no,
    notify,
    notify_role,
    parse_date,
    price_booking,
    slot_conflicts,
    technician_pool,
)

bp = Blueprint("bookings", __name__, url_prefix="/api/bookings")

#: Lab-side transitions only certain roles may perform.
LAB_TRANSITIONS = {"SAMPLE_COLLECTED", "IN_LAB", "COMPLETED", "REPORT_READY"}
LAB_ROLES = {"technician", "manager", "admin"}


# ---------------------------------------------------------------------------
# Listing & filters
# ---------------------------------------------------------------------------

def _query():
    q = Booking.query

    status = request.args.get("status")
    if status and status != "all":
        if "," in status:
            q = q.filter(Booking.status.in_(status.split(",")))
        else:
            q = q.filter(Booking.status == status)

    view = request.args.get("view")
    today = localdate()
    if view == "today":
        q = q.filter(Booking.booking_date == today)
    elif view == "upcoming":
        q = q.filter(Booking.booking_date >= today,
                     Booking.status.in_((STATUS_PENDING, STATUS_CONFIRMED)))
    elif view == "past":
        q = q.filter(Booking.booking_date < today)
    elif view == "attention":
        q = q.filter(Booking.status.in_((STATUS_PENDING, STATUS_NO_SHOW)))

    if request.args.get("date_from"):
        try:
            q = q.filter(Booking.booking_date >= date.fromisoformat(request.args["date_from"]))
        except ValueError:
            raise ApiError("'date_from' must be YYYY-MM-DD.", 422)
    if request.args.get("date_to"):
        try:
            q = q.filter(Booking.booking_date <= date.fromisoformat(request.args["date_to"]))
        except ValueError:
            raise ApiError("'date_to' must be YYYY-MM-DD.", 422)

    booking_type = request.args.get("type")
    if booking_type:
        q = q.filter(Booking.booking_type == booking_type)

    priority = request.args.get("priority")
    if priority:
        q = q.filter(Booking.priority == priority)

    search = (request.args.get("q") or "").strip()
    if search:
        like = f"%{search}%"
        q = q.join(Patient, Booking.patient_id == Patient.id, isouter=True).filter(
            Booking.booking_no.ilike(like)
            | Patient.name.ilike(like)
            | Patient.phone.ilike(like)
            | Patient.code.ilike(like)
        )

    sort = request.args.get("sort", "date")
    order = {
        "date": (Booking.booking_date.desc(), Booking.slot_start.asc()),
        "created": Booking.created_at.desc(),
        "amount": Booking.total.desc(),
        "patient": Patient.name.asc(),
    }.get(sort, (Booking.booking_date.desc(), Booking.slot_start.asc()))
    return q.order_by(*order)


@bp.get("")
@perm_required("bookings.view")
def list_bookings():
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, int(request.args.get("per_page", 15)))
    q = _query()
    total = q.count()
    rows = q.offset((page - 1) * per_page).limit(per_page).all()

    today = localdate()
    stats = {
        "today": Booking.query.filter(Booking.booking_date == today).count(),
        "pending": Booking.query.filter(Booking.status == STATUS_PENDING).count(),
        "confirmed": Booking.query.filter(Booking.status == STATUS_CONFIRMED).count(),
        "no_show": Booking.query.filter(Booking.status == STATUS_NO_SHOW).count(),
        "cancelled": Booking.query.filter(Booking.status == STATUS_CANCELLED).count(),
        "revenue_today": float(
            db.session.query(db.func.coalesce(db.func.sum(Booking.total), 0))
            .filter(Booking.booking_date == today,
                    Booking.status.notin_((STATUS_CANCELLED, STATUS_NO_SHOW)))
            .scalar() or 0
        ),
    }
    return paginated([b.to_dict() for b in rows], page, per_page, total,
                     extra={"stats": stats})


@bp.get("/<int:booking_id>")
@perm_required("bookings.view")
def get_booking(booking_id):
    booking = _fetch(booking_id)
    data = booking.to_dict(detail=True)
    data["cancellation_policy"] = (
        cancellation_policy(booking)
        if booking.status not in TERMINAL_STATUSES else None
    )
    return ok(data)


def _fetch(booking_id):
    booking = db.session.get(Booking, booking_id)
    if booking is None:
        raise ApiError("Booking not found.", 404)
    return booking


# ---------------------------------------------------------------------------
# Creation
# ---------------------------------------------------------------------------

@bp.post("")
@perm_required("bookings.create")
def create_booking():
    data = body()
    user = current_user()

    # --- patient (existing or walk-in registration) ------------------------
    patient = None
    registered_inline = None  # audited after the transaction commits
    if data.get("patient_id"):
        patient = db.session.get(Patient, int(data["patient_id"]))
        if patient is None:
            raise ApiError("Selected patient no longer exists.", 422, field="patient_id")
    elif data.get("patient_name") and data.get("patient_phone"):
        existing = Patient.query.filter(
            Patient.phone == str(data["patient_phone"]).strip()
        ).first()
        if existing:
            patient = existing
        else:
            from ..services import next_patient_code

            patient = Patient(code=next_patient_code(), created_by=user.id)
            patient.name = str(data["patient_name"]).strip()
            patient.phone = str(data["patient_phone"]).strip()
            patient.gender = (data.get("patient_gender") or "other").lower()
            patient.address = data.get("patient_address") or ""
            db.session.add(patient)
            db.session.flush()
            registered_inline = patient
    else:
        raise ApiError("Select or register a patient.", 422, field="patient_id")

    # --- slot ---------------------------------------------------------------
    target = parse_date(data.get("booking_date"), "booking_date")
    if target is None:
        raise ApiError("Appointment date is required.", 422, field="booking_date")
    slot_start = (data.get("slot_start") or "").strip()
    if not slot_start or ":" not in slot_start:
        raise ApiError("Please choose a time slot.", 422, field="slot_start")

    from ..services import generate_slots, slot_minutes

    matches = [s for s in generate_slots(target) if s[0] == slot_start]
    if not matches:
        raise ApiError("That slot is outside working hours.", 422, field="slot_start")
    _, slot_end = matches[0]

    if target < localdate():
        raise ApiError("Cannot book a slot in the past.", 422, field="booking_date")

    # --- pricing ------------------------------------------------------------
    product_ids = data.get("product_ids") or []
    if not product_ids:
        raise ApiError("Select at least one test or package.", 422, field="product_ids")
    try:
        lines, subtotal, discount, total = price_booking(product_ids, data.get("discount"))
    except ValueError as exc:
        raise ApiError(str(exc), 422)

    booking_type = data.get("booking_type") or "center"
    if booking_type not in ("center", "home"):
        raise ApiError("Invalid booking type.", 422, field="booking_type")
    address = (data.get("address") or "").strip()
    if booking_type == "home" and len(address) < 8:
        raise ApiError("Home collection needs a full address.", 422, field="address")

    priority = data.get("priority") or "routine"
    if priority not in ("routine", "urgent"):
        raise ApiError("Priority must be routine or urgent.", 422)

    # --- conflict detection (inside the transaction) ------------------------
    conflict = slot_conflicts(target, slot_start, slot_end)
    if conflict:
        raise ApiError(
            f"Slot {slot_start} on {target:%d %b %Y} was just booked "
            f"({conflict.booking_no}). Please pick another slot.",
            409, code="slot_taken", slot=slot_start,
        )

    booking = Booking(
        booking_no=next_booking_no(),
        patient_id=patient.id,
        booking_date=target,
        slot_start=slot_start,
        slot_end=slot_end,
        booking_type=booking_type,
        address=address,
        phone=(data.get("phone") or patient.phone or ""),
        phlebotomist_id=int(data["phlebotomist_id"]) if data.get("phlebotomist_id") else None,
        priority=priority,
        status=STATUS_PENDING if booking_type == "center" else STATUS_CONFIRMED,
        subtotal=subtotal,
        discount=discount,
        total=total,
        notes=(data.get("notes") or "").strip(),
        followup_of_id=int(data["followup_of_id"]) if data.get("followup_of_id") else None,
        created_by=user.id,
    )
    db.session.add(booking)
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        raise ApiError(
            "That slot has just been taken. Please choose another.", 409, code="slot_taken"
        )

    for line in lines:
        db.session.add(BookingItem(booking_id=booking.id, **line))

    invoice = Invoice(
        invoice_no=next_invoice_no(),
        booking_id=booking.id,
        patient_id=patient.id,
        subtotal=subtotal,
        discount=discount,
        total=total,
        status="unpaid",
    )
    db.session.add(invoice)

    db.session.add(BookingStatusHistory(
        booking_id=booking.id,
        from_status="",
        to_status=booking.status,
        reason="Booking created",
        user_id=user.id,
    ))

    notify(
        title=f"New booking {booking.booking_no}",
        body=f"{patient.name} - {target:%d %b} at {slot_start}"
             + (" (URGENT)" if priority == "urgent" else ""),
        link=f"#/bookings/{booking.id}",
        level="warning" if priority == "urgent" else "info",
        role="manager",
    )
    if booking_type == "home":
        notify_role("technician", "Home collection assigned",
                    f"{patient.name} on {target:%d %b} at {slot_start}",
                    link=f"#/bookings/{booking.id}")

    db.session.commit()
    if registered_inline is not None:
        audit("patient_registered", "patient", registered_inline.id,
              {"code": registered_inline.code, "via": "booking wizard"})
    audit("booking_created", "booking", booking.id,
          {"booking_no": booking.booking_no, "patient": patient.name,
           "date": target.isoformat(), "slot": slot_start, "total": total})

    return ok(booking.to_dict(detail=True),
              message=f"Booking {booking.booking_no} created for {patient.name}.",
              status=201)


# ---------------------------------------------------------------------------
# Modification
# ---------------------------------------------------------------------------

@bp.put("/<int:booking_id>")
@perm_required("bookings.edit")
def update_booking(booking_id):
    booking = _fetch(booking_id)
    if booking.status in TERMINAL_STATUSES:
        raise ApiError(
            f"A {booking.status_label} booking cannot be edited.", 409
        )
    if booking.status not in (STATUS_PENDING, STATUS_CONFIRMED):
        raise ApiError(
            "Editing is locked once sample collection has started.", 409,
            code="locked",
        )

    data = body()
    if data.get("notes") is not None:
        booking.notes = str(data["notes"]).strip()
    if data.get("phone") is not None:
        booking.phone = str(data["phone"]).strip()
    if data.get("address") is not None:
        if booking.booking_type == "home" and len(str(data["address"]).strip()) < 8:
            raise ApiError("Home collection needs a full address.", 422)
        booking.address = str(data["address"]).strip()
    if data.get("priority"):
        if data["priority"] not in ("routine", "urgent"):
            raise ApiError("Priority must be routine or urgent.", 422)
        booking.priority = data["priority"]
    if data.get("phlebotomist_id"):
        tech = db.session.get(User, int(data["phlebotomist_id"]))
        if tech is None:
            raise ApiError("Selected technician not found.", 422)
        booking.phlebotomist_id = tech.id
    elif data.get("phlebotomist_id") == "":
        booking.phlebotomist_id = None

    # Line item edits before the lab takes over.
    if data.get("product_ids") is not None:
        _replace_items(booking, data["product_ids"], data.get("discount", booking.discount))

    db.session.commit()
    audit("booking_updated", "booking", booking.id, {"booking_no": booking.booking_no})
    return ok(booking.to_dict(detail=True), message="Booking updated.")


def _replace_items(booking, product_ids, discount):
    try:
        lines, subtotal, disc, total = price_booking(product_ids, discount)
    except ValueError as exc:
        raise ApiError(str(exc), 422)

    BookingItem.query.filter_by(booking_id=booking.id).delete(synchronize_session=False)
    for line in lines:
        db.session.add(BookingItem(booking_id=booking.id, **line))

    booking.subtotal, booking.discount, booking.total = subtotal, disc, total
    if booking.invoice:
        booking.invoice.subtotal = subtotal
        booking.invoice.discount = disc
        booking.invoice.total = total
        booking.invoice.sync()
    if booking.paid_amount > total:
        raise ApiError(
            "Collected amount exceeds the new total - process a refund first.", 409
        )


@bp.post("/<int:booking_id>/reschedule")
@perm_required("bookings.edit")
def reschedule(booking_id):
    booking = _fetch(booking_id)
    if booking.status in TERMINAL_STATUSES:
        raise ApiError(
            f"A {booking.status_label} booking cannot be rescheduled. "
            "Create a new booking instead.", 409,
        )

    data = body()
    target = parse_date(data.get("booking_date"), "booking_date")
    slot_start = (data.get("slot_start") or "").strip()
    reason = (data.get("reason") or "").strip()

    if target is None or not slot_start:
        raise ApiError("New date and time slot are required.", 422)
    if target < localdate():
        raise ApiError("Cannot reschedule into the past.", 422)

    from ..services import generate_slots

    matches = [s for s in generate_slots(target) if s[0] == slot_start]
    if not matches:
        raise ApiError("That slot is outside working hours.", 422, field="slot_start")
    _, slot_end = matches[0]

    if target == booking.booking_date and slot_start == booking.slot_start:
        raise ApiError("Pick a different date or time.", 422)

    conflict = slot_conflicts(target, slot_start, slot_end, exclude_booking_id=booking.id)
    if conflict:
        raise ApiError(
            f"Slot {slot_start} on {target:%d %b %Y} is already taken "
            f"({conflict.booking_no}).", 409, code="slot_taken",
        )

    old = f"{booking.booking_date:%d %b %Y} {booking.slot_start}"
    booking.booking_date = target
    booking.slot_start = slot_start
    booking.slot_end = slot_end
    db.session.add(BookingStatusHistory(
        booking_id=booking.id,
        from_status=booking.status,
        to_status=booking.status,
        reason=reason or f"Rescheduled from {old} to {target:%d %b %Y} {slot_start}",
        user_id=current_user().id,
    ))
    notify(
        title=f"Booking rescheduled {booking.booking_no}",
        body=f"{old} -> {target:%d %b %Y} {slot_start}",
        link=f"#/bookings/{booking.id}", level="warning",
    )
    db.session.commit()
    audit("booking_rescheduled", "booking", booking.id,
          {"from": old, "to": f"{target} {slot_start}", "reason": reason})
    return ok(booking.to_dict(detail=True),
              message=f"Rescheduled to {target:%d %b %Y}, {slot_start}.")


@bp.post("/<int:booking_id>/cancel")
@perm_required("bookings.cancel")
def cancel(booking_id):
    booking = _fetch(booking_id)
    if booking.status in TERMINAL_STATUSES:
        raise ApiError(f"Booking is already {booking.status_label.lower()}.", 409)

    data = body()
    reason = (data.get("reason") or "").strip()
    if len(reason) < 3:
        raise ApiError("A cancellation reason is required.", 422, field="reason")

    policy = cancellation_policy(booking)
    refund = policy["refundable"]
    if data.get("waive_refund"):
        refund = 0.0

    previous = booking.status
    booking.status = STATUS_CANCELLED
    booking.cancel_reason = reason
    booking.cancelled_by = current_user().id
    booking.cancelled_at = utcnow()
    db.session.add(BookingStatusHistory(
        booking_id=booking.id,
        from_status=previous,
        to_status=STATUS_CANCELLED,
        reason=reason,
        user_id=current_user().id,
    ))

    refunded = 0.0
    if refund > 0 and booking.invoice:
        from ..routes.billing import record_refund

        refunded = record_refund(booking.invoice, refund, reason, current_user())

    notify(
        title=f"Booking cancelled {booking.booking_no}",
        body=f"{booking.patient.name} - {reason}",
        link=f"#/bookings/{booking.id}", level="warning",
    )
    db.session.commit()
    audit("booking_cancelled", "booking", booking.id,
          {"booking_no": booking.booking_no, "reason": reason, "refund": refunded})

    message = f"{booking.booking_no} cancelled."
    if refunded:
        message += f" Refund of {refunded:,.0f} processed."
    elif policy["late"] and booking.paid_amount:
        message += " Late cancellation - no refund per policy."
    return ok(booking.to_dict(detail=True), message=message)


@bp.post("/<int:booking_id>/status")
@perm_required("bookings.status")
def change_status(booking_id):
    booking = _fetch(booking_id)
    data = body()
    new_status = (data.get("status") or "").strip().upper()
    reason = (data.get("reason") or "").strip()
    user = current_user()

    allowed_next = TRANSITIONS.get(booking.status, [])
    if new_status not in allowed_next:
        raise ApiError(
            f"Cannot move from {booking.status_label} to "
            f"{new_status.replace('_', ' ').title()}. "
            f"Allowed: {', '.join(allowed_next) or 'none (final state)'}.",
            409, code="invalid_transition",
        )

    if new_status in LAB_TRANSITIONS and user.role_name not in LAB_ROLES:
        raise ApiError(
            "Only lab technicians and managers can update sample/lab status.", 403
        )
    if new_status == STATUS_CANCELLED:
        raise ApiError("Use the cancel endpoint for cancellations.", 400)
    if new_status == STATUS_NO_SHOW and "bookings.cancel" not in user.permissions:
        raise ApiError("You are not allowed to flag no-shows.", 403)
    if new_status == STATUS_NO_SHOW and booking.booking_date > localdate():
        raise ApiError("Cannot flag a future appointment as a no-show.", 409)

    previous = booking.status
    booking.status = new_status
    db.session.add(BookingStatusHistory(
        booking_id=booking.id,
        from_status=previous,
        to_status=new_status,
        reason=reason,
        user_id=user.id,
    ))

    if new_status == STATUS_REPORT:
        notify(
            title=f"Report ready - {booking.booking_no}",
            body=f"{booking.patient.name} can collect the report.",
            link=f"#/bookings/{booking.id}", level="success",
        )
    if new_status == STATUS_NO_SHOW:
        notify(
            title=f"No-show recorded {booking.booking_no}",
            body=booking.patient.name, link=f"#/bookings/{booking.id}", level="warning",
        )

    db.session.commit()
    audit("booking_status", "booking", booking.id,
          {"booking_no": booking.booking_no, "from": previous, "to": new_status,
           "reason": reason})
    return ok(booking.to_dict(detail=True),
              message=f"Status updated to {booking.status_label}.")


# ---------------------------------------------------------------------------
# Line items inside an existing booking
# ---------------------------------------------------------------------------

@bp.post("/<int:booking_id>/items")
@perm_required("bookings.edit")
def add_items(booking_id):
    booking = _fetch(booking_id)
    if booking.status not in (STATUS_PENDING, STATUS_CONFIRMED):
        raise ApiError("Tests can only be added before sample collection.", 409)

    data = body()
    ids = set(int(i) for i in (data.get("product_ids") or []) if str(i).isdigit())
    if not ids:
        raise ApiError("Choose at least one test.", 422)
    ids.update(p.product_id for p in booking.items if p.product_id)
    _replace_items(booking, list(ids), data.get("discount", booking.discount))
    db.session.commit()
    audit("booking_items_changed", "booking", booking.id,
          {"booking_no": booking.booking_no, "count": len(booking.items)})
    return ok(booking.to_dict(detail=True), message="Tests updated.")


@bp.delete("/<int:booking_id>/items/<int:item_id>")
@perm_required("bookings.edit")
def remove_item(booking_id, item_id):
    booking = _fetch(booking_id)
    if booking.status not in (STATUS_PENDING, STATUS_CONFIRMED):
        raise ApiError("Tests can only be removed before sample collection.", 409)

    item = db.session.get(BookingItem, item_id)
    if item is None or item.booking_id != booking.id:
        raise ApiError("Line item not found.", 404)

    remaining = [p.product_id for p in booking.items
                 if p.id != item_id and p.product_id]
    if not remaining:
        raise ApiError("A booking must keep at least one test. Cancel instead.", 409)

    _replace_items(booking, remaining, booking.discount)
    db.session.commit()
    audit("booking_item_removed", "booking", booking.id,
          {"booking_no": booking.booking_no, "item": item.name})
    return ok(booking.to_dict(detail=True), message=f"{item.name} removed.")


# ---------------------------------------------------------------------------
# Follow-up booking
# ---------------------------------------------------------------------------

@bp.post("/<int:booking_id>/followup")
@perm_required("bookings.create")
def followup(booking_id):
    source = _fetch(booking_id)
    data = body()

    target = parse_date(data.get("booking_date"), "booking_date")
    slot_start = (data.get("slot_start") or "").strip()
    if target is None or not slot_start:
        raise ApiError("Date and slot are required.", 422)

    from ..services import generate_slots

    matches = [s for s in generate_slots(target) if s[0] == slot_start]
    if not matches:
        raise ApiError("That slot is outside working hours.", 422)
    conflict = slot_conflicts(target, slot_start, matches[0][1])
    if conflict:
        raise ApiError("That slot is already taken.", 409, code="slot_taken")

    product_ids = data.get("product_ids") or [i.product_id for i in source.items]
    lines, subtotal, discount, total = price_booking(product_ids, data.get("discount", 0))

    booking = Booking(
        booking_no=next_booking_no(),
        patient_id=source.patient_id,
        booking_date=target,
        slot_start=slot_start,
        slot_end=matches[0][1],
        booking_type=source.booking_type,
        address=source.address,
        phone=source.phone,
        phlebotomist_id=source.phlebotomist_id,
        priority="routine",
        status=STATUS_PENDING,
        subtotal=subtotal, discount=discount, total=total,
        notes=(data.get("notes") or f"Follow-up of {source.booking_no}"),
        followup_of_id=source.id,
        created_by=current_user().id,
    )
    db.session.add(booking)
    db.session.flush()
    for line in lines:
        db.session.add(BookingItem(booking_id=booking.id, **line))
    db.session.add(Invoice(
        invoice_no=next_invoice_no(), booking_id=booking.id,
        patient_id=source.patient_id, subtotal=subtotal,
        discount=discount, total=total, status="unpaid",
    ))
    db.session.add(BookingStatusHistory(
        booking_id=booking.id, from_status="", to_status=STATUS_PENDING,
        reason=f"Follow-up of {source.booking_no}", user_id=current_user().id,
    ))
    db.session.commit()
    audit("booking_followup", "booking", booking.id,
          {"parent": source.booking_no, "booking_no": booking.booking_no})
    return ok(booking.to_dict(detail=True),
              message=f"Follow-up {booking.booking_no} created.", status=201)


# ---------------------------------------------------------------------------
# Pickers used by the UI
# ---------------------------------------------------------------------------

@bp.get("/reference/technicians")
@perm_required("bookings.view")
def technicians():
    return ok([{"id": u.id, "name": u.name, "designation": u.designation}
               for u in technician_pool()])
