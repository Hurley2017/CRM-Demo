"""Role based access control - every guard in the API surface."""

from backend.models import ROLE_PERMISSIONS


def test_permissions_match_the_role_matrix(as_role, app):
    for role in ("admin", "manager", "receptionist", "technician"):
        client = as_role(role)
        body = client.get("/api/auth/me").get_json()
        granted = sorted(body["data"]["permissions"])
        assert granted == sorted(ROLE_PERMISSIONS[role]), role


def test_admin_reaches_every_admin_area(as_role):
    client = as_role("admin")
    assert client.get("/api/users").status_code == 200
    assert client.get("/api/audit").status_code == 200
    assert client.get("/api/reports/overview").status_code == 200
    assert client.get("/api/settings").status_code == 200


def test_manager_reads_reports_and_staff_directory_but_cannot_administer(as_role):
    client = as_role("manager")
    assert client.get("/api/reports/overview").status_code == 200
    assert client.get("/api/users").status_code == 200  # staff directory is visible
    assert client.post(
        "/api/users", json={"name": "Nope", "email": "nope@suraksha.test"}
    ).status_code == 403  # ... but accounts are managed by admins only
    assert client.put("/api/settings", json={}).status_code == 403


def test_receptionist_is_denied_reports_users_audit_and_settings(as_role):
    client = as_role("receptionist")
    for path in ("/api/reports/overview", "/api/users", "/api/audit"):
        response = client.get(path)
        assert response.status_code == 403, path
        assert response.get_json()["error"]["code"] == "forbidden"

    assert client.put("/api/settings", json={}).status_code == 403
    assert client.post("/api/users", json={}).status_code == 403


def test_receptionist_can_run_the_front_desk(as_role):
    client = as_role("receptionist")
    assert client.get("/api/bookings").status_code == 200
    assert client.get("/api/patients").status_code == 200
    assert client.post(
        "/api/patients",
        json={"name": "Walk In", "phone": "+91 9111111111", "gender": "other"},
    ).status_code == 201


def test_technician_is_denied_reports_users_and_writes(as_role, sample_ids):
    client = as_role("technician")
    assert client.get("/api/reports/overview").status_code == 403
    assert client.get("/api/users").status_code == 403
    assert client.get("/api/audit").status_code == 403

    patient_id, product_ids = sample_ids
    assert client.post(
        "/api/bookings",
        json={
            "patient_id": patient_id,
            "booking_date": "2030-01-07",
            "slot_start": "09:00",
            "booking_type": "center",
            "phone": "+91 9000000000",
            "product_ids": product_ids[:1],
        },
    ).status_code == 403

    assert client.post(
        "/api/products",
        json={"code": "TECH-1", "name": "Not allowed", "price": 10},
    ).status_code == 403


def test_forbidden_response_names_the_missing_permission(as_role):
    body = as_role("receptionist").get("/api/users").get_json()
    assert body["error"]["required"] == ["users.view"]


def test_anonymous_caller_gets_401_not_403(client):
    """Auth must be resolved before permissions so callers can re-login."""
    response = client.get("/api/users")
    assert response.status_code == 401
