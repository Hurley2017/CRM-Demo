"""Booking lifecycle: creation, conflicts, transitions, reschedule, cancel."""

from datetime import date, timedelta


def api(response):
    return response.get_json()


def open_slots_for(client, day):
    response = client.get(f"/api/slots?date={day}")
    if response.status_code != 200:
        return []
    data = api(response)["data"]
    return [slot["start"] for slot in data["slots"] if slot["state"] == "open"]


def first_day_with_slots(client, minimum=1, max_days=21):
    for offset in range(1, max_days + 1):
        day = (date.today() + timedelta(days=offset)).isoformat()
        if len(open_slots_for(client, day)) >= minimum:
            return day
    raise AssertionError("No day with enough open slots in the horizon.")


# ---------------------------------------------------------------- creation


def test_create_booking_returns_pending_with_invoice_and_history(as_role, make_booking):
    client = as_role("receptionist")
    response, payload = make_booking(client)

    body = api(response)
    assert body["ok"] is True
    booking = body["data"]
    assert booking["status"] == "PENDING"
    assert booking["booking_no"].startswith("BK-")
    assert booking["items"], "line items must be priced onto the booking"
    assert booking["invoice"]["status"] == "unpaid"
    assert booking["due"] > 0
    assert booking["history"], "creation writes the first history row"
    assert "created" in body["message"].lower()


def test_double_booking_the_same_slot_is_conflict(as_role, make_booking):
    client = as_role("admin")
    _, payload = make_booking(client)

    clash = client.post("/api/bookings", json=payload)
    assert clash.status_code == 409
    assert api(clash)["error"]["code"] == "slot_taken"
    assert api(clash)["error"]["slot"] == payload["slot_start"]


def test_booking_requires_a_patient_tests_and_slot(as_role, sample_ids):
    client = as_role("receptionist")
    patient_id, product_ids = sample_ids
    day = first_day_with_slots(client)

    assert client.post("/api/bookings", json={
        "booking_date": day, "slot_start": "09:00", "product_ids": product_ids,
    }).status_code == 422

    assert client.post("/api/bookings", json={
        "patient_id": patient_id, "booking_date": day, "slot_start": "09:00",
    }).status_code == 422

    assert client.post("/api/bookings", json={
        "patient_id": patient_id, "booking_date": day, "product_ids": product_ids,
    }).status_code == 422


def test_past_slots_and_out_of_hours_slots_are_rejected(as_role, sample_ids):
    client = as_role("receptionist")
    patient_id, product_ids = sample_ids

    past = client.post("/api/bookings", json={
        "patient_id": patient_id,
        "booking_date": (date.today() - timedelta(days=7)).isoformat(),
        "slot_start": "09:00",
        "product_ids": product_ids,
    })
    assert past.status_code == 422
    assert api(past)["error"]["field"] == "booking_date"
    assert "past" in api(past)["error"]["message"].lower()

    day = first_day_with_slots(client)
    closed = client.post("/api/bookings", json={
        "patient_id": patient_id,
        "booking_date": day,
        "slot_start": "03:00",
        "product_ids": product_ids,
    })
    assert closed.status_code == 422
    assert api(closed)["error"]["field"] == "slot_start"


def test_home_collection_needs_an_address(as_role, sample_ids):
    client = as_role("receptionist")
    patient_id, product_ids = sample_ids
    day = first_day_with_slots(client)

    response = client.post("/api/bookings", json={
        "patient_id": patient_id,
        "booking_date": day,
        "slot_start": open_slots_for(client, day)[0],
        "booking_type": "home",
        "product_ids": product_ids,
    })
    assert response.status_code == 422
    assert api(response)["error"]["field"] == "address"


# ------------------------------------------------------------ transitions


