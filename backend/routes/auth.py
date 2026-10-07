"""Authentication endpoints: login / logout / session introspection."""

from datetime import datetime, timedelta
from ..models import utcnow  # noqa: F401

from flask import Blueprint, session

from ..auth import ApiError, audit, body, current_user, login_required, ok
from ..models import User, db

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

MAX_FAILED_ATTEMPTS = 5
LOCK_MINUTES = 15


@bp.post("/login")
def login():
    data = body()
    employee_id = (data.get("employee_id") or "").strip().upper()
    password = data.get("password") or ""

    if not employee_id or not password:
        raise ApiError("Employee ID and password are required.", 422)

    user = User.query.filter(
        (User.employee_id == employee_id)
        | (User.email.ilike(employee_id))
    ).first()

    if user is None:
        raise ApiError("Invalid employee ID or password.", 401, code="invalid_credentials")

    if user.status != "active":
        raise ApiError(
            "This account has been suspended. Contact your administrator.", 403
        )

    if user.is_locked():
        raise ApiError(
            "Account temporarily locked after repeated failed attempts. "
            f"Try again after {LOCK_MINUTES} minutes.",
            423, code="locked",
        )

    if not user.check_password(password):
        user.failed_attempts = (user.failed_attempts or 0) + 1
        if user.failed_attempts >= MAX_FAILED_ATTEMPTS:
            user.locked_until = utcnow() + timedelta(minutes=LOCK_MINUTES)
            user.failed_attempts = 0
            db.session.commit()
            raise ApiError(
                f"Too many failed attempts. Account locked for {LOCK_MINUTES} minutes.",
                423, code="locked",
            )
        db.session.commit()
        remaining = MAX_FAILED_ATTEMPTS - user.failed_attempts
        raise ApiError(
            f"Invalid employee ID or password. {remaining} attempt(s) remaining.",
            401, code="invalid_credentials",
        )

    # Fresh session on privilege change (session fixation defence).
    session.clear()
    session.permanent = True
    session["uid"] = user.id
    session["role"] = user.role_name

    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    db.session.commit()

    audit("login", "user", user.id,
          {"employee_id": user.employee_id}, user=user)

    return ok({
        "user": user.to_dict(),
        "permissions": user.permissions,
    }, message=f"Welcome back, {user.name.split()[0]}.")


@bp.post("/logout")
@login_required
def logout():
    user = current_user()
    audit("logout", "user", user.id, user=user)
    session.clear()
    return ok(message="Signed out.")


@bp.get("/me")
def me():
    user = current_user()
    if user is None:
        return ok({"user": None, "permissions": []})
    return ok({"user": user.to_dict(), "permissions": user.permissions})


@bp.post("/password")
@login_required
def change_password():
    data = body()
    user = current_user()
    current = data.get("current_password") or ""
    new_password = data.get("new_password") or ""

    if not user.check_password(current):
        raise ApiError("Your current password is incorrect.", 403)
    if len(new_password) < 8:
        raise ApiError("New password must be at least 8 characters.", 422)

    user.set_password(new_password)
    db.session.commit()
    audit("password_changed", "user", user.id, user=user)
    return ok(message="Password updated successfully.")
