"""Flask application factory."""

import os

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from sqlalchemy import inspect, text

from config import Config
from .auth import ApiError, load_current_user
from .models import db

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")


def create_app(config_class=Config):
    app = Flask(__name__, static_folder=None)
    app.config.from_object(config_class)

    db.init_app(app)

    if app.config.get("CORS_ORIGINS"):
        CORS(
            app,
            resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
            supports_credentials=True,
        )

    # Blueprints ------------------------------------------------------------
    from .routes.auth import bp as auth_bp
    from .routes.users import bp as users_bp
    from .routes.patients import bp as patients_bp
    from .routes.products import bp as products_bp
    from .routes.slots import bp as slots_bp
    from .routes.bookings import bp as bookings_bp
    from .routes.billing import bp as billing_bp
    from .routes.dashboard import bp as dashboard_bp
    from .routes.reports import bp as reports_bp
    from .routes.admin import bp as admin_bp

    for blueprint in (
        auth_bp, users_bp, patients_bp, products_bp, slots_bp,
        bookings_bp, billing_bp, dashboard_bp, reports_bp, admin_bp,
    ):
        app.register_blueprint(blueprint)

    # Request lifecycle -----------------------------------------------------
    @app.before_request
    def _before_request():
        # CSRF hardening: browsers always send Origin on cross-site POSTs.
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            origin = request.headers.get("Origin")
            if origin:
                host = request.headers.get("Host", "")
                if host and not origin.rstrip("/").endswith(host):
                    from .auth import error as api_error
                    return api_error("Cross-origin request rejected.", 403, code="csrf")
        load_current_user()

    @app.context_processor
    def _inject_globals():
        return {"app_name": "Suraksha Diagnostic"}

    # Error handling --------------------------------------------------------
    @app.errorhandler(ApiError)
    def _handle_api_error(exc):
        return jsonify({
            "ok": False,
            "error": {"code": exc.code, "message": exc.message, **exc.extra},
        }), exc.status

    @app.errorhandler(404)
    def _handle_404(exc):
        if request.path.startswith("/api/"):
            return jsonify({
                "ok": False,
                "error": {"code": "not_found", "message": "Resource not found."},
            }), 404
        return _serve_spa(None)

    @app.errorhandler(405)
    def _handle_405(exc):
        if request.path.startswith("/api/"):
            return jsonify({
                "ok": False,
                "error": {"code": "method_not_allowed", "message": "Method not allowed."},
            }), 405
        return _serve_spa(None)

    @app.errorhandler(413)
    def _handle_413(exc):
        return jsonify({
            "ok": False,
            "error": {"code": "payload_too_large", "message": "Payload too large."},
        }), 413

    @app.errorhandler(500)
    def _handle_500(exc):
        db.session.rollback()
        if request.path.startswith("/api/"):
            return jsonify({
                "ok": False,
                "error": {"code": "server_error", "message": "Unexpected server error."},
            }), 500
        return _serve_spa(None)

    # SPA hosting -----------------------------------------------------------
    def _serve_spa(path):
        if path and os.path.isfile(os.path.join(FRONTEND_DIR, path)):
            return send_from_directory(FRONTEND_DIR, path)
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def spa(path):
        if path.startswith("api/"):
            return jsonify({
                "ok": False,
                "error": {"code": "not_found", "message": "Resource not found."},
            }), 404
        return _serve_spa(path)

    # Database --------------------------------------------------------------
    _ensure_schema(app)

    return app


def _ensure_schema(app):
    """Create tables on first run (safe no-op afterwards)."""
    with app.app_context():
        inspector = inspect(db.engine)
        if not inspector.has_table("users"):
            db.create_all()
        else:
            # Lightweight column migration for evolved schemas.
            _sync_columns(app)


def _sync_columns(app):
    """Add any missing columns to an existing database (dev convenience)."""
    inspector = inspect(db.engine)
    existing = {
        name: {c["name"] for c in inspector.get_columns(name)}
        for name in inspector.get_table_names()
    }
    changed = False
    for table in db.metadata.tables.values():
        known = existing.get(table.name)
        if known is None:
            db.create_all(tables=[table])
            changed = True
            continue
        for column in table.columns:
            if column.name in known:
                continue
            col_type = column.type.compile(db.engine.dialect)
            parts = [f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}']
            if column.default is not None and column.default.arg is not None:
                parts.append(f"DEFAULT '{column.default.arg}'")
            elif column.nullable:
                parts.append("NULL")
            with db.engine.begin() as conn:
                conn.execute(text(" ".join(parts)))
            changed = True
    if changed:
        db.session.commit()
