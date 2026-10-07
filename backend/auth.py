"""Authentication, RBAC guards and shared API helpers."""

import json
from functools import wraps

from flask import g, jsonify, request, session

from .models import AuditLog, User, db


class ApiError(Exception):
    """Raise inside a route to return a consistent JSON error envelope."""

    def __init__(self, message, status=400, code=None, **extra):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code or {
            400: "bad_request",
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            409: "conflict",
            422: "unprocessable",
            429: "rate_limited",
        }.get(status, "error")
        self.extra = extra


# ---------------------------------------------------------------------------
# Envelopes
# ---------------------------------------------------------------------------

def ok(data=None, message=None, status=200):
    payload = {"ok": True, "data": data}
    if message:
        payload["message"] = message
    response = jsonify(payload)
    response.status_code = status
    return response


def error(message, status=400, code=None, **extra):
    payload = {"ok": False, "error": {"code": code or "error", "message": message}}
    payload["error"].update(extra)
    response = jsonify(payload)
    response.status_code = status
    return response


def paginated(items, page, per_page, total, extra=None):
    pages = max(1, -(-total // per_page))
    data = {
        "items": items,
        "page": page,
        "per_page": per_page,
        "total": total,
        "pages": pages,
        "has_next": page < pages,
        "has_prev": page > 1,
    }
    if extra:
        data.update(extra)
    return ok(data)


def get_int(name, default=None, required=False, minimum=None):
    raw = request.args.get(name) if request.method == "GET" else None
    if raw is None:
        raw = (request.get_json(silent=True) or {}).get(name)
    if raw in (None, ""):
        if required:
            raise ApiError(f"'{name}' is required", 422)
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ApiError(f"'{name}' must be an integer", 422)
    if minimum is not None and value < minimum:
        raise ApiError(f"'{name}' must be >= {minimum}", 422)
    return value


def body():
    """Parsed JSON body (never None)."""
    data = request.get_json(silent=True)
    if data is None:
        data = {k: v for k, v in request.form.to_dict().items()}
    if not isinstance(data, dict):
        raise ApiError("Request body must be a JSON object", 400)
    return data


def require(*fields):
    """Validate presence/length of required fields in the JSON body."""
    data = body()
    for field in fields:
        value = data.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            raise ApiError(f"'{field}' is required", 422, field=field)
    return data


# ---------------------------------------------------------------------------
# Session / current user
# ---------------------------------------------------------------------------

def load_current_user():
    g.current_user = None
    uid = session.get("uid")
    if not uid:
        return
    user = db.session.get(User, uid)
    if user is None or user.status != "active":
        session.clear()
        return
    g.current_user = user


def current_user():
    return getattr(g, "current_user", None)


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            raise ApiError("Your session has expired. Please sign in again.", 401)
        return fn(*args, **kwargs)

    return wrapper


def perm_required(*required_permissions, any_of=False):
    """Guard a view with one or more permission keys.

    ``any_of=True`` grants access when the user holds *any* of the listed
    permissions instead of all of them.
    """

    def decorator(fn):
        @wraps(fn)
        @login_required
        def wrapper(*args, **kwargs):
            user = current_user()
            held = set(user.permissions)
            missing = [p for p in required_permissions if p not in held]
            allowed = (not missing) if not any_of else len(missing) != len(required_permissions)
            if not allowed:
                raise ApiError(
                    "You do not have permission to perform this action.",
                    403,
                    code="forbidden",
                    required=list(required_permissions),
                )
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def role_required(*roles):
    def decorator(fn):
        @wraps(fn)
        @login_required
        def wrapper(*args, **kwargs):
            if current_user().role_name not in roles:
                raise ApiError("This area is restricted to specific roles.", 403)
            return fn(*args, **kwargs)

        return wrapper

    return decorator


# ---------------------------------------------------------------------------
# Audit trail
# ---------------------------------------------------------------------------

def audit(action, entity="", entity_id="", detail=None, user=None):
    """Append an immutable audit record (never raises into the request).

    The record is committed immediately: call sites invoke ``audit()`` after
    their own ``db.session.commit()``, and the request-scoped session is torn
    down (discarding anything pending) as soon as the response is sent.
    """
    actor = user or current_user()
    try:
        record = AuditLog(
            user_id=actor.id if actor else None,
            action=action,
            entity=entity,
            entity_id=str(entity_id) if entity_id != "" else "",
            detail=json.dumps(detail, default=str) if detail else "",
            ip=(request.remote_addr or "") if request else "",
        )
        db.session.add(record)
        db.session.commit()
    except Exception:  # pragma: no cover - audit must never break a request
        try:
            db.session.rollback()
        except Exception:
            pass


def client_ip():
    return request.headers.get("X-Forwarded-For", request.remote_addr or "")