def test_full_lifecycle_reaches_report_ready(as_role, make_booking):
    client = as_role("admin")
    response, _ = make_booking(client)
    booking_id = api(response)["data"]["id"]

    steps = [
        "CONFIRMED", "SAMPLE_COLLECTED", "IN_LAB", "COMPLETED", "REPORT_READY",
    ]
    for target in steps:
        move = client.post(
            f"/api/bookings/{booking_id}/status", json={"status": target}
        )
        assert move.status_code == 200, (target, api(move))
        assert api(move)["data"]["status"] == target

    detail = api(client.get(f"/api/bookings/{booking_id}"))["data"]
    assert detail["status"] == "REPORT_READY"
    assert len(detail["history"]) == len(steps) + 1


def test_illegal_transition_is_rejected_with_409(as_role, make_booking):
    client = as_role("admin")
    response, _ = make_booking(client)
    booking_id = api(response)["data"]["id"]

    skip = client.post(
        f"/api/bookings/{booking_id}/status", json={"status": "IN_LAB"}
    )
    assert skip.status_code == 409
    assert api(skip)["error"]["code"] == "invalid_transition"
    assert "Allowed:" in api(skip)["error"]["message"]


def test_report_ready_is_a_final_state(as_role, make_booking):
    client = as_role("admin")
    response, _ = make_booking(client)
    booking_id = api(response)["data"]["id"]
    for target in ["CONFIRMED", "SAMPLE_COLLECTED", "IN_LAB", "COMPLETED", "REPORT_READY"]:
        assert client.post(
            f"/api/bookings/{booking_id}/status", json={"status": target}
        ).status_code == 200

    again = client.post(
        f"/api/bookings/{booking_id}/status", json={"status": "CONFIRMED"}
    )
    assert again.status_code == 409


def test_receptionist_can_confirm_but_not_run_the_lab(as_role, make_booking):
    client = as_role("receptionist")
    response, _ = make_booking(client)
    booking_id = api(response)["data"]["id"]

    assert client.post(
        f"/api/bookings/{booking_id}/status", json={"status": "CONFIRMED"}
    ).status_code == 200

    blocked = client.post(
        f"/api/bookings/{booking_id}/status", json={"status": "SAMPLE_COLLECTED"}
    )
    assert blocked.status_code == 403
    assert "lab" in api(blocked)["error"]["message"].lower()


def test_technician_runs_the_lab_workflow(as_role, make_booking):
    admin = as_role("admin")
    response, _ = make_booking(admin)
    booking_id = api(response)["data"]["id"]
    assert admin.post(
        f"/api/bookings/{booking_id}/status", json={"status": "CONFIRMED"}
    ).status_code == 200

    technician = as_role("technician")
    for target in ["SAMPLE_COLLECTED", "IN_LAB", "COMPLETED", "REPORT_READY"]:
        move = technician.post(
            f"/api/bookings/{booking_id}/status", json={"status": target}
        )
        assert move.status_code == 200, (target, api(move))


def test_technician_cannot_cancel(as_role, make_booking):
    admin = as_role("admin")
    response, _ = make_booking(admin)
    booking_id = api(response)["data"]["id"]

    technician = as_role("technician")
    blocked = technician.post(
        f"/api/bookings/{booking_id}/cancel", json={"reason": "no permission here"}
    )
    assert blocked.status_code == 403


# ------------------------------------------------------------- cancellation


def test_cancel_requires_a_reason(as_role, make_booking):
    client = as_role("receptionist")
    response, _ = make_booking(client)
    booking_id = api(response)["data"]["id"]

    missing = client.post(f"/api/bookings/{booking_id}/cancel", json={})
    assert missing.status_code == 422
    assert api(missing)["error"]["field"] == "reason"

    too_short = client.post(f"/api/bookings/{booking_id}/cancel", json={"reason": "no"})
    assert too_short.status_code == 422


