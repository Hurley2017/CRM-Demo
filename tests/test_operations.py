"""Billing, reporting, settings, notifications and operational endpoints."""


def api(response):
    return response.get_json()


# ------------------------------------------------------------------ billing


def test_billing_lists_invoices_and_summary(as_role):
    client = as_role("receptionist")
    listing = api(client.get("/api/billing/invoices?per_page=5"))["data"]
    assert listing["items"] and listing["total"] >= len(listing["items"])
    assert {"invoice_no", "status", "total", "due"} <= set(listing["items"][0])

    summary = api(client.get("/api/billing/summary"))["data"]
    assert summary, "summary must report collections/outstanding"


def test_payment_then_full_refund(as_role, make_booking):
    client = as_role("admin")
    response, _ = make_booking(client)
    booking = api(response)["data"]
    invoice_id = booking["invoice"]["id"]
    total = booking["invoice"]["total"]

    paid = client.post("/api/billing/payments", json={
        "invoice_id": invoice_id, "amount": total, "method": "upi",
        "reference": "UPI-TEST-1",
    })
    assert paid.status_code == 201, api(paid)
    assert api(paid)["data"]["status"] == "paid"
    assert api(paid)["data"]["due"] == 0

    over = client.post("/api/billing/payments", json={
        "invoice_id": invoice_id, "amount": 1, "method": "cash",
    })
    assert over.status_code == 422, "cannot overpay a settled invoice"

    refunded = client.post(
        f"/api/billing/invoices/{invoice_id}/refund",
        json={"reason": "Sample haemolysed in transit"},
    )
    assert refunded.status_code == 200, api(refunded)
    assert api(refunded)["data"]["status"] == "refunded"
    assert api(refunded)["data"]["due"] == total
    assert "Refund" in api(refunded)["message"]


def test_refund_requires_a_reason(as_role, make_booking):
    client = as_role("admin")
    response, _ = make_booking(client)
    invoice_id = api(response)["data"]["invoice"]["id"]
    assert client.post(
        "/api/billing/payments",
        json={"invoice_id": invoice_id, "amount": 10, "method": "cash"},
    ).status_code == 201

    missing = client.post(f"/api/billing/invoices/{invoice_id}/refund", json={})
    assert missing.status_code == 422
    assert api(missing)["error"]["field"] == "reason"


def test_refund_before_any_payment_conflicts(as_role, make_booking):
    client = as_role("admin")
    response, _ = make_booking(client)
    invoice_id = api(response)["data"]["invoice"]["id"]

    response = client.post(
        f"/api/billing/invoices/{invoice_id}/refund",
        json={"reason": "Nothing to refund yet"},
    )
    assert response.status_code == 409


# ------------------------------------------------------- reports & dashboard


def test_dashboard_reports_kpis_and_schedule(as_role):
    client = as_role("admin")
    data = api(client.get("/api/dashboard"))["data"]
    assert {"kpis", "today_schedule"} <= set(data)
    assert data["kpis"]["bookings_today"] >= 0
    assert isinstance(data["kpis"]["revenue_month"], (int, float))


def test_reports_overview_returns_a_daily_series(as_role):
    client = as_role("admin")
    data = api(client.get("/api/reports/overview?period=7d"))["data"]

    assert {"from", "to", "revenue", "series", "by_status"} <= set(data)
    assert len(data["series"]) == 7
    assert data["series"][0]["bookings"] >= 0
    assert {"date", "label", "bookings", "revenue"} <= set(data["series"][0])


def test_reports_reject_malformed_dates(as_role):
    client = as_role("admin")
    response = client.get("/api/reports/overview?from=not-a-date&to=2026-01-01")
    assert response.status_code == 422


def test_reports_export_returns_csv(as_role):
    client = as_role("admin")
    response = client.get("/api/reports/export?days=30")
    assert response.status_code == 200
    assert response.mimetype.startswith("text/csv")
    body = response.get_data(as_text=True)
    assert body.splitlines()[0].startswith("Booking No")
    assert len(body.splitlines()) > 1


# --------------------------------------------------- settings & operations


def test_settings_round_trip(as_role, app):
    client = as_role("admin")
    settings = api(client.get("/api/settings"))["data"]
    assert any(s["key"] == "center_name" for s in settings)

    saved = client.put("/api/settings", json={"center_name": "Suraksha Diagnostic"})
    assert saved.status_code == 200
    assert api(saved)["message"]

    changed = client.put("/api/settings", json={"cancellation_window_hours": 4})
    assert api(changed)["message"] == "Settings saved."

    value = next(
        s for s in api(client.get("/api/settings"))["data"]
        if s["key"] == "cancellation_window_hours"
    )
    assert int(value["value"]) == 4

    # restore the seeded value
    assert client.put(
        "/api/settings", json={"cancellation_window_hours": 2}
    ).status_code == 200


def test_notifications_are_scoped_and_markable(as_role):
    client = as_role("admin")
    data = api(client.get("/api/notifications"))["data"]
    assert {"items", "unread"} <= set(data)
    assert data["unread"] >= 0

    if data["items"]:
        assert client.post("/api/notifications/read-all").status_code == 200
        assert api(client.get("/api/notifications"))["data"]["unread"] == 0


def test_audit_log_records_operations_with_actor(as_role):
    client = as_role("admin")
    data = api(client.get("/api/audit?per_page=10"))["data"]
    assert data["items"], "login and booking activity must be audited"
    entry = data["items"][0]
    assert {"action", "created_at"} <= set(entry)

    filtered = api(client.get("/api/audit?action=login&per_page=10"))["data"]
    assert all(row["action"] == "login" for row in filtered["items"])

    searched = api(client.get("/api/audit?q=EMP-1001&per_page=10"))["data"]
    assert searched["items"], "search by employee id must match"


def test_global_search_groups_results(as_role):
    client = as_role("admin")
    data = api(client.get("/api/search?q=pat-"))["data"]
    assert set(data) == {"patients", "bookings", "products"}
    assert data["patients"], "type-ahead finds seeded patients by code"
