# Suraksha Diagnostic — Employee Portal

A production-shaped internal portal for a diagnostic centre: front desk, lab and
management all work from one place. Employees sign in with their employee ID,
search the test catalogue, book and modify appointments for patients, move
bookings through the lab pipeline, bill them and audit everything that happened.

**Stack:** Flask + SQLAlchemy (SQLite today, any SQL database tomorrow) with a
vanilla-JavaScript SPA — no build step, no node_modules, no bundler.

---

## Quick start

```bash
pip install -r requirements.txt
python seed.py          # loads the demo dataset (skip if the DB already exists)
python run.py           # http://localhost:5000
```

Force a clean dataset at any time:

```bash
python seed.py --force
```

### Demo credentials

| Role | Employee ID | Password | Sees |
|---|---|---|---|
| Administrator | `EMP-1001` | `Admin@123` | Everything |
| Centre Manager | `EMP-1002` | `Manager@123` | Reports, audit, staff directory |
| Receptionist | `EMP-1003` | `Desk@12345` | Front desk: patients, bookings, billing |
| Lab Technician | `EMP-1004` | `Lab@12345` | Lab workflow only |

The login screen has one-click chips for each account.

---

## What it does

- **Authentication** — employee ID + password, HttpOnly session cookies, failed
  attempt lockout (5 tries → 15-minute lock), fresh session on every sign-in.
- **Bookings** — 4-step wizard (patient → tests → slot → review) with live slot
  availability, package expansion, pricing, discounts, home-collection addresses,
  urgent priorities, follow-ups; reschedule, cancel-with-reason and edit flows.
- **Lab pipeline** — `PENDING → CONFIRMED → SAMPLE_COLLECTED → IN_LAB →
  COMPLETED → REPORT_READY`, plus `CANCELLED` / `NO_SHOW`. Illegal jumps are
  rejected with `409`, lab steps are restricted to technicians/managers/admins,
  and every transition lands in a timeline on the booking page.
- **Patients** — registry with search, quick registration from inside the
  booking wizard, full history per patient, deactivate for data hygiene.
- **Catalogue** — 57 seeded tests/packages across 11 categories with pricing,
  cost, margin, sample type, TAT and preparation notes; create/edit/archive.
- **Billing** — invoices generated with each booking, part payments, over-payment
  guard, full/partial refunds with reasons, collections and outstanding views.
- **Reports** — revenue and bookings per day, status mix, top tests, category
  mix, staff performance, CSV export (7/30/90/365-day ranges or custom dates).
- **Administration** — employee accounts and roles, centre settings (branding,
  schedule, cancellation window, slot length, booking horizon), global search
  palette, notifications and a filterable audit trail.
- **Dashboard** — today's KPIs, schedule, revenue, no-show rate and recent
  activity, all scoped to the signed-in role.

### Roles & permissions

20 permission keys drive 4 roles; every endpoint declares its own guard.

| Permission | Admin | Manager | Receptionist | Technician |
|---|:--:|:--:|:--:|:--:|
| `dashboard.view` | ✅ | ✅ | ✅ | ✅ |
| `patients.view` / `patients.edit` | ✅ | ✅ | ✅ | view |
| `products.view` / `products.edit` | ✅ | ✅ | view | view |
| `bookings.view` / `.create` / `.edit` / `.cancel` / `.status` | ✅ | ✅ | ✅ | view + status |
| `billing.view` / `.pay` / `.refund` | ✅ | ✅ | view + pay | — |
| `reports.view` | ✅ | ✅ | — | — |
| `users.view` / `users.manage` | ✅ | view | — | — |
| `audit.view` | ✅ | ✅ | — | — |
| `settings.manage` | ✅ | — | — | — |

---

## Project structure

```
backend/
  __init__.py          app factory: config, blueprints, schema ensure, SPA route
  models.py            SQLAlchemy models, roles/permissions, lifecycle tables
  auth.py              session guards, permission guards, envelopes, audit()
  services.py          numbering, slot availability, pricing, policy, notifications
  routes/
    auth · users · patients · products · slots · bookings
    billing · dashboard · reports · admin        (10 blueprints, 56 endpoints)
frontend/
  index.html           single page, inline SVG sprite, login + shell markup
  css/                 tokens · layout · components · pages
  js/
    api.js             fetch wrapper, envelope unwrapping, error toasts
    store.js           session + permission cache
    app.js             hash router, sidebar, search palette, notifications
    ui/                DOM builder, icons, toasts/modals, charts, widgets
    pages/             one module per screen (dashboard, bookings, wizard, …)
config.py              environment-driven configuration
seed.py                rich demo dataset (safe to re-run, --force to reset)
run.py                 development server
api/index.py           Vercel serverless entry point (same app factory)
vercel.json            function config + bundle exclusions
tests/                 pytest suite — 66 tests
pytest.ini             test paths + import root
```

### API conventions

Every response uses the same envelope:

```json
{ "ok": true,  "data": { … }, "message": "Booking BK-000250 created for Naina Malhotra." }
{ "ok": false, "error": { "code": "slot_taken", "message": "Slot 09:00 … was just booked.", "slot": "09:00" } }
```

