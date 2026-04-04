## 2026-04-04 – Cursor Agent – Shell: Hauptspalte oben bündig

- Done:
  - `frontend/src/index.css`: `.page-shell` um `align-content: start` und `align-items: start` ergänzt (Kopfzeile nicht mehr nach unten verzogen, wenn `main` höher als der Inhalt ist).
  - `npm run build`; `frontend/dist` aktualisiert.
  - `docs/CHANGELOG.md` [Unreleased] Fixed ergänzt.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/index.css
  - frontend/dist/
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - Shell mit Sidebar + `main.page-shell` (z. B. `/workspace/integrations`)
- Changelog updated:
  - yes ([Unreleased] Fixed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Integrations-Karten: vertikales Stretching

- Done:
  - `frontend/src/index.css`: `.integration-grid` mit `align-items: start`; `.integration-card-desc` von `flex: 1` auf `flex: 0 1 auto` (kein Wachstum in die Zeilenhöhe).
  - `npm run build`; `frontend/dist` angepasst.
  - `docs/CHANGELOG.md` [Unreleased] Fixed ergänzt.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/index.css
  - frontend/dist/
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
  - endpoints: keine
- UI path:
  - `/workspace/integrations`, `/app/integrations` (Integrations-Karten)
- Changelog updated:
  - yes ([Unreleased] Fixed)
- Follow-ups:
  - keine

## 2026-04-04 18:30 – Cursor Agent – Self-Service Navigation: zentrale Integrations-Seite

- Done:
  - Frontend: Route `/workspace/integrations`, `UserIntegrationsPage` (Karten pro Provider-App, Connect/Reconnect/Disconnect, Refresh/Probe, Miro MCP-Handoff); Sidebar nur noch ein Eintrag „Integrations“ statt pro Provider; Workspace-Dashboard auf Kennzahlen reduziert.
  - Routing: Admins nutzen für Self-Service dieselbe Shell (Nav inkl. „Workspace“ in der Admin-Sidebar); `/connect/*` leitet clientseitig auf `/workspace/integrations` um.
  - Backend: OAuth-Redirects (Miro, Microsoft Graph, Legacy `/miro`) auf `/workspace/integrations`; `ConnectedAccountOut` um Token-Metadaten; Serialisierung in `connection_serializers.py`; `list_connections`, Refresh/Revoke, Admin-Liste/Manual angepasst.
  - `docs/CHANGELOG.md` [Unreleased] Changed ergänzt.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/schemas.py, connection_serializers.py, routers/connections.py, routers/admin.py, miro.py, microsoft_graph.py, routers/legacy_miro.py
  - frontend/src/App.tsx, UserIntegrationsPage.tsx, components.tsx, types.ts, utils.ts, index.css
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `npm run build` (frontend); `python3 -m py_compile` (geänderte Backend-Dateien)
  - endpoints: `GET /api/v1/connections` (neue Felder), OAuth-Callback-Redirects
- UI path:
  - `/workspace/integrations` (Self-Service), Admin: Sidebar „Workspace“
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – `data/` aus Repo und Git-Historie entfernt

- Done:
  - `python3 -m git_filter_repo --path data/ --invert-paths --force` (Historie bereinigt, `origin` entfernt und wieder gesetzt).
  - `.gitignore`: `data/` ergänzt.
  - `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md` aktualisiert.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign (alle lokalen Branches neu geschrieben)
  - PR: none
- Files touched:
  - .gitignore
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
  - (Historie: `data/*` aus allen Commits entfernt)
- Test notes:
  - commands: `python3 -m git_filter_repo ...`; danach Commit mit Ignore/Changelog/Worklog; `git push origin --force --all`
- endpoints:
  - n/a
- UI path:
  - n/a
- Changelog updated:
  - yes ([Unreleased] Removed)
- Follow-ups:
  - Mitbearbeiter: nach Force-Push lokale Repos mit `git fetch origin` + harter Reset auf `origin/<branch>` oder neu klonen.

## 2026-04-03 – Cursor Agent – Frontend-Build-Artefakte committen und Branch pushen

- Done:
  - `frontend/dist/index.html` und `frontend/tsconfig.tsbuildinfo` nach Build eingecheckt; `git push` für `codex/oauth-broker-redesign` (inkl. zuvor lokaler Commits).
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/dist/index.html
  - frontend/tsconfig.tsbuildinfo
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build` (Voraussetzung für konsistente Asset-Namen)
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-03 – Cursor Agent – Theme toggle UI

- Done:
  - `theme-toggle.tsx`: ein Icon-Button, wechselt zyklisch System → Light → Dark; SVG-Icons (Monitor, Sonne, Mond); dezente Styles (32px Hit-Area, muted-Farbe, Hover nur leichtes `bg-subtle`).
  - `index.css`: alte Segment-Button-Styles entfernt, `.theme-toggle-trigger` / `.theme-toggle-icon`, Login zentriert.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/theme-toggle.tsx
  - frontend/src/index.css
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
  - UI path: Sidebar, `/login`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-03 – Cursor Agent – Dark mode & theme tokens

- Done:
  - Semantische Design-Tokens in `index.css` (`:root`, `html.dark`); harte Farben durch Variablen ersetzt (Surfaces, Inputs, Modals, Toasts, Tabellen, Integration Cards, Wizard, Code-Blöcke, Backdrops).
  - `theme-context.tsx` (`ThemeProvider`, `useTheme`), Persistenz `broker-theme`, Klasse `dark` auf `documentElement`, `color-scheme`, Reaktion auf `prefers-color-scheme` bei „System“.
  - FOUC-Skript in `index.html`; `ThemeToggle` (`Appearance` / System, Light, Dark) in Shell-Sidebar und Login-Karte; `main.tsx` um `ThemeProvider` erweitert.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/index.css
  - frontend/src/theme-context.tsx
  - frontend/src/theme-toggle.tsx
  - frontend/src/main.tsx
  - frontend/src/App.tsx
  - frontend/index.html
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
  - UI path: `/login`, `/workspace`, `/app/*` (Theme-Schalter; Hell/Dunkel/System)
- Changelog updated:
  - yes ([Unreleased] Added)
- Follow-ups:
  - keine

## 2026-04-03 – Cursor Agent – UI spacing & typography audit

- Done:
  - `index.css`: `--space-1`–`--space-6`, Typografie-Variablen; Buttons/Inputs min-height 40px; Karten-, Drawer-, Modal-, Tab-, Integrationskarten- und Tabellenabstände vereinheitlicht; `.field-hint--flush`, `.muted-copy`, Abstände zwischen direkten Karten-Kindern; `--radius-md` an `--radius-sm` angeglichen.
  - `IntegrationsPage.tsx`: `field-hint` ohne Inline-`style`.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/index.css
  - frontend/src/admin/IntegrationsPage.tsx
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
  - UI path: `/workspace`, `/app/*`, `/login`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-03 – Cursor Agent – Landing /login minimal

- Done:
  - `LoginPage`: einspaltiges, zentriertes Layout; primärer „Log in“-Button (Microsoft OAuth); „Administrator sign-in“ öffnet Modal mit Username/Password, Cancel/Sign in; Styles in `index.css` (`.landing*`).
  - Beschädigte Duplikat-CSS am Ende von `index.css` entfernt (Build-Warnung behoben).
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/App.tsx
  - frontend/src/index.css
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
  - endpoints: unverändert (`/auth/login`, Microsoft-Start)
  - UI path: `/login` (anonym)
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

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

## 2026-04-03 – Cursor – Frontend Modal-Refactor

- Done:
  - Gemeinsame `Modal`-Komponente; Admin- und Workspace-Formulare in Modals verschoben (Services, Access, Grants, Token-Import, Token-Access Filter/Probe); Integrations-Wizard (`SetupDrawer`) als zentriertes Modal; Connect-Provider-Seite einspaltig; CSS für breite Modals und Wizard-Panel.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign (lokal)
  - PR: none
- Files touched:
  - frontend/src/components.tsx, App.tsx, index.css
  - frontend/src/admin/ServicesPage.tsx, AccessPage.tsx, UsersPage.tsx, SetupDrawer.tsx
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
  - UI path: /app/services, /app/access, /app/users (Connections), /grants, /token-access, /connect/*, /app/integrations
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

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

## 2026-04-04 12:00 – Agent – Workspace Integrations UX

- Done:
  - Self-Service Integrations: Verbindungsdetails in `SetupDrawer`-Wizard (Account / Session); Connect-Flow zweistufig wie Admin-Optik; Karten ohne volle OAuth-Metadaten; nach Disconnect keine Kontodaten auf der Karte; Miro-Handoff nur bei `status === "connected"`.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign (lokal)
  - PR: none
- Files touched:
  - frontend/src/UserIntegrationsPage.tsx
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
  - UI path: `/workspace/integrations`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine
