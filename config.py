"""Environment driven application configuration.

The database is deliberately addressed through a single constant so the
project can move from local SQLite to a managed cloud database later by
only changing ``DATABASE_URL`` (no code changes required).
"""

import os

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


def _default_database_url() -> str:
    path = os.path.join(BASE_DIR, "suraksha.db").replace("\\", "/")
    return f"sqlite:///{path}"


def _database_url() -> str:
    # Vercel's Postgres (Neon) marketplace integration injects DATABASE_URL;
    # older stores called it POSTGRES_URL. Either beats the local SQLite file.
    url = (
        os.environ.get("DATABASE_URL")
        or os.environ.get("POSTGRES_URL")
        or ""
    ).strip()
    # Managed integrations still emit the legacy scheme, and SQLAlchemy 2 needs
    # an explicit driver - requirements.txt ships psycopg (v3).
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url or _default_database_url()


class Config:
    """Base configuration shared by every environment."""

    SECRET_KEY = os.environ.get("SECRET_KEY", "suraksha-diagnostic-dev-key")

    # Single source of truth for the database. Flip this one value to move
    # from local SQLite to a managed cloud database - no code changes.
    DATABASE_URL = _database_url()
    SQLALCHEMY_DATABASE_URI = DATABASE_URL
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 1800,
    }

    # --- sessions / cookies -------------------------------------------------
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    # Vercel (and any HTTPS deployment) should mark the cookie Secure unless
    # the operator overrides it explicitly.
    SESSION_COOKIE_SECURE = (
        os.environ.get("SESSION_COOKIE_SECURE", "1" if os.environ.get("VERCEL") else "0")
        == "1"
    )
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 12  # 12 hours

    # --- CORS (only relevant when the SPA is hosted separately) -------------
    CORS_ORIGINS = [
        o.strip()
        for o in os.environ.get("CORS_ORIGINS", "").split(",")
        if o.strip()
    ]

    # --- domain settings ----------------------------------------------------
    TIMEZONE = os.environ.get("TIMEZONE", "Asia/Kolkata")

    JSON_SORT_KEYS = False
    MAX_CONTENT_LENGTH = 2 * 1024 * 1024  # 2 MB payload cap


class TestingConfig(Config):
    TESTING = True
    DATABASE_URL = "sqlite:///:memory:"
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_ENGINE_OPTIONS = {}
    CORS_ORIGINS = []
    WTF_CSRF_ENABLED = False
