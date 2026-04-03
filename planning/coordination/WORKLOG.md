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
