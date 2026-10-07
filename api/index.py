"""Vercel serverless entry point (WSGI).

Vercel's zero-configuration Flask support finds the top-level ``app`` in this
file and routes every incoming request through it, so the exact application
factory used by ``run.py`` serves the JSON API and hosts the SPA on Vercel.

Database strategy on Vercel
---------------------------
The deployment bundle is read-only and ``/tmp`` is wiped whenever a new
instance starts, so when no ``DATABASE_URL`` is configured we point SQLite at
``/tmp/suraksha.db`` and seed the demo dataset on first boot (the whole
dataset lands in one transaction, so concurrent cold starts cannot
interleave).  Set ``DATABASE_URL`` in the project settings to move to a
durable cloud database (Turso, Neon, Supabase, ...) - nothing else changes.
"""

import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# Vercel exports VERCEL=1 in every deployment (and in `vercel dev`).
ON_VERCEL = bool(os.environ.get("VERCEL") or os.environ.get("VERCEL_SANDBOX"))


def _configure_database():
    """Move SQLite out of the read-only bundle into a writable directory.

    Must run before ``backend`` is imported: ``config.py`` reads
    ``DATABASE_URL`` (and ``load_dotenv()`` only fills variables that are
    still unset at that point).
    """
    if not ON_VERCEL or os.environ.get("DATABASE_URL"):
        return
    path = os.path.join(tempfile.gettempdir(), "suraksha.db").replace("\\", "/")
    os.environ["DATABASE_URL"] = f"sqlite:///{path}"


_configure_database()

from backend import create_app  # noqa: E402  (needs DATABASE_URL set first)
from backend.models import User, db  # noqa: E402

app = create_app()


def _seed_demo_data():
    """Seed the demo dataset when booting against an empty database.

    Without this an operator would have no way to sign in: user creation is
    itself a permission-gated endpoint.  Runs once per instance at import
    time (``/tmp`` is per instance on SQLite, and the single transaction
    keeps two cold starts on a shared cloud database from interleaving).
    """
    if not ON_VERCEL:
        return
    with app.app_context():
        try:
            if User.query.first() is not None:
                return
            import seed  # the demo dataset lives next to run.py

            seed.seed_settings()
            roles = seed.seed_roles()
            staff = seed.seed_staff(roles)
            products = seed.seed_catalogue()
            patients = seed.seed_patients()
            seed.seed_bookings(patients, products, staff)
            seed.seed_notifications(staff)
            seed.seed_audit(staff)
            db.session.commit()
            print("[suraksha] empty database seeded with the demo dataset")
        except Exception as exc:  # pragma: no cover - never brick the instance
            db.session.rollback()
            print(f"[suraksha] demo seed skipped: {exc}")


_seed_demo_data()