- Collections are paginated: `data = {items, page, per_page, total, pages, has_next}`.
- Authentication is a session cookie; protected routes answer `401 unauthorized`.
- Permissions answer `403 forbidden` with the missing key in `error.required`.
- Cross-site writes are rejected: any `POST/PUT/PATCH/DELETE` whose `Origin`
  does not match the host returns `403 csrf`.
- Conflicts (`409`) cover double-booking, illegal status transitions and
  cancelling an already-terminal booking; validation issues return `422` with
  `error.field` so the UI can highlight the input.

---

## Configuration

Copy `.env.example` to `.env`. Everything is optional locally.

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | dev key | Session signing — **set a long random value in production** |
| `DATABASE_URL` | `sqlite:///…/suraksha.db` | The one switch for moving to a managed database |
| `TIMEZONE` | `Asia/Kolkata` | Calendar/"today"/slot maths for the centre |
| `SESSION_COOKIE_SECURE` | `0` (`1` on Vercel) | Set `1` behind HTTPS |
| `CORS_ORIGINS` | empty | Only needed if the API is hosted separately |

Timestamps are stored in **UTC**; dates, availability and the cancellation
window are evaluated in the centre's timezone (`backend/models.py::localdate`,
`backend/services.py::wallclock_now`), so a booking made at 01:30 IST still
belongs to the right day.

### Moving to the cloud later

Only `DATABASE_URL` changes — no code edits:

```bash
DATABASE_URL=postgresql+psycopg2://user:pass@host:5432/suraksha
```

Models are database-agnostic (no SQLite-only SQL), and `gunicorn` is already in
`requirements.txt` for Linux hosts:

```bash
gunicorn -w 4 -b 0.0.0.0:8000 run:app
```

---

## Deploying to Vercel

Vercel's zero-configuration Flask support picks up `api/index.py`, which exposes
the same `create_app()` factory `run.py` uses — one function serves the JSON
API, the SPA and every static asset.

```bash
npm i -g vercel        # or prefix the commands with `npx`
vercel                 # first run: log in, create the project, deploy
vercel --prod          # promote the deployment to production
```

Prefer Git? Push to GitHub and import the repo at vercel.com/new — detection
finds Flask from `requirements.txt` and the entry point from `api/index.py`.

**Environment variables** (Project → Settings → Environment Variables):

| Variable | Required | Notes |
|---|---|---|
| `SECRET_KEY` | **yes** | Long random string — signs the session cookie |
| `DATABASE_URL` | no | Durable database; see below |
| `TIMEZONE` | no | Defaults to `Asia/Kolkata` |
| `SESSION_COOKIE_SECURE` | no | Defaults to `1` on Vercel (HTTPS) |
| `CORS_ORIGINS` | no | Not needed — API and SPA share the origin |

**How the database works on Vercel.** The deployment bundle is read-only, so
without a `DATABASE_URL` the entry point points SQLite at `/tmp/suraksha.db`
and, on first boot, seeds the full demo dataset (about 3 s — one transaction,
safe against concurrent cold starts). `/tmp` lives for the lifetime of one
function instance, so **data resets on cold starts**: perfect for a demo, not
for production.

For durable data set `DATABASE_URL` to a managed database (Neon, Supabase,
Turso, …) and add its driver to `requirements.txt` (e.g. `psycopg[binary]` for
Postgres, `sqlalchemy-libsql` for Turso). The legacy `postgres://` scheme is
normalised to `postgresql://` automatically. A first boot against an *empty*
cloud database seeds the demo dataset too — sign in with
`EMP-1001 / Admin@123`, then change the passwords.

`vercel dev` runs the app locally through that same entry point, so what you
test is what ships. Tests and docs stay out of the function bundle via
`excludeFiles` (`vercel.json`) for Git deploys and `.vercelignore` for CLI
deploys.

---

## Tests

```bash
python -m pytest          # 66 tests, ~15s
```

The suite runs against a throw-away seeded database (never `suraksha.db`) and
covers:

- `test_auth.py` — login/logout/session, lockout, HttpOnly cookie, CSRF origin check
- `test_rbac.py` — every role × endpoint guard, permission matrix vs. the model
- `test_bookings.py` — creation, `409 slot_taken`, full lifecycle, illegal
  transitions, role-gated lab steps, cancel rules, reschedule rules
- `test_catalogue_patients.py` — product CRUD/validation, patient registry
- `test_operations.py` — billing (payment → refund), dashboard, reports, CSV
  export, settings, notifications, audit
- `test_services.py` — timezone-sensitive availability and cancellation policy
- `test_vercel_entry.py` — serverless bootstrap: writable DB path, first-boot
  demo seed, SPA + API served through `api/index.py`

---

## Notes

- UI is a hash-routed SPA served by Flask: `#/dashboard`, `#/bookings/243`,
  `#/bookings/new`, `#/patients/60`, … so deep links survive a refresh.
- Charts are hand-rolled SVG — no chart library.
- The audit trail records every mutation with the acting employee; entries are
  committed with the request so nothing is lost at teardown.
