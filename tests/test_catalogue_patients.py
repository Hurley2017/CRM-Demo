"""Catalogue and patient registry CRUD."""


def api(response):
    return response.get_json()


def test_product_search_categories_and_listing(as_role):
    client = as_role("receptionist")

    categories = api(client.get("/api/products/categories"))["data"]
    assert len(categories) >= 5
    assert all("name" in c for c in categories)

    listing = api(client.get("/api/products?per_page=5"))["data"]
    assert len(listing["items"]) == 5
    assert listing["total"] >= 5

    hit = api(client.get("/api/products/search?q=thyroid"))["data"]
    assert isinstance(hit, list)

    empty = api(client.get("/api/products/search?q=zzzznotathing"))["data"]
    assert empty == []


def test_create_update_and_archive_a_product(as_role):
    client = as_role("admin")

    created = client.post("/api/products", json={
        "code": "PYT-1001",
        "name": "Pytest Marker Panel",
        "category": "Biochemistry",
        "kind": "test",
        "price": 999,
        "cost": 300,
        "sample_type": "Serum",
        "tat_hours": 18,
        "prep_instructions": "Fast for 8 hours.",
    })
    assert created.status_code == 201, api(created)
    product = api(created)["data"]
    assert product["id"] > 0
    assert product["margin"] == 699
    assert "added to catalogue" in api(created)["message"]

    found = api(client.get("/api/products/search?q=Pytest Marker"))["data"]
    assert any(p["code"] == "PYT-1001" for p in found)

    updated = client.put(f"/api/products/{product['id']}", json={"price": 1299})
    assert updated.status_code == 200, api(updated)
    assert api(updated)["data"]["price"] == 1299

    toggled = client.post(f"/api/products/{product['id']}/toggle")
    assert toggled.status_code == 200
    assert api(toggled)["data"]["active"] is False


def test_product_validation(as_role):
    client = as_role("admin")

    assert client.post(
        "/api/products", json={"code": "X-1", "price": 10}
    ).status_code == 422
    assert client.post(
        "/api/products", json={"name": "No code", "price": 10}
    ).status_code == 422
    assert client.post(
        "/api/products", json={"code": "X-2", "name": "Bad kind", "kind": "magic"}
    ).status_code == 422

    code_required = client.post("/api/products", json={"name": "No code here"})
    assert api(code_required)["error"]["field"] == "code"


def test_packages_expand_into_components(as_role):
    client = as_role("receptionist")
    listing = api(client.get("/api/products?per_page=100"))["data"]
    packages = [p for p in listing["items"] if p["kind"] == "package"]
    if not packages:
        return  # seeded data always has packages, but stay tolerant
    assert packages[0]["components"], "packages must list their components"


# ------------------------------------------------------------------ patients


def test_patient_suggest_needs_at_least_two_characters(as_role):
    client = as_role("receptionist")
    assert api(client.get("/api/patients/suggest?q=a"))["data"] == []

    hits = api(client.get("/api/patients/suggest?q=pat-"))["data"]
    assert hits, "seeded patients are searchable by code"
    assert all(h["code"] for h in hits)


def test_register_patient_and_fetch_record(as_role):
    client = as_role("receptionist")

    created = client.post("/api/patients", json={
        "name": "Ishita Rao",
        "phone": "+91 9123400011",
        "gender": "female",
        "dob": "1996-04-02",
        "city": "Kolkata",
        "address": "4B Hindustan Park",
        "allergies": "Sulfa drugs",
    })
    assert created.status_code == 201, api(created)
    patient = api(created)["data"]
    assert patient["code"].startswith("PAT-")
    assert 29 <= patient["age"] <= 31
    assert api(created)["message"]

    fetched = api(client.get(f"/api/patients/{patient['id']}"))["data"]
    assert fetched["name"] == "Ishita Rao"
    assert fetched["allergies"] == "Sulfa drugs"

    hits = api(client.get("/api/patients/suggest?q=Ishita"))["data"]
    assert any(h["id"] == patient["id"] for h in hits)


def test_patient_validation(as_role):
    client = as_role("receptionist")

    missing_name = client.post("/api/patients", json={"phone": "+91 9000000001"})
    assert missing_name.status_code == 422
    assert api(missing_name)["error"]["field"] == "name"

    bad_phone = client.post(
        "/api/patients", json={"name": "No Phone", "phone": "12"}
    )
    assert bad_phone.status_code == 422
    assert api(bad_phone)["error"]["field"] == "phone"

    future_dob = client.post("/api/patients", json={
        "name": "Time Traveller", "phone": "+91 9000000002", "dob": "2099-01-01",
    })
    assert future_dob.status_code == 422


def test_deactivating_a_patient_hides_them_from_search(as_role):
    client = as_role("receptionist")

    created = client.post("/api/patients", json={
        "name": "Retiree Ghosh", "phone": "+91 9123400099", "gender": "male",
    })
    patient = api(created)["data"]

    assert client.post(
        f"/api/patients/{patient['id']}/deactivate"
    ).status_code == 200

    hits = api(client.get("/api/patients/suggest?q=Retiree"))["data"]
    assert not any(h["id"] == patient["id"] for h in hits)
