## 2026-04-03 – Cursor Agent – Workspace Connect-Buttons entfernt

- Done:
  - `WorkspacePage`: `PageIntro`-Aktionen (primäre Connect-Miro-/Graph-Buttons) entfernt; `connectTargets` und `onNavigate`-Prop entfallen.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/App.tsx
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
  - UI path: `/workspace`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - none

## 2026-04-03 – Cursor Agent – Admin-UI Redesign OAuth

- Done:
  - Globales Frontend-Design (weiß, Kontrast, System-UI), Admin-Shell-Branding, Integrationsseite mit Drawer-Wizards und Review-Schritt, Logs mit Tabs, Access/User/Services/Dashboard-Texte angepasst, Zugriffsmodus-Labels (Proxy/Direct) in Admin und User-Grants.
  - Neue Komponente `frontend/src/admin/SetupDrawer.tsx`.
- Next:
  - optional: End-User-Workspace (Miro-Panel) Texte von „relay“ auf produktfreundliche Begriffe vereinheitlichen.
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/index.css, frontend/index.html, frontend/src/App.tsx
  - frontend/src/admin/IntegrationsPage.tsx, SetupDrawer.tsx, DashboardPage.tsx, UsersPage.tsx, ServicesPage.tsx, AccessPage.tsx, LogsPage.tsx
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
  - UI path: /app/integrations, /app/logs
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - none

## 2026-04-03 – Agent – Credential-only Token-Abruf

- Done:
  - `delegation_grants.service_client_id` nullable; `reconcile_schema` DROP NOT NULL.
  - `diagnose_service_access`: Grant per Credential; `X-Service-Secret` optional; `service_access_audit_actor` für Audit (`credential` / Grant-ID).
  - Token-Issuance + Miro-Broker-Proxy; User/Admin-Grant-Erstellung ohne Service-Client; Frontend Grants/Access „Credential only“; README + technische Referenz + Funktionsübersicht.
  - Smoke-Test `test_credential_only_grant_issues_token_without_service_secret`.
- Next:
  - optional: Postgres-Migration verifizieren (ALTER bereits in reconcile).
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign (lokal)
  - PR: none
- Files touched:
  - backend/app/models.py, deps.py, seed.py, schemas.py, routers/user.py, routers/admin.py, routers/token_issuance.py, routers/connections.py, test_welle1_smoke.py
  - frontend/src/App.tsx, admin/AccessPage.tsx, types.ts
  - README.md, docs/CHANGELOG.md, docs/technische-referenz.md, docs/funktionsuebersicht.md
- Test notes:
  - commands: `python3 -m unittest backend/test_welle1_smoke.py`, `cd frontend && npm run build`
  - endpoints: `POST /api/v1/token-issues/provider-access` mit nur `X-Delegated-Credential`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - none

## 2026-04-03 – Agent – App-Audit Umsetzung

- Done:
  - Plan „App-Audit und Optimierung“ umgesetzt (Backend, Frontend, Infra, Seed, Tests).
- Next:
  - Optional: FastAPI Lifespan statt `on_event("startup")`.
- Blockers:
  - keine
- Branch/PR:
  - branch: lokal
  - PR: none
- Files touched:
  - backend/app/models.py, deps.py, seed.py, oauth_pending_store.py, main.py, routers/*, miro.py, microsoft_graph.py
  - frontend/src/api.ts, App.tsx, app-context.tsx, utils.ts, errors.ts
  - docker-compose.yml, .env.example, package.json
  - docs/CHANGELOG.md
- Test notes:
  - commands: `python3 -m unittest backend/test_welle1_smoke.py`, `cd frontend && npm run build`
- Changelog updated:
  - yes ([Unreleased])

## 2026-04-03 – Agent – Admin-UI OAuth-Broker

- Done:
  - Admin-UI neu: Navigation Dashboard, Integrations, Users, Services, Access, Logs; Integrations als Karten mit Modals (Microsoft Login/Graph, Miro, Custom OAuth); Graph-Berechtigungen als Auswahl; Redirect-URIs read-only; Verbindungstest-Endpoint; öffentliche Callback-URL-Liste; Platzhalter-Callback für Custom OAuth; Legacy-Admin-URLs auf neue Pfade umgestellt.
- Next:
  - Optional: Endbenutzer-Workspace-Copy (Miro) an gleiche Begrifflichkeit anpassen.
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign (lokal)
  - PR: none
- Files touched:
  - backend/app/schemas.py, routers/public.py, routers/admin.py, routers/connections.py
  - frontend/src/App.tsx, api.ts, types.ts, utils.ts, components.tsx, index.css
  - frontend/src/admin/*.tsx, frontend/src/admin/constants.ts
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m unittest backend/test_welle1_smoke.py`, `cd frontend && npm run build`
  - endpoints: `GET /api/v1/broker-callback-urls`, `POST /api/v1/admin/integrations/test` (mit Admin-CSRF)
- UI path:
  - /app/integrations, /app/users, …
- Changelog updated:
  - yes ([Unreleased] Added/Changed)
- Follow-ups:
  - Custom-OAuth: vollständiger Connect-Flow im Backend falls gewünscht.
