"""The Vercel entry point (`api/index.py`) boots a working, seeded app.

Simulates the serverless environment in a subprocess: ``VERCEL=1``, no
``DATABASE_URL`` and a writable temp directory. Asserts that SQLite lands in
the writable path, that first boot seeds the demo dataset (otherwise nobody
could sign in) and that both the SPA and the API answer.
"""

import json
import os
import subprocess
import sys
import textwrap

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SCRIPT = textwrap.dedent(
    """
    import json

    from api.index import app

    client = app.test_client()

    login = client.post(
        "/api/auth/login",
        json={"employee_id": "EMP-1001", "password": "Admin@123"},
    )
    # The Vercel config marks the session cookie Secure; hand it back
    # explicitly so the plain-http test client round-trips it either way.
    session_cookie = next(
        (c.split(";")[0] for c in login.headers.getlist("Set-Cookie")
         if c.startswith("session=")),
        None,
    )
    me = client.get("/api/auth/me", headers={"Cookie": session_cookie or ""})

    print("VERCEL_RESULT=" + json.dumps({
        "spa": client.get("/").status_code,
        "deep_link": client.get("/bookings").status_code,
        "css": client.get("/css/tokens.css").status_code,
        "js": client.get("/js/app.js").status_code,
        # Vercel's catch-all rewrite hands the function either the original
        # path or /api/index plus __sd_path=... - both must route alike.
        "rewrite_spa": client.get("/api/index?__sd_path=/bookings&tab=visits").status_code,
        "rewrite_api": client.get("/api/index?__sd_path=/api/auth/me").status_code,
        "rewrite_idem": client.get("/bookings?__sd_path=/bookings").status_code,
        "direct": client.get("/api/index").status_code,
        "login": login.status_code,
        "me": me.status_code,
        "dashboard": client.get(
            "/api/dashboard", headers={"Cookie": session_cookie or ""}
        ).status_code,
    }))
    """
)


def test_vercel_entry_seeds_and_serves(tmp_path):
    env = os.environ.copy()
    env["VERCEL"] = "1"
    env.pop("DATABASE_URL", None)
    # Drive tempfile.gettempdir() (used for the SQLite file) to a scratch dir.
    for key in ("TEMP", "TMP", "TMPDIR"):
        env[key] = str(tmp_path)

    proc = subprocess.run(
        [sys.executable, "-c", SCRIPT],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert proc.returncode == 0, f"stderr:\n{proc.stderr}"

    # First boot created a writable database and seeded the demo dataset.
    assert (tmp_path / "suraksha.db").exists()
    assert "seeded with the demo dataset" in proc.stdout

    line = next(l for l in proc.stdout.splitlines() if l.startswith("VERCEL_RESULT="))
    result = json.loads(line.split("=", 1)[1])
    assert result["spa"] == 200
    assert result["deep_link"] == 200
    assert result["css"] == 200
    assert result["js"] == 200
    assert result["rewrite_spa"] == 200
    # The real auth endpoint answers 200 (session in the test cookie jar) or
    # 401 (no session) - never the JSON 404 a mis-routed /api/index would give.
    assert result["rewrite_api"] in (200, 401)
    assert result["rewrite_idem"] == 200
    assert result["direct"] == 200
    assert result["login"] == 200
    assert result["me"] == 200
    assert result["dashboard"] == 200


def test_vercel_entry_reuses_configured_database(tmp_path):
    """With DATABASE_URL set the bootstrap must leave it alone."""
    env = os.environ.copy()
    env["VERCEL"] = "1"
    env["DATABASE_URL"] = f"sqlite:///{(tmp_path / 'explicit.db').as_posix()}"

    proc = subprocess.run(
        [sys.executable, "-c",
         "from api.index import app\n"
         "print('DB=' + app.config['DATABASE_URL'])\n"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, f"stderr:\n{proc.stderr}"
    assert f"DB=sqlite:///{(tmp_path / 'explicit.db').as_posix()}" in proc.stdout


def test_database_url_normalizes_managed_postgres(monkeypatch):
    """Vercel's Neon integration hands over `postgres://`; SQLAlchemy 2 needs
    an explicit driver, and psycopg (v3) is what we ship."""
    from config import _database_url

    monkeypatch.setenv(
        "DATABASE_URL", "postgres://user:pass@ep-abc.aws.neon.tech/neondb?sslmode=require"
    )
    monkeypatch.delenv("POSTGRES_URL", raising=False)
    assert _database_url() == (
        "postgresql+psycopg://user:pass@ep-abc.aws.neon.tech/neondb?sslmode=require"
    )


def test_database_url_falls_back_to_postgres_url(monkeypatch):
    from config import _database_url

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("POSTGRES_URL", "postgresql://user:pass@host/db")
    assert _database_url() == "postgresql+psycopg://user:pass@host/db"


def test_database_url_defaults_to_local_sqlite(monkeypatch):
    from config import _database_url

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTGRES_URL", raising=False)
    assert _database_url().endswith("/suraksha.db")
