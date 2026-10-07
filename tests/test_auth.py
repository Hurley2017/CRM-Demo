"""Authentication: session lifecycle, credential checks, CSRF hardening."""

from backend.models import User


def payload(response):
    body = response.get_json()
    assert body is not None, "expected a JSON envelope"
    return body


def test_login_returns_user_and_permissions(client):
    response = client.post(
        "/api/auth/login",
        json={"employee_id": "EMP-1001", "password": "Admin@123"},
    )
    assert response.status_code == 200
    body = payload(response)
    assert body["ok"] is True
    assert body["data"]["user"]["employee_id"] == "EMP-1001"
    assert body["data"]["user"]["role"]["name"] == "admin"
    assert "reports.view" in body["data"]["permissions"]
    assert "Welcome back" in body["message"]


def test_login_is_case_insensitive_on_employee_id(client):
    response = client.post(
        "/api/auth/login",
        json={"employee_id": "emp-1002", "password": "Manager@123"},
    )
    assert response.status_code == 200
    assert payload(response)["data"]["user"]["employee_id"] == "EMP-1002"


def test_wrong_password_is_rejected(client):
    response = client.post(
        "/api/auth/login",
        json={"employee_id": "EMP-1001", "password": "not-the-password"},
    )
    assert response.status_code == 401
    body = payload(response)
    assert body["error"]["code"] == "invalid_credentials"
    assert "attempt(s) remaining" in body["error"]["message"]


def test_unknown_employee_is_rejected(client):
    response = client.post(
        "/api/auth/login",
        json={"employee_id": "EMP-9999", "password": "whatever"},
    )
    assert response.status_code == 401
    assert payload(response)["error"]["code"] == "invalid_credentials"


def test_missing_credentials_are_validated(client):
    response = client.post("/api/auth/login", json={"employee_id": "", "password": ""})
    assert response.status_code == 422


def test_repeated_failures_lock_the_account(client, app):
    for _ in range(5):
        client.post(
            "/api/auth/login",
            json={"employee_id": "EMP-1003", "password": "wrong-password"},
        )

    locked = client.post(
        "/api/auth/login",
        json={"employee_id": "EMP-1003", "password": "Desk@12345"},
    )
    assert locked.status_code == 423
    assert payload(locked)["error"]["code"] == "locked"

    with app.app_context():
        user = User.query.filter_by(employee_id="EMP-1003").first()
        assert user.locked_until is not None
    # the unlock_accounts fixture clears the lock again after this test


def test_me_is_anonymous_before_login(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    body = payload(response)
    assert body["data"]["user"] is None
    assert body["data"]["permissions"] == []


def test_me_reflects_the_session_after_login(client):
    client.post("/api/auth/login", json={"employee_id": "EMP-1004", "password": "Lab@12345"})
    response = client.get("/api/auth/me")
    body = payload(response)
    assert body["data"]["user"]["employee_id"] == "EMP-1004"
    assert body["data"]["user"]["role"]["name"] == "technician"
    assert "reports.view" not in body["data"]["permissions"]


def test_logout_clears_the_session(client):
    client.post("/api/auth/login", json={"employee_id": "EMP-1001", "password": "Admin@123"})
    assert client.post("/api/auth/logout").status_code == 200

    body = payload(client.get("/api/auth/me"))
    assert body["data"]["user"] is None

    # protected endpoints are closed again
    assert client.get("/api/dashboard").status_code == 401


def test_session_cookie_is_httponly_and_same_site(client):
    response = client.post(
        "/api/auth/login",
        json={"employee_id": "EMP-1001", "password": "Admin@123"},
    )
    cookie = response.headers.get("Set-Cookie", "")
    assert "HttpOnly" in cookie
    assert "SameSite=Lax" in cookie


def test_unauthenticated_api_calls_return_401(client):
    for path in ("/api/bookings", "/api/patients", "/api/dashboard", "/api/settings"):
        response = client.get(path)
        assert response.status_code == 401, path
        assert payload(response)["error"]["code"] in ("unauthorized", "login_required")


def test_cross_origin_write_is_rejected(client):
    """A browser always attaches Origin on cross-site POSTs - reject them."""
    response = client.post(
        "/api/auth/login",
        json={"employee_id": "EMP-1001", "password": "Admin@123"},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403
    assert payload(response)["error"]["code"] == "csrf"


def test_same_origin_write_is_allowed(client):
    """Origin matching the Host (what the SPA sends) passes the check."""
    response = client.post(
        "/api/auth/login",
        json={"employee_id": "EMP-1001", "password": "Admin@123"},
        headers={"Origin": "http://localhost", "Host": "localhost"},
    )
    assert response.status_code == 200
