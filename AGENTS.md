# AGENTS.md

This file is for coding agents working in `miro-mcp-relay`.
Follow these repo-specific conventions and commands first.

## Project Snapshot

- Runtime: FastAPI backend + React/Vite frontend.
- Main backend entrypoint: `backend/app/main.py`.
- Legacy Node source remains under `src/`, but it is no longer the deployed runtime path.
- Broker backend: FastAPI under `backend/app`.
- Frontend: React/Vite under `frontend/`.
- Package manager: npm (`package-lock.json` is present).
- App style: broker backend with DB-backed state plus a browser workspace; FastAPI also owns the legacy-compatible `/miro/mcp/*` relay endpoint.
- Container support: `backend/Dockerfile`, `frontend/Dockerfile`, `haproxy/`, and `docker-compose.yml`.
- Tests/lint tools: Node built-in platform tests, backend Python syntax checks, and backend smoke tests.

## Rule Files (Cursor / Copilot)

- Checked `.cursorrules`: not present.
- Checked `.cursor/rules/`: not present.
- Checked `.github/copilot-instructions.md`: not present.
- If any of these files are added later, treat them as highest-priority local instructions.

## Install / Run Commands

- Install deps (clean, reproducible): `npm ci`
- Install deps (general): `npm install`
- Start local full stack components with env prepared:
  - `cp .env.example .env`
  - `cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload`
  - `cd frontend && npm install && npm run dev`
- Start broker backend locally: `cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload`
- Start frontend locally: `cd frontend && npm install && npm run dev`

## Docker Commands

- Build + run in background: `docker compose up -d --build`
- Run in foreground: `docker compose up --build`
- Optional pre-generation of the dev certificate: `./scripts/generate-dev-cert.sh`
- Stop stack: `docker compose down`
- Rebuild image only: `docker compose build`
- Tail logs: `docker compose logs -f haproxy broker-frontend broker-backend`

## Build / Lint / Test Status

- Build script: none configured (`package.json` has no `build`).
- Lint script: none configured (`package.json` has no `lint`).
- Test script: `npm test` runs Node's built-in test runner.
- Backend validation currently uses `python3 -m py_compile`.
- Do not assume Jest/Vitest/ESLint are available unless you add them intentionally.

## Practical Verification Commands (Current Repo)

- Backend syntax check: `python3 -m py_compile backend/app/*.py backend/app/routers/*.py backend/app/core/*.py`
- Frontend build check: `cd frontend && npm run build`
- Run service smoke test after start:
  - `curl -sS http://localhost/api/v1/health`
  - `curl -sS http://localhost/healthz`
  - `curl -sS http://localhost/readyz`
- Root endpoint check: `curl -sS http://localhost/`
- MCP relay smoke check: `curl -sS -X POST http://localhost/miro/mcp/<profile_id> -H "X-Access-Key: <access_key>" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`
- HTTPS dev smoke test: `curl -k -sS https://localhost/api/v1/health`

## Testing Guidance (Especially Single Test)

The repository now uses Node's built-in test runner for focused unit tests.

- Run all tests (Node built-in): `node --test`
- Run all tests via npm: `npm test`
- Run a single test file: `node --test test/some-feature.test.js`
- Run tests by name pattern: `node --test --test-name-pattern "auth callback"`
- Run a single file with watch mode (Node >= 20): `node --test --watch test/some-feature.test.js`

If a test framework is introduced later, mirror the framework-native single-test command in `package.json` scripts.

## Environment and Config Conventions

- Copy `.env.example` to `.env` for local runs.
- `BROKER_PUBLIC_BASE_URL` and `FRONTEND_BASE_URL` should point at the externally visible broker origin, without an extra path suffix.
- `CORS_ORIGINS` should normally match the public frontend origin exposed by the proxy or load balancer.
- `SESSION_SECURE_COOKIE=true` is appropriate whenever the browser-facing origin is HTTPS, even if TLS is terminated before the app-local HAProxy.
- Treat secrets as sensitive:
  - `SESSION_SECRET`
  - `MICROSOFT_BROKER_CLIENT_SECRET`
  - issued Miro relay tokens
- Persisted imported legacy data for migration lives under `LEGACY_MIRO_DATA_DIR`.

## Code Style and Structure

## Language / Modules

- Use modern Python in `backend/`, TypeScript/React in `frontend/`, and modern JavaScript with ESM syntax in the remaining legacy/reference files under `src/`.
- Keep files UTF-8; default to ASCII unless file already uses Unicode.
- Prefer `const`; use `let` only when reassignment is required.
- Avoid introducing TypeScript unless explicitly requested.

## Imports

- Keep imports at file top.
- Preserve existing local style per language area:
  - backend Python: existing FastAPI/SQLAlchemy style
  - frontend TypeScript: existing React/Vite style
  - legacy JS helpers: single quotes + semicolons

## Formatting

- Match surrounding file conventions:
  - backend Python: current repo style, typed where already used
  - frontend TS/TSX: existing Vite/React style with double quotes
  - legacy JS: 2-space indentation and semicolons
- No repo formatter is configured; do not mass-reformat unrelated code.

## Naming Conventions

- Constants and env-derived globals: `UPPER_SNAKE_CASE`.
- Functions and variables: `camelCase`.
- Route params and external API fields: preserve existing snake_case where required by API contract.
- Keep endpoint paths and JSON response keys backward compatible.

## Types and Data Shapes

- Backend and frontend both use explicit schemas/types; keep response shapes stable and validate inputs early.
- Validate request inputs early (trim strings, cap length, reject invalid values).
- For response objects, follow existing key shapes (`ok`, `detail`, `profile_id`, etc.).
- Keep DB schema migrations additive and compatible with existing startup reconciliation.

## Error Handling

- Wrap async route handlers where needed and return explicit HTTP status codes with JSON errors.
- Return explicit HTTP status codes with JSON errors for API endpoints.
- Use non-throwing helpers for best-effort behavior where appropriate (e.g., audit logging).
- Never leak secrets in logs or error bodies.
- Preserve resilience behavior: retries, token refresh, circuit breaker semantics.

## Security and Auth Practices

- Use timing-safe token hash comparison for relay tokens.
- Keep admin auth checks strict.
- Maintain CSRF checks on state-changing authenticated routes.
- Keep security headers and secure cookie behavior intact.

## State, I/O, and Side Effects

- Database-backed broker state is authoritative now.
- Legacy file-backed data under `data/` is still used only for migration import and compatibility tests.
- For relay-token lifecycle changes, keep audit events and timestamps in sync.

## HTTP / Proxy Behavior

- Preserve header behavior for upstream MCP calls (`Authorization`, `Content-Type`, `Accept`).
- Maintain compatibility for both JSON and event-stream responses.
- Keep auth-refresh-on-401 flow and retry loop semantics intact.

## Agent Workflow Expectations

- Make focused diffs; avoid unrelated refactors.
- Read `README.md`, `.env.example`, `backend/app/main.py`, and the relevant frontend/backend entry files before major edits.
- Prefer adding npm scripts when introducing new tooling (build/lint/test).
- If adding tests, include at least one single-test execution example in docs.
- Update this file when developer workflow changes materially.

## Suggested Future Script Additions (When Asked)

- `"dev"`: start with file watching.
- `"lint"`: run ESLint.
- `"test"`: run test suite.
- `"test:one"`: run exactly one file/test name.
- `"build"`: if/when transpilation or bundling is introduced.
