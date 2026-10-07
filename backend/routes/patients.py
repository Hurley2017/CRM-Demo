"""Patient registry: registration, search and history."""

from datetime import datetime
from ..models import localdate, utcnow  # noqa: F401

from flask import Blueprint, request

from ..auth import ApiError, audit, body, current_user, perm_required, ok, paginated
from ..models import GENDERS, Patient, db
from ..services import next_patient_code

bp = Blueprint("patients", __name__, url_prefix="/api/patients")


def _query():
    q = Patient.query
    search = (request.args.get("q") or "").strip()
    if search:
        like = f"%{search}%"
        q = q.filter(
            Patient.name.ilike(like)
            | Patient.phone.ilike(like)
            | Patient.code.ilike(like)
            | Patient.email.ilike(like)
        )
    if request.args.get("active") in ("0", "1"):
        q = q.filter(Patient.active == (request.args.get("active") == "1"))
    return q.order_by(Patient.updated_at.desc())


@bp.get("")
@perm_required("patients.view")
def list_patients():
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, int(request.args.get("per_page", 20)))
    q = _query()
    total = q.count()
    patients = q.offset((page - 1) * per_page).limit(per_page).all()
    return paginated([p.to_dict() for p in patients], page, per_page, total)


@bp.get("/suggest")
@perm_required("patients.view")
def suggest():
    """Lightweight type-ahead used inside the booking wizard."""
    search = (request.args.get("q") or "").strip()
    if len(search) < 2:
        return ok([])
    like = f"%{search}%"
    patients = (
        Patient.query.filter(
            Patient.active.is_(True),
            Patient.name.ilike(like) | Patient.phone.ilike(like) | Patient.code.ilike(like),
        )
        .order_by(Patient.name)
        .limit(8)
        .all()
    )
    return ok([p.to_dict() for p in patients])


@bp.get("/duplicates")
@perm_required("patients.view")
def duplicates():
    """Patients sharing a phone number - useful for data hygiene."""
    rows = (
        db.session.query(Patient.phone, db.func.count(Patient.id).label("n"))
        .filter(Patient.phone != "", Patient.phone.isnot(None))
        .group_by(Patient.phone)
        .having(db.func.count(Patient.id) > 1)
        .all()
    )
    return ok([{"phone": r.phone, "count": r.n} for r in rows][:50])


def _fetch(patient_id):
    patient = db.session.get(Patient, patient_id)
    if patient is None:
        raise ApiError("Patient not found.", 404)
    return patient


def _validate(data, partial=False):
    name = (data.get("name") or "").strip()
    phone = (data.get("phone") or "").strip()
    if not partial:
        if not name:
            raise ApiError("Patient name is required.", 422, field="name")
        if not phone or len(phone) < 6:
            raise ApiError("A valid phone number is required.", 422, field="phone")
    gender = (data.get("gender") or "").lower()
    if gender and gender not in GENDERS:
        raise ApiError("Invalid gender value.", 422, field="gender")

    dob = None
    if data.get("dob"):
        try:
            dob = datetime.fromisoformat(str(data["dob"])[:10]).date()
        except ValueError:
            raise ApiError("Date of birth must be YYYY-MM-DD.", 422, field="dob")
        if dob > localdate():
            raise ApiError("Date of birth cannot be in the future.", 422, field="dob")
    return name, phone, gender, dob


def _apply(patient, data, partial=False):
    name, phone, gender, dob = _validate(data, partial=partial)
    if name:
        patient.name = name
    if phone:
        patient.phone = phone
    if data.get("email") is not None:
        patient.email = data["email"].strip().lower()
    if gender:
        patient.gender = gender
    if data.get("dob") is not None:
        patient.dob = dob
    for field in ("address", "city", "blood_group", "allergies", "notes"):
        if data.get(field) is not None:
            setattr(patient, field, str(data[field]).strip())


@bp.post("")
@perm_required("patients.edit")
def create_patient():
    data = body()
    name, phone, gender, dob = _validate(data)

    existing = Patient.query.filter(Patient.phone == phone).first()
    if existing:
        return ok(
            {"duplicate": True, "patient": existing.to_dict()},
            message=f"Phone number already registered to {existing.name} ({existing.code}).",
            status=409,
        )

    patient = Patient(
        code=next_patient_code(),
        created_by=current_user().id,
    )
    _apply(patient, data)
    db.session.add(patient)
    db.session.commit()

    audit("patient_registered", "patient", patient.id,
          {"code": patient.code, "name": patient.name})
    return ok(patient.to_dict(), message=f"{patient.name} registered ({patient.code}).",
              status=201)


@bp.get("/<int:patient_id>")
@perm_required("patients.view")
def get_patient(patient_id):
    patient = _fetch(patient_id)
    data = patient.to_dict()
    data["bookings"] = [b.to_dict() for b in patient.bookings[:25]]
    return ok(data)


@bp.put("/<int:patient_id>")
@perm_required("patients.edit")
def update_patient(patient_id):
    patient = _fetch(patient_id)
    data = body()
    if data.get("phone"):
        clash = Patient.query.filter(
            Patient.phone == data["phone"].strip(), Patient.id != patient.id
        ).first()
        if clash:
            raise ApiError(
                f"Phone already used by {clash.name} ({clash.code}).", 409, field="phone"
            )
    _apply(patient, data, partial=True)
    if data.get("active") is not None:
        patient.active = bool(data["active"])
    db.session.commit()
    audit("patient_updated", "patient", patient.id, {"code": patient.code})
    return ok(patient.to_dict(), message="Patient record updated.")


@bp.post("/<int:patient_id>/deactivate")
@perm_required("patients.edit")
def deactivate(patient_id):
    patient = _fetch(patient_id)
    patient.active = False
    db.session.commit()
    audit("patient_deactivated", "patient", patient.id, {"code": patient.code})
    return ok(patient.to_dict(), message=f"{patient.name} marked inactive.")
