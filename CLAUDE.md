# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

CAN Crab is a Docker-deployed Rust + Angular + PostgreSQL application for uploading and analyzing CAN (Controller Area Network) bus logs. Users upload a DBC file and a candump log; the backend decodes signals and stores time-series data in Postgres for visualization.

## Commands

### Docker (primary workflow)
```bash
cp .env.example .env              # First-time setup
docker compose up --build         # Build and start all services (frontend :80, backend :8081)
docker compose down
```

### Backend (Rust — local dev)
```bash
cargo build --bin cancrab-server
cargo run --bin cancrab-server    # Requires DATABASE_URL env var (see .env.example)
cargo test
cargo test <test_name>            # Run a single test
```

### Frontend (Angular — local dev)
```bash
cd frontend/cancrab-frontend
npm start -- --proxy-config proxy.conf.json   # Dev server at http://localhost:4200
npm run build
npm test
```

### Database
Migrations run automatically on server startup via `sqlx::migrate!`. To run manually:
```bash
sqlx migrate run --database-url postgres://cancrab:cancrab@localhost:5432/cancrab
```

## Architecture

**Two Rust binaries** (in `src/bin/`):

- **`cancrab-server`** (port 8081) — the primary binary. Handles DBC + log uploads, decodes CAN signals, persists to Postgres, and serves the Angular SPA from `static/`.
- **`cancrab-viewer`** — optional live SocketCAN WebSocket streamer; only started via `docker compose --profile can up`.

**Backend structure** (`src/`):
- `state.rs` — `AppState`: holds `PgPool`, `jwt_secret`, and in-memory anonymous session (`anon_dbc` + `anon_log`)
- `handlers/anonymous.rs` — unauthenticated upload/decode flow (in-memory, no DB)
- `handlers/auth.rs` — register/login with Argon2 password hashing and JWT issuance
- `handlers/datasets.rs` / `handlers/signals.rs` — authenticated CRUD for persisted datasets and decoded signal queries
- `handlers/mod.rs` — shared `parse_log()` and `sanitize_dbc()` utilities
- `db/` — sqlx query functions for users, datasets, signals
- `middleware/auth.rs` — JWT extraction middleware

**API routes** (all under `/api`):
- `POST /api/upload` + `GET /api/data` — anonymous (no auth), in-memory decode
- `POST /api/auth/register`, `POST /api/auth/login`
- `GET/POST /api/datasets`, `GET/DELETE/PATCH /api/datasets/{id}`
- `GET /api/datasets/{id}/signals`, `GET /api/datasets/{id}/signals/{name}`

**Database schema** (`migrations/0001_initial.sql`): `users`, `datasets`, `can_frames`, `dataset_signals`, `signal_samples`, `refresh_tokens`.

**Frontend** (`frontend/cancrab-frontend/`):
- Angular 20 standalone components, proxies `/api` to backend in dev mode
- nginx serves the built SPA and proxies `/api` → `backend:8081` in production

**Log format** parsed by `parse_log()`:
```
(1234567890.123456) vcan0 0CF00400#0000000000000000
```

**DBC quirks**: `sanitize_dbc()` collapses embedded newlines in quoted strings and strips `BO_` blocks with DLC > 64 — both of which cause `dbc-rs` to reject the file.

## Environment Variables

See `.env.example`. Required for local backend dev:
- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — signing key for JWTs
- `SERVER_ADDR` — defaults to `0.0.0.0:8081`
