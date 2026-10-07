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
from urllib.parse import unquote

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


def _apply_original_path(environ):
    """Restore the visitor's real path after a Vercel rewrite.

    ``vercel.json`` routes every request through a catch-all rewrite that
    appends the original path as ``__sd_path`` (``/patients/42`` becomes
    ``/api/index?__sd_path=/patients/42``).  Depending on Vercel's internal
    routing the function may observe either the original path or the
    rewrite destination (``/api/index``); normalising here makes both
    deliveries behave identically, and the leftover query string stays
    intact so API filters keep working.  No-op outside Vercel.
    """
    if not ON_VERCEL:
        return
    query = environ.get("QUERY_STRING") or ""
    kept, original = [], None
    for part in query.split("&"):
        if part.startswith("__sd_path="):
            original = part[len("__sd_path="):]
        elif part:
            kept.append(part)
    if original is None:
        # Direct invocation of the function route without a rewrite:
        # treat it as the SPA entry point.
        if environ.get("PATH_INFO", "").rstrip("/") in ("/api/index", "/api/index.py"):
            environ["PATH_INFO"] = "/"
        return
    path = unquote(original)
    if not path.startswith("/"):
        path = "/" + path
    environ["PATH_INFO"] = path
    environ["QUERY_STRING"] = "&".join(kept)


class _RewrittenPathMiddleware:
    """WSGI wrapper that applies :func:`_apply_original_path` before Flask routes."""

    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        _apply_original_path(environ)
        return self.wsgi_app(environ, start_response)


app.wsgi_app = _RewrittenPathMiddleware(app.wsgi_app)


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
