"""Employee / role administration (admin only)."""

from datetime import datetime
from ..models import localdate, utcnow  # noqa: F401

from flask import Blueprint, request

from ..auth import ApiError, audit, body, perm_required, ok, paginated
from ..models import ROLE_LABELS, Role, User, db
from ..services import notify

bp = Blueprint("users", __name__, url_prefix="/api/users")


def _query():
    q = User.query
    search = (request.args.get("q") or "").strip()
    if search:
        like = f"%{search}%"
        q = q.filter(
            User.name.ilike(like)
            | User.employee_id.ilike(like)
            | User.email.ilike(like)
        )
    role = request.args.get("role")
    if role:
        q = q.join(Role).filter(Role.name == role)
    status = request.args.get("status")
    if status:
        q = q.filter(User.status == status)
    return q.order_by(User.name)


@bp.get("")
@perm_required("users.view")
def list_users():
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, int(request.args.get("per_page", 25)))
    q = _query()
    total = q.count()
    users = q.offset((page - 1) * per_page).limit(per_page).all()
    counts = {
        r.name: User.query.filter(User.role.has(name=r.name)).count()
        for r in Role.query.all()
    }
    return paginated([u.to_dict() for u in users], page, per_page, total,
                     extra={"role_counts": counts})


@bp.get("/roles")
@perm_required("users.view")
def list_roles():
    roles = Role.query.order_by(Role.id).all()
    return ok([r.to_dict() for r in roles] or [
        {"name": name, "label": label, "permissions": []}
        for name, label in ROLE_LABELS.items()
    ])


@bp.post("")
@perm_required("users.manage")
def create_user():
    data = body()
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    role_name = (data.get("role") or "").strip()
    password = data.get("password") or ""

    if not name or not email:
        raise ApiError("Name and email are required.", 422)
    if len(password) < 8:
        raise ApiError("Password must be at least 8 characters.", 422)

    role = Role.query.filter_by(name=role_name).first()
    if role is None:
        raise ApiError("Unknown role.", 422, field="role")

    if User.query.filter_by(email=email).first():
        raise ApiError("An account with this email already exists.", 409, field="email")

    sequence = (User.query.count() or 0) + 1001
    employee_id = f"EMP-{sequence}"
    while User.query.filter_by(employee_id=employee_id).first():
        sequence += 1
        employee_id = f"EMP-{sequence}"

    user = User(
        employee_id=employee_id,
        name=name,
        email=email,
        phone=(data.get("phone") or "").strip(),
        designation=(data.get("designation") or "").strip(),
        role_id=role.id,
        status=data.get("status") or "active",
    )
    user.set_password(password)
    db.session.add(user)
    db.session.flush()
    db.session.commit()

    audit("user_created", "user", user.id,
          {"employee_id": employee_id, "role": role.name})
    return ok(user.to_dict(), message=f"{name} added as {role.label}.", status=201)


def _fetch(user_id):
    user = db.session.get(User, user_id)
    if user is None:
        raise ApiError("Employee not found.", 404)
    return user


@bp.get("/<int:user_id>")
@perm_required("users.view")
def get_user(user_id):
    return ok(_fetch(user_id).to_dict())


@bp.put("/<int:user_id>")
@perm_required("users.manage")
def update_user(user_id):
    user = _fetch(user_id)
    data = body()
    before = {"role": user.role_name, "status": user.status}

    if data.get("name"):
        user.name = data["name"].strip()
    if data.get("email"):
        email = data["email"].strip().lower()
        clash = User.query.filter(User.email == email, User.id != user.id).first()
        if clash:
            raise ApiError("An account with this email already exists.", 409)
        user.email = email
    user.phone = (data.get("phone") or user.phone or "").strip()
    user.designation = (data.get("designation") or user.designation or "").strip()

    if data.get("role"):
        role = Role.query.filter_by(name=data["role"]).first()
        if role is None:
            raise ApiError("Unknown role.", 422)
        if user.id == current_id_guard() and role.name != "admin":
            raise ApiError("You cannot remove your own admin access.", 409)
        user.role_id = role.id

    if data.get("status") in ("active", "suspended"):
        if user.id == current_id_guard() and data["status"] == "suspended":
            raise ApiError("You cannot suspend your own account.", 409)
        user.status = data["status"]
        if user.status == "active":
            user.locked_until = None
            user.failed_attempts = 0

    db.session.commit()
    audit("user_updated", "user", user.id, {"before": before, "after": data})
    return ok(user.to_dict(), message="Employee updated.")


@bp.post("/<int:user_id>/password")
@perm_required("users.manage")
def reset_password(user_id):
    user = _fetch(user_id)
    data = body()
    password = data.get("password") or ""
    if len(password) < 8:
        raise ApiError("Password must be at least 8 characters.", 422)
    user.set_password(password)
    # queued before the commit so the recipient actually sees it
    notify(title="Password reset by administrator",
           body=f"Your password was reset on {localdate():%d %b %Y}.",
           user_id=user.id, level="warning")
    db.session.commit()
    audit("password_reset", "user", user.id, {"target": user.employee_id})
    return ok(message=f"Password reset for {user.name}.")


def current_id_guard():
    from ..auth import current_user

    user = current_user()
    return user.id if user else None