def test_cancel_records_reason_policy_and_history(as_role, make_booking):
    client = as_role("receptionist")
    response, payload = make_booking(client)
    booking = api(response)["data"]

    cancelled = client.post(
        f"/api/bookings/{booking['id']}/cancel",
        json={"reason": "Patient travelled abroad, will rebook."},
    )
    assert cancelled.status_code == 200

    data = api(cancelled)["data"]
    assert data["status"] == "CANCELLED"
    assert "abroad" in data["cancel_reason"]
    assert data["cancelled_at"]
    assert any(
        entry["to_status"] == "CANCELLED" and "abroad" in (entry["reason"] or "")
        for entry in data["history"]
    )
    assert "Refund" in api(cancelled)["message"] or "cancelled" in api(cancelled)["message"]

    # terminal: no further transitions, no second cancellation
    assert client.post(
        f"/api/bookings/{data['id']}/status", json={"status": "CONFIRMED"}
    ).status_code == 409
    assert client.post(
        f"/api/bookings/{data['id']}/cancel", json={"reason": "changed my mind again"}
    ).status_code == 409


def test_cancelling_frees_the_slot_for_reuse(as_role, make_booking):
    client = as_role("receptionist")
    response, payload = make_booking(client)
    booking_id = api(response)["data"]["id"]

    assert client.post(
        f"/api/bookings/{booking_id}/cancel", json={"reason": "slot no longer needed"}
    ).status_code == 200

    reused = client.post("/api/bookings", json=payload)
    assert reused.status_code == 201


# -------------------------------------------------------------- reschedule


def test_reschedule_moves_the_appointment(as_role, make_booking):
    client = as_role("receptionist")
    response, payload = make_booking(client)
    booking_id = api(response)["data"]["id"]

    day = first_day_with_slots(client)
    new_slot = next(
        slot for slot in open_slots_for(client, day)
        if not (day == payload["booking_date"] and slot == payload["slot_start"])
    )

    moved = client.post(f"/api/bookings/{booking_id}/reschedule", json={
        "booking_date": day, "slot_start": new_slot,
    })
    assert moved.status_code == 200, api(moved)

    data = api(moved)["data"]
    assert data["booking_date"] == day
    assert data["slot_start"] == new_slot
    assert any(
        (entry["reason"] or "").startswith("Rescheduled from")
        for entry in data["history"]
    ), "the default history entry explains what moved and where"


def test_reschedule_to_the_same_slot_is_rejected(as_role, make_booking):
    client = as_role("receptionist")
    response, payload = make_booking(client)
    booking_id = api(response)["data"]["id"]

    same = client.post(f"/api/bookings/{booking_id}/reschedule", json={
        "booking_date": payload["booking_date"],
        "slot_start": payload["slot_start"],
    })
    assert same.status_code == 422
    assert "different" in api(same)["error"]["message"].lower()


def test_reschedule_into_a_taken_slot_conflicts(as_role, make_booking):
    client = as_role("admin")
    day = first_day_with_slots(client, minimum=2)
    slots = open_slots_for(client, day)

    _, first_payload = make_booking(
        client, booking_date=day, slot_start=slots[0]
    )
    second, _ = make_booking(client, booking_date=day, slot_start=slots[1])

    clash = client.post(
        f"/api/bookings/{api(second)['data']['id']}/reschedule",
        json={"booking_date": day, "slot_start": first_payload["slot_start"]},
    )
    assert clash.status_code == 409
    assert api(clash)["error"]["code"] == "slot_taken"


def test_listing_filters_by_status(as_role, make_booking):
    client = as_role("receptionist")
    response, _ = make_booking(client)
    booking_id = api(response)["data"]["id"]
    assert client.post(
        f"/api/bookings/{booking_id}/cancel", json={"reason": "filter test cleanup"}
    ).status_code == 200

    cancelled = api(client.get("/api/bookings?status=CANCELLED&per_page=100"))["data"]
    assert any(b["id"] == booking_id for b in cancelled["items"])

    pending = api(client.get("/api/bookings?status=PENDING&per_page=100"))["data"]
    assert all(b["status"] == "PENDING" for b in pending["items"])
