"""Shared pytest fixtures.

Every run gets a throw-away SQLite database seeded with the same demo data the
app ships with, so tests exercise real roles, patients, products and slots
without touching ``suraksha.db``.
"""

import os
import tempfile
from datetime import date, timedelta

import pytest

import seed as seeder
from backend import create_app
from backend.models import Patient, Product, User, db
from config import Config

#: Demo credentials printed by ``python seed.py``.
CREDENTIALS = {
    "admin": ("EMP-1001", "Admin@123"),
    "manager": ("EMP-1002", "Manager@123"),
    "receptionist": ("EMP-1003", "Desk@12345"),
    "technician": ("EMP-1004", "Lab@12345"),
}


class TestConfig(Config):
    """Isolated database, no CORS, deterministic secret."""

    TESTING = True
    SECRET_KEY = "pytest-secret-key"
    CORS_ORIGINS = []
    WTF_CSRF_ENABLED = False


@pytest.fixture(scope="session")
def app():
    """Application backed by a temporary database file, seeded once."""
    handle, path = tempfile.mkstemp(prefix="suraksha_pytest_", suffix=".db")
    os.close(handle)

    class FileTestConfig(TestConfig):
        DATABASE_URL = f"sqlite:///{path.replace(os.sep, '/')}"
        SQLALCHEMY_DATABASE_URI = DATABASE_URL
        SQLALCHEMY_ENGINE_OPTIONS = {}

    application = create_app(FileTestConfig)

    with application.app_context():
        seeder.seed_settings()
        roles = seeder.seed_roles()
        staff = seeder.seed_staff(roles)
        products = seeder.seed_catalogue()
        patients = seeder.seed_patients()
        seeder.seed_bookings(patients, products, staff)
        seeder.seed_notifications(staff)
        db.session.commit()

    yield application

    with application.app_context():
        db.session.remove()
    try:
        os.remove(path)
    except OSError:  # pragma: no cover - best effort cleanup
        pass


@pytest.fixture()
def client(app):
    """Unauthenticated test client."""
    return app.test_client()


@pytest.fixture()
def as_role(app):
    """Factory returning a fresh, logged-in client for a demo role."""

    def login(role: str):
        employee_id, password = CREDENTIALS[role]
        logged_in = app.test_client()
        response = logged_in.post(
            "/api/auth/login",
            json={"employee_id": employee_id, "password": password},
        )
        assert response.status_code == 200, response.get_json()
        return logged_in

    return login


@pytest.fixture(autouse=True)
def unlock_accounts(app):
    """Failed logins increment counters - reset them around every test."""
    yield
    with app.app_context():
        for user in User.query.all():
            user.failed_attempts = 0
            user.locked_until = None
        db.session.commit()


@pytest.fixture()
def sample_ids(app):
    """``(patient_id, [product_id, ...])`` pulled from the seeded data."""
    with app.app_context():
        patient = Patient.query.order_by(Patient.id).first()
        products = Product.query.order_by(Product.id).limit(2).all()
        assert patient is not None and len(products) == 2
        return patient.id, [p.id for p in products]


def open_slot(client, max_days: int = 21):
    """First bookable ``(date, slot_start)`` in the next few weeks."""
    for offset in range(1, max_days + 1):
        day = (date.today() + timedelta(days=offset)).isoformat()
        response = client.get(f"/api/slots?date={day}")
        if response.status_code != 200:
            continue
        data = response.get_json().get("data") or {}
        for slot in data.get("slots", []):
            if slot.get("state") == "open":
                return day, slot["start"]
    raise AssertionError("No open slot found in the booking horizon.")


def booking_payload(client, patient_id, product_ids, **overrides):
    """Body accepted by ``POST /api/bookings`` for a fresh slot."""
    day, slot = open_slot(client)
    payload = {
        "patient_id": patient_id,
        "booking_date": day,
        "slot_start": slot,
        "booking_type": "center",
        "phone": "+91 9000000000",
        "priority": "routine",
        "product_ids": product_ids[:1],
    }
    payload.update(overrides)
    return payload


@pytest.fixture()
def make_booking(app, sample_ids):
    """Factory: ``make_booking(client)`` -> ``(response, payload)``."""

    def build(client, **overrides):
        patient_id, product_ids = sample_ids
        payload = booking_payload(client, patient_id, product_ids, **overrides)
        response = client.post("/api/bookings", json=payload)
        assert response.status_code == 201, response.get_json()
        return response, payload

    return build
