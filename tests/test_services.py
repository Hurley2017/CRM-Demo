"""Timezone-sensitive domain rules: slot availability and cancellation policy.

These cover the "UTC vs wall clock" class of bugs - slot availability and the
cancellation window must reason about the time as the front desk sees it.
"""

from datetime import datetime, time, timedelta

import pytest

from backend import services
from backend.models import APP_TIMEZONE, Booking, localdate, localnow


def working_day(app):
    """The next day in the next fortnight that actually has bookable hours."""
    cursor = localdate() + timedelta(days=1)
    with app.app_context():
        for offset in range(14):
            day = cursor + timedelta(days=offset)
            if services.generate_slots(day):
                return day
    raise AssertionError("The seeded schedule produced no slots in 14 days.")


@pytest.fixture()
def freeze_clock(monkeypatch):
    """Pin the centre's wall clock so assertions do not depend on run time."""

    def freeze(moment: datetime):
        monkeypatch.setattr(services, "wallclock_now", lambda: moment)
        monkeypatch.setattr(services, "localdate", lambda: moment.date())

    return freeze


def test_wallclock_now_is_local_and_naive():
    naive = services.wallclock_now()
    assert naive.tzinfo is None
    assert naive.hour == localnow().hour
    assert localdate() == localnow().date()


def test_slots_in_the_past_today_are_not_bookable(app, freeze_clock):
    day = working_day(app)
    freeze_clock(datetime.combine(day, time(10, 0)))

    with app.app_context():
        data = services.availability(day)

    states = {slot["start"]: slot for slot in data["slots"]}
    assert states["09:00"]["state"] == "unavailable"
    assert states["09:00"]["reason"] == "past"

    later = [slot for slot in data["slots"] if slot["start"] > "10:00"]
    assert later, "the schedule should still have slots after 10:00"
    assert all(slot["reason"] != "past" for slot in later)
    assert data["is_today"] is True
    assert data["closed"] is False


def test_tomorrow_is_not_treated_as_today(app, freeze_clock):
    day = working_day(app)
    freeze_clock(datetime.combine(day - timedelta(days=1), time(22, 0)))

    with app.app_context():
        data = services.availability(day)

    assert data["is_today"] is False
    # nothing has happened yet on a future day - every slot is still ahead
    assert all(slot["reason"] != "past" for slot in data["slots"])


def test_cancellation_window_is_measured_in_local_time(app, freeze_clock):
    day = working_day(app)
    booking = Booking(booking_date=day, slot_start="09:00", paid_amount=1200.0)

    with app.app_context():
        # one hour before the slot: inside the default 2h window => late
        freeze_clock(datetime.combine(day, time(9, 0)) - timedelta(hours=1))
        late = services.cancellation_policy(booking)
        assert late["late"] is True
        assert late["refundable"] == 0.0
        assert "late fee" in late["message"]

        # six hours ahead: outside the window => full refund
        freeze_clock(datetime.combine(day, time(9, 0)) - timedelta(hours=6))
        early = services.cancellation_policy(booking)
        assert early["late"] is False
        assert early["refundable"] == 1200.0
        assert early["hours_before_slot"] == 6.0


def test_localdate_tracks_the_configured_zone():
    assert localdate() == localnow().date()
    assert APP_TIMEZONE is not None
