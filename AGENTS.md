# AGENTS.md

This file is for coding agents working in `miro-mcp-relay`.
Follow these repo-specific conventions and commands first.

## Project Snapshot

- Runtime: Node.js (ESM, `"type": "module"`).
- Main entrypoint: `src/index.js`.
- Package manager: npm (`package-lock.json` is present).
- App style: single-process Express service with file-backed JSON state.
- Container support: `Dockerfile` + `docker-compose.yml`.
- Tests/lint tools: not currently configured in this repository.

## Rule Files (Cursor / Copilot)

- Checked `.cursorrules`: not present.
- Checked `.cursor/rules/`: not present.
- Checked `.github/copilot-instructions.md`: not present.
- If any of these files are added later, treat them as highest-priority local instructions.

## Install / Run Commands

- Install deps (clean, reproducible): `npm ci`
- Install deps (general): `npm install`
- Start app locally: `npm start`
- Start app directly with Node: `node src/index.js`
- Start with env file prepared: `cp .env.example .env && npm start`

## Docker Commands

- Build + run in background: `docker compose up -d --build`
- Run in foreground: `docker compose up --build`
- Stop stack: `docker compose down`
- Rebuild image only: `docker compose build`
- Tail logs: `docker compose logs -f miro-mcp-relay`

## Build / Lint / Test Status

- Build script: none configured (`package.json` has no `build`).
- Lint script: none configured (`package.json` has no `lint`).
- Test script: none configured (`package.json` has no `test`).
- Do not assume Jest/Vitest/ESLint are available unless you add them intentionally.

## Practical Verification Commands (Current Repo)

- Syntax check: `node --check src/index.js`
- Run service smoke test after start:
  - `curl -sS http://localhost:8787/healthz`
  - `curl -sS http://localhost:8787/readyz`
- Root endpoint check: `curl -sS http://localhost:8787/`

## Testing Guidance (Especially Single Test)

There is no committed test suite yet. If you add tests, prefer Node's built-in test runner unless asked otherwise.

- Run all tests (Node built-in): `node --test`
- Run a single test file: `node --test test/some-feature.test.js`
- Run tests by name pattern: `node --test --test-name-pattern "auth callback"`
- Run a single file with watch mode (Node >= 20): `node --test --watch test/some-feature.test.js`

If a test framework is introduced later, mirror the framework-native single-test command in `package.json` scripts.

## Environment and Config Conventions

- Copy `.env.example` to `.env` for local runs.
- `BASE_URL` must be host(+port) only, without `/miro` suffix.
- Treat secrets as sensitive:
  - `MIRO_RELAY_API_KEY`
  - `MIRO_RELAY_ADMIN_KEY`
  - `MIRO_ADMIN_PASSWORD`
- Persisted runtime data is under `DATA_DIR` (default `/app/data` in container).

## Code Style and Structure

## Language / Modules

- Use modern JavaScript with ESM `import` syntax.
- Keep files UTF-8; default to ASCII unless file already uses Unicode.
- Prefer `const`; use `let` only when reassignment is required.
- Avoid introducing TypeScript unless explicitly requested.

## Imports

- Keep imports at file top.
- Group order used in `src/index.js`:
  1) third-party packages (`express`, `dotenv`)
  2) Node built-ins (`fs`, `path`, `crypto`, `stream`)
- Preserve existing quote/semi style: single quotes + semicolons.

## Formatting

- Match existing formatting in `src/index.js`:
  - 2-space indentation.
  - Semicolons required.
  - Trailing commas only when already present in multiline literals.
  - Keep line length reasonable; prioritize readability over strict width.
- No repo formatter is configured; do not mass-reformat unrelated code.

## Naming Conventions

- Constants and env-derived globals: `UPPER_SNAKE_CASE`.
- Functions and variables: `camelCase`.
- Route params and external API fields: preserve existing snake_case where required by API contract.
- Keep endpoint paths and JSON response keys backward compatible.

## Types and Data Shapes

- This is plain JS; enforce shape via explicit checks and defaults.
- Validate request inputs early (trim strings, cap length, reject invalid values).
- For response objects, follow existing key shapes (`ok`, `error`, `profile_id`, etc.).
- Keep persisted object schemas stable (`profiles`, `tokens`, `clients`).

## Error Handling

- Wrap async route handlers in `try/catch` when they can throw.
- Return explicit HTTP status codes with JSON errors for API endpoints.
- Use non-throwing helpers for best-effort behavior where appropriate (e.g., audit logging).
- Never leak secrets in logs or error bodies.
- Preserve resilience behavior: retries, token refresh, circuit breaker semantics.

## Security and Auth Practices

- Use timing-safe token hash comparison for relay tokens.
- Keep admin auth checks strict (`session` or `X-Admin-Key`/bearer fallback).
- Maintain rate limits on sensitive routes (login/create/delete/auth start).
- Keep security headers middleware active for all responses.

## State, I/O, and Side Effects

- JSON persistence helpers (`readJson`/`writeJson`) are sync by design; keep behavior consistent unless refactor is intentional.
- Any change to stored files should update all relevant stores and call `saveAll()` where expected.
- For profile lifecycle changes, keep audit events and timestamps in sync.

## HTTP / Proxy Behavior

- Preserve header behavior for upstream MCP calls (`Authorization`, `Content-Type`, `Accept`).
- Maintain compatibility for both JSON and event-stream responses.
- Keep auth-refresh-on-401 flow and retry loop semantics intact.

## Agent Workflow Expectations

- Make focused diffs; avoid unrelated refactors.
- Read `README.md`, `.env.example`, and `src/index.js` before major edits.
- Prefer adding npm scripts when introducing new tooling (build/lint/test).
- If adding tests, include at least one single-test execution example in docs.
- Update this file when developer workflow changes materially.

## Suggested Future Script Additions (When Asked)

- `"dev"`: start with file watching.
- `"lint"`: run ESLint.
- `"test"`: run test suite.
- `"test:one"`: run exactly one file/test name.
- `"build"`: if/when transpilation or bundling is introduced.
