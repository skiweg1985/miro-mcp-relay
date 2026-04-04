## 2026-04-04 – Cursor Agent – Access-Modal vereinfacht

- Done:
  - `frontend/src/App.tsx`: `AccessConnectionTool` + `GrantAppAccessKeySection`; primär nur Connection / Endpoint / Access key; **Usage example** und **Developer details** einklappbar; entfernt: mehrfache HTTP-/Relay-Beispiele, `isMiroProviderKey`; Modal ohne `wide`.
  - `frontend/src/index.css`: `.access-modal-*` kompaktes Layout.
  - `docs/CHANGELOG.md` [Unreleased] Changed.
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
  - `cd frontend && npm run build`
- UI path:
  - `/grants` → Zeile → **Access**
- Changelog updated:
  - yes
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Delegated Credential serverseitig abrufbar

- Done:
  - `delegation_grants.encrypted_delegated_credential`, `reconcile_schema`, Create/Rotate/Revoke (User + Admin); `GET /delegation-grants/{id}/delegated-credential`; 404 `delegated_credential_not_stored`.
  - Frontend: `api.getMyDelegationGrantDelegatedCredential`, `DelegatedCredentialPanel` lädt per GET; **Replace secret** nur in `<details>` oder bei Legacy; `localStorage`-Pfad entfernt.
  - `docs/CHANGELOG.md`, `docs/technische-referenz.md`; Smoke-Tests mit `encrypt_text` auf Test-Grants.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/models.py, seed.py, routers/user.py, routers/admin.py, test_welle1_smoke.py
  - frontend/src/App.tsx, api.ts, utils.ts, index.css
  - docs/CHANGELOG.md, docs/technische-referenz.md, planning/coordination/WORKLOG.md
- Test notes:
  - `cd frontend && npm run build`, `pytest backend/test_welle1_smoke.py`
- Changelog updated:
  - yes
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Delegated Credential im Access-Modal

- Done:
  - Backend: `POST /api/v1/delegation-grants/{id}/rotate-credential`, Schema `DelegatedCredentialRotateOut`, Audit `user.delegation_grant.credential_rotated`.
  - Frontend: `DelegatedCredentialPanel` (Reveal, Copy, New secret / Issue new secret), `localStorage` `broker_delegated_credentials_v1` bei Create/Rotate, Cleanup bei Revoke; Modal **Access**; `<details>` für HTTP-Beispiele und Scope/Status; `utils.ts` Storage-Helfer; `api.rotateMyDelegationGrantCredential`.
  - `docs/CHANGELOG.md`, `docs/technische-referenz.md`.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/schemas.py
  - backend/app/routers/user.py
  - frontend/src/App.tsx
  - frontend/src/api.ts
  - frontend/src/types.ts
  - frontend/src/utils.ts
  - frontend/src/index.css
  - docs/CHANGELOG.md
  - docs/technische-referenz.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m py_compile …`, `cd frontend && npm run build`
- endpoints:
  - `POST /api/v1/delegation-grants/{id}/rotate-credential`
- UI path:
  - `/grants` → Zeile → **Access**-Modal
- Changelog updated:
  - yes (Added / Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Access-Detail Header und Connection-Auflösung

- Done:
  - `frontend/src/App.tsx`: `GrantDetailPanel` löst fehlende `connected_account_id` über `myConnections()` auf; lädt `access-details` für die ermittelte Verbindung; Rotate nutzt dieselbe ID; Abschnitte **Headers and examples** / **Connection details** vor **This access**; MCP-Beispiel mit beiden Headern; generisches Relay-Beispiel für Nicht-Miro; `GrantsPage`: `miroSetupExchange` aus `sessionStorage` + `CredentialRevealModal` (bereits verdrahtet).
  - `frontend/src/index.css`: `.grant-detail-meta-title`.
  - `docs/CHANGELOG.md` [Unreleased] Changed.
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
- endpoints:
  - `GET /api/v1/connections`, `GET /api/v1/connections/{id}/access-details`
- UI path:
  - Workspace → **Access** → Zeile öffnen → Header/Beispiele oben, Connection details, Metadaten unten
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Integrations-Detailroute matchesRoute

- Done:
  - `frontend/src/utils.ts`: `matchesRoute` ergänzt für `/app/integrations/:appId` (zuvor fiel der Pfad auf `notFound`).
  - `docs/CHANGELOG.md` [Unreleased] Fixed.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/utils.ts
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - Admin → Integrations → **Open** → Übersicht (kein Not Found mehr)
- Changelog updated:
  - yes ([Unreleased] Fixed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Admin Integrations Übersicht

- Done:
  - `frontend/src/types.ts`: Route `integrationDetail` für `/app/integrations/:appId`.
  - `frontend/src/utils.ts`: `matchesRoute` für Integrations-Detailpfad.
  - `frontend/src/App.tsx`: `IntegrationsPage` mit `navigate` und `detailAppId`; Sidebar **Integrations** aktiv bei Detail-URL; Nicht-Admin-Redirect um `integrationDetail`.
  - `frontend/src/admin/IntegrationOverview.tsx`: Übersicht (Header, Overview, Configuration, Usage, Health, Advanced).
  - `frontend/src/admin/IntegrationsPage.tsx`: Daten `connectedAccounts` + `adminTokenIssues`; Detail vs. Liste; Enable/Disable; Custom-Integration bearbeiten (PATCH); Karten **Open**/**Set up**; Custom-Apps im Raster.
  - `frontend/src/index.css`: Layout/Typo für Integrations-Detail.
  - `docs/CHANGELOG.md` [Unreleased] Changed.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/types.ts
  - frontend/src/utils.ts
  - frontend/src/App.tsx
  - frontend/src/admin/IntegrationOverview.tsx
  - frontend/src/admin/IntegrationsPage.tsx
  - frontend/src/index.css
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - Admin → Integrations → **Open** auf Karte → Übersicht; **Edit** öffnet Drawer
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Admin Services löschen

- Done:
  - `backend/app/routers/admin.py`: `DELETE /api/v1/admin/service-clients/{id}` mit 409 bei aktiven Delegation-Grants; FK-Entkopplung Grants/TokenIssueEvents; Audit.
  - `frontend/src/api.ts`: `deleteServiceClient`, `DELETE` in HttpMethod.
  - `frontend/src/admin/ServicesPage.tsx`: Remove + `ConfirmModal`.
  - `frontend/src/index.css`: `.confirm-modal-hint`.
  - `docs/CHANGELOG.md` [Unreleased] Added.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/routers/admin.py
  - frontend/src/api.ts
  - frontend/src/admin/ServicesPage.tsx
  - frontend/src/index.css
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m py_compile backend/app/routers/admin.py`, `cd frontend && npm run build`
- UI path:
  - Admin → Services → **Remove**
- Changelog updated:
  - yes ([Unreleased] Added)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Admin UI Design-System

- Done:
  - `frontend/src/admin/AccessPage.tsx`: Regeln **Rules**, Toggle **Show inactive**, Status-Labels (Removed/Paused/…), Expires eine Zeile + Tooltip, Modals/Toasts ohne Grant-Wording.
  - `frontend/src/admin/UsersPage.tsx`: Connections-Filter Standard **Connected**, Status **Removed**, Aktion **Verify**, **Manual import** / Formularlabels ohne „Token“.
  - `frontend/src/admin/IntegrationsPage.tsx`: Karten-Meta ohne GUID, Custom-Card + **Apps**-Liste.
  - `frontend/src/admin/ServicesPage.tsx`: PageIntro + SecretPanel-Copy.
  - `frontend/src/index.css`: `.admin-expires-cell`, `.admin-rules-table`, `.admin-conn-actions`.
  - `docs/CHANGELOG.md` [Unreleased] Changed.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/admin/AccessPage.tsx
  - frontend/src/admin/UsersPage.tsx
  - frontend/src/admin/IntegrationsPage.tsx
  - frontend/src/admin/ServicesPage.tsx
  - frontend/src/index.css
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - Admin: Access, People → Connections, Integrations, Services
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – App access: Zeile klickbar

- Done:
  - `frontend/src/components.tsx`: `DataTable` mit optionalem `onRowClick`, `getRowAriaLabel`, fokussierbare Zeile (`data-table-row--clickable`).
  - `frontend/src/App.tsx`: Grants-Tabelle öffnet Details per Zeilenklick; **View** entfernt; **Remove access** mit `stopPropagation`; Hilfetext angepasst.
  - `frontend/src/index.css`: Cursor und Fokus-Ring für klickbare Zeilen.
  - `docs/CHANGELOG.md` [Unreleased] Changed; `frontend/dist/index.html` Asset-Hashes nach Build.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/components.tsx
  - frontend/src/App.tsx
  - frontend/src/index.css
  - frontend/dist/index.html
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - `/grants` → Zeile anklicken → Modal **Access details**; **Remove access** nur Widerruf
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Secret-UX: Modal statt Reveal

- Done:
  - `frontend/src/components.tsx`: `SecretPanel` zeigt Einmal-Geheimnisse im `Modal` mit Klartext, **Copy** und **Close**; `MiroConnectionSecretsModal` bündelt Access Key und JSON-Blöcke; `MiroAccessCard` nutzt das gebündelte Modal.
  - `frontend/src/index.css`: Layout für `secret-modal-section` / `secret-modal-section-actions`.
  - `docs/CHANGELOG.md` [Unreleased] Changed; `frontend/dist` neu gebaut.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/components.tsx
  - frontend/src/index.css
  - frontend/dist/
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - `/grants` nach neuem Access; Admin Services/Access nach Erstellung; Workspace Miro-Karte nach neuem Access Key
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Grants: Hilfe und Entwicklerhinweise

- Done:
  - `frontend/src/components.tsx`: `Card` mit optionalem `headerActions`.
  - `frontend/src/App.tsx`: Grants-Karte mit Hilfe-Modal „App access overview“; `GrantDetailPanel` mit Abschnitt „Use in your application“, `GrantCodeCopy`, HTTP-Beispiele für Token-Ausgabe und Miro-Relay; Hinweis Legacy MCP Profil-URL.
  - `frontend/src/index.css`: Styles für Hilfe-Button, Code-Blöcke, Inset-Panel.
  - `docs/CHANGELOG.md` [Unreleased] Added; `frontend/dist` neu gebaut.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/App.tsx
  - frontend/src/components.tsx
  - frontend/src/index.css
  - frontend/dist/
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - `/grants` (Karte „Your app access“, Modal „Access details“)
- Changelog updated:
  - yes ([Unreleased] Added)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Self-Service: Nutzer-Texte vereinfacht

- Done:
  - `frontend/src/App.tsx`: Workspace-, App-access-, Activity-Seiten; Nav „App access“ / „Activity“; Shell „Workspace“ / „Your account“; Fehlermeldungen ohne Broker-Jargon; `userIssueDecisionLabel`; Status „Removed“/„Off“ statt Revoked/Disabled.
  - `frontend/src/UserIntegrationsPage.tsx`: Integrations-Copy, Wizard-Schritte, Session-Tab-Labels, Toasts, Disconnect-Bestätigung.
  - `frontend/src/components.tsx`: `MiroAccessCard` und `SecretPanel`-Eyebrow nutzerfreundlich.
  - `docs/CHANGELOG.md` [Unreleased] Changed; `frontend/dist` neu gebaut.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/App.tsx
  - frontend/src/UserIntegrationsPage.tsx
  - frontend/src/components.tsx
  - frontend/dist/
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - `/workspace`, `/workspace/integrations`, `/grants`, `/token-access`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Self-Service Grants: Tabelle kompakt, Detail-Modal

- Done:
  - `frontend/src/App.tsx`: Grants-Tabelle Spalten reduziert; `GrantConnectionCell`, `GrantExpiresCell`, `GrantPolicyCell`, `GrantDetailPanel`; Modal „Grant details“; Hilfsfunktionen `splitConnectionLabel`, `grantPolicySummary`.
  - `frontend/src/components.tsx`: `DataTable` mit `tableClassName`, `wrapClassName`, `columnClasses`, `rowKey`.
  - `frontend/src/utils.ts`: `relativeTimeCompact`.
  - `frontend/src/index.css`: `.grants-table*`, Zellen-Layouts.
  - `docs/CHANGELOG.md` [Unreleased] Changed; Frontend-Build; `git add -f` für `frontend/dist/assets/*`.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/App.tsx
  - frontend/src/components.tsx
  - frontend/src/utils.ts
  - frontend/src/index.css
  - frontend/dist/
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - `/grants` (Your grants)
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Frontend: Karten-Layout (gleiche Höhe, Buttons unten)

- Done:
  - `frontend/src/index.css`: `integration-grid` mit `align-items: stretch`, `integration-card` mit `height: 100%`; `integration-card-body` für Beschreibung/Meta; `line-clamp` für Titel/Beschreibung/Meta; `integration-card-actions` mit `margin-top: auto` (Override `margin-top` bei `.user-integration-actions` entfernt); `integration-card-add` mit `justify-content: flex-start`; Metric-Karten als Flex-Spalte, `small` mit `margin-top: auto`; `metric-grid` / `workspace-metric-grid` mit `align-items: stretch`.
  - `frontend/src/admin/IntegrationsPage.tsx`, `frontend/src/UserIntegrationsPage.tsx`: Markup mit `integration-card-body`; Add-Karte mit `span`-Struktur im `<button>` (kein `div` im Button).
  - `docs/CHANGELOG.md` [Unreleased] Changed; Frontend-Build (`npm run build`); `git add -f` für neue `frontend/dist/assets/*` (unter `.gitignore`).
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
  - frontend/src/UserIntegrationsPage.tsx
  - frontend/dist/
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - Admin Integrations (`/app/integrations`), Self-Service Integrations (`/workspace/integrations`), Workspace Metric-Karten
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Integrations: Disconnect-Rand nicht mehr beschnitten

- Done:
  - `frontend/src/index.css`: `.user-integration-actions` ohne `overflow-x: auto` (Scrollport hatte rechten Button-Rand abgeschnitten); Grid `minmax(min(100%, 340px), 1fr)`; bei ≤420px `flex-wrap: wrap`.
  - `docs/CHANGELOG.md` [Unreleased] angepasst.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/index.css
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Changelog updated:
  - yes
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Sidebar-Nav: Rahmen zurückgenommen

- Done:
  - `frontend/src/index.css`: `.nav-link` wieder transparent ohne Rand, aktiver Eintrag mit Inset-Linie wie zuvor.
  - `docs/CHANGELOG.md` [Unreleased] angepasst.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/index.css
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – UI: Rahmen für Ghost/Theme/Nav, Integrations-Padding

- Done:
  - `frontend/src/index.css`: `.ghost-button`, `.theme-toggle-trigger`, `.nav-link`, `.tab`, `.landing-admin`, `.drawer-close` mit `var(--line)`-Rahmen; `.user-integration-actions` / `.drawer-footer-actions` mit Innenabstand gegen Abschneiden am Scrollrand.
  - `docs/CHANGELOG.md` [Unreleased] Changed ergänzt.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/index.css
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - Sidebar (Nav, Theme, Sign out), Integrations-Karten, Drawer-Footer
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Integrations: Aktionszeile, Bestätigung bei Trennen/Widerruf

- Done:
  - `frontend/src/index.css`: `.user-integration-actions` und `.drawer-footer-actions` ohne Zeilenumbruch bei Buttons; `.confirm-modal-*`, `.primary-button--danger`.
  - `frontend/src/components.tsx`: `ConfirmModal` (z-index über Drawer).
  - `UserIntegrationsPage`, `GrantsPage` in `App.tsx`, `AccessPage`, `UsersPage`: Bestätigungsdialog vor Disconnect / Grant-Revoke / Admin Remove.
  - `docs/CHANGELOG.md` [Unreleased] Changed ergänzt.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/components.tsx
  - frontend/src/index.css
  - frontend/src/UserIntegrationsPage.tsx
  - frontend/src/App.tsx
  - frontend/src/admin/AccessPage.tsx
  - frontend/src/admin/UsersPage.tsx
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
  - endpoints: keine
- UI path:
  - `/workspace/integrations` (Disconnect)
  - My Grants / Access / Users (Revoke/Remove)
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Docker Compose: Zeitzone, Legacy-Volume

- Done:
  - `docker-compose.yml`: `/etc/localtime` read-only gemountet; `./data:/legacy-data` entfernt; `SESSION_SECURE_COOKIE` aus den Compose-Env-Variablen des Backends entfernt.
  - `docs/CHANGELOG.md` [Unreleased] Changed ergänzt.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - docker-compose.yml
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: keine (Compose-Änderung)
  - endpoints: keine
- UI path:
  - keine
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - `SESSION_SECURE_COOKIE` bei HTTPS-Betrieb weiterhin per `.env`/Runtime setzen.

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

## 2026-04-04 – Cursor Agent – API-Zeitstempel UTC im Frontend

- Done:
  - `parseApiDateTime` in `frontend/src/utils.ts`: naive ISO-Strings von der API als UTC (`…Z`) parsen; `formatDateTime`, `relativeTime`, `relativeTimeCompact`, `toLocalDateTimeInput` angepasst; Ablaufprüfung in `App.tsx` und `AccessPage.tsx` mit gleicher Semantik.
  - `docs/CHANGELOG.md` [Unreleased] Fixed; `npm run build` im Frontend geprüft; gebündeltes JS unter `frontend/dist/assets/` per `git add -f` mit `index.html` abgeglichen.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/utils.ts
  - frontend/src/App.tsx
  - frontend/src/admin/AccessPage.tsx
  - frontend/dist/index.html
  - frontend/dist/assets/index-CklOOjfJ.js
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - Integrations-Details (Session), Grants, Admin Access
- Changelog updated:
  - yes ([Unreleased] Fixed)
- Follow-ups:
  - Backend könnte JSON künftig immer mit explizitem `Z` serialisieren (Pydantic); Frontend bleibt robust.

## 2026-04-04 – Cursor Agent – Delegation: Ablauf in Tagen

- Done:
  - API: `expires_in_days` (1–365, Standard 1) statt `expires_in_hours` in `DelegationGrantCreate` und `SelfServiceDelegationGrantCreate`; `expires_at` via `timedelta(days=…)` in `admin.py` und `user.py`.
  - Frontend: Formulare Access + Self-Service App access; `types.ts`; Legacy `src/index.js`: `expires_in_days` mit Fallback `expires_in_hours`.
  - `docs/CHANGELOG.md` [Unreleased] Changed; `npm run build`; gebündeltes Asset und `index.html` bei Bedarf per `git add -f`.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/schemas.py
  - backend/app/routers/admin.py
  - backend/app/routers/user.py
  - frontend/src/types.ts
  - frontend/src/App.tsx
  - frontend/src/admin/AccessPage.tsx
  - frontend/dist/ (falls eingecheckt)
  - src/index.js
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m py_compile …`, `cd frontend && npm run build`
- UI path:
  - `/app/access`, `/grants` (Create access)
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - Clients, die noch `expires_in_hours` an die FastAPI senden, müssen auf `expires_in_days` umstellen

## 2026-04-04 – Cursor Agent – Delegation: Standard 365 Tage

- Done:
  - `expires_in_days` Standardwert 365 in `schemas.py`, Formularvorgaben und Reset in `App.tsx` / `AccessPage.tsx`, Legacy-Tage-Fallback in `src/index.js`; `docs/CHANGELOG.md` angepasst.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/schemas.py
  - frontend/src/App.tsx
  - frontend/src/admin/AccessPage.tsx
  - src/index.js
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – UI Premium Pass

- Done:
  - Designsystem `frontend/src/index.css`: Tokens, Oberflächen, Modals (Blur/Animation), Sidebar/PageIntro, Tabellen, Ghost/Tabs/Integration-Karten.
  - `frontend/src/components.tsx`: `Modal`/`PageIntro`/Secrets; sichtbare Texte in Miro-Karte und Capability-Gate bereinigt.
  - `frontend/src/App.tsx`: Shell, Navigation, Grants/Activity/Login, Grant-Detailtexte, Tabellen ≤6 Spalten.
  - Admin- und User-Seiten: `DashboardPage`, `IntegrationsPage`, `UsersPage`, `ServicesPage`, `AccessPage`, `LogsPage`, `UserIntegrationsPage`, `SetupDrawer`; `index.html` Titel.
- Next:
  - bei Bedarf weitere Admin-Wizards auf einheitliche Modal-/Drawer-Muster prüfen
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/index.css
  - frontend/src/App.tsx
  - frontend/src/components.tsx
  - frontend/src/admin/DashboardPage.tsx
  - frontend/src/admin/IntegrationsPage.tsx
  - frontend/src/admin/UsersPage.tsx
  - frontend/src/admin/ServicesPage.tsx
  - frontend/src/admin/AccessPage.tsx
  - frontend/src/admin/LogsPage.tsx
  - frontend/src/UserIntegrationsPage.tsx
  - frontend/src/admin/SetupDrawer.tsx
  - frontend/index.html
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - Login, Workspace (Home, Integrations, Access, Activity), Admin (Overview, Integrations, People, Services, Access, Audit)
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Grants: Status-Filter (nur aktiv)

- Done:
  - `frontend/src/App.tsx`: `grantUiState` / `grantStateLabel`; `visibleGrants` (Default nur Active); Status-Chips; leere Zustände; gedämpfte Zeilen für nicht-aktive Einträge.
  - `frontend/src/components.tsx`: `DataTable` mit `rowClassName`, `wrapKey`.
  - `frontend/src/index.css`: Filterleiste, kurze Tabellen-Animation, `.data-table-row--grant-muted`.
  - `docs/CHANGELOG.md` [Unreleased] Changed.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/App.tsx
  - frontend/src/components.tsx
  - frontend/src/index.css
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - `/grants`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Grants: ein Toggle statt Status-Chips

- Done:
  - `frontend/src/App.tsx`: `showInactiveGrants`; Standard nur aktive Einträge; ein Button **Show expired and paused** / **Active only**; vollständige Liste bei eingeschaltetem Toggle.
  - `frontend/src/index.css`: `.grants-filter-toggle` statt Chips.
  - `docs/CHANGELOG.md` [Unreleased] angepasst.
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
- UI path:
  - `/grants`
- Changelog updated:
  - yes
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Generische Relay-Engine

- Done:
  - `backend/app/relay_engine.py`, `relay_config.py`, `oauth_connection_tokens.py`: `execute_relay_request`, Presets (Miro / Graph), OAuth-Refresh vereinheitlicht.
  - `backend/app/models.py`: `relay_config_json`; `seed.py` Spalte + Backfill; Anpassungen in `miro.py`, `legacy_miro.py`, `connections.py`, `deps.py`, `admin.py`, `user.py`, `microsoft_graph.py`.
  - Frontend: `types.ts`, `IntegrationsPage.tsx`, `App.tsx`, `AccessPage.tsx`, `UserIntegrationsPage.tsx`.
  - `docs/CHANGELOG.md` [Unreleased]; `test_welle1_smoke.py` Mock auf `execute_relay_request`.
- Next:
  - Optional: Relay-Config-UI (Header-Allowlist, Forwarding-Regeln).
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/relay_engine.py, relay_config.py, oauth_connection_tokens.py, models.py, seed.py, miro.py, routers/legacy_miro.py, routers/connections.py, routers/admin.py, routers/user.py, deps.py, microsoft_graph.py, schemas.py
  - backend/test_welle1_smoke.py
  - frontend/src/types.ts, admin/IntegrationsPage.tsx, App.tsx, admin/AccessPage.tsx, UserIntegrationsPage.tsx
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m py_compile backend/app/*.py backend/app/routers/*.py`, `cd frontend && npm run build`, `npm test`, `cd backend && pytest test_welle1_smoke.py -q`
- Endpoints:
  - `/miro/mcp/{profile_id}`, `/api/v1/broker-proxy/miro/{connected_account_id}`, Provider-App-Admin-APIs
- UI path:
  - Admin → Integrations; Workspace → App access; Admin → Access
- Changelog updated:
  - yes ([Unreleased] Added / Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Connection access details (generic UI)

- Done:
  - `backend/app/connection_access_details.py`, `schemas.py`: `ConnectionAccessDetailsOut`, Builder aus Miro-Payload; `GET/POST .../access-details` und `.../rotate` in `routers/connections.py`; `reset_miro` nutzt `issue_rotated_connection_access_key`.
  - `frontend/src/AccessCredentialSummary.tsx`, `accessCredentialMappers.ts`, `components.tsx` (`CredentialRevealModal`), `api.ts`, `types.ts`, `UserIntegrationsPage.tsx`, `App.tsx` (Grant-Detail, Add-access), `index.css`.
  - `backend/test_welle1_smoke.py`: Assertions für `access-details`; `docs/CHANGELOG.md` [Unreleased] Added.
- Next:
  - Weitere Integrationen am gleichen Schema (ohne Miro-Hardcode in der UI).
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/connection_access_details.py, schemas.py, routers/connections.py, test_welle1_smoke.py
  - frontend/src/AccessCredentialSummary.tsx, accessCredentialMappers.ts, components.tsx, api.ts, types.ts, UserIntegrationsPage.tsx, App.tsx, index.css
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m unittest test_welle1_smoke.Welle1SmokeTest.test_miro_access_bundle_and_legacy_proxy_run_on_fastapi_stack`, `cd frontend && npm run build`
- Endpoints:
  - `GET /api/v1/connections/{id}/access-details`, `POST /api/v1/connections/{id}/access-details/rotate`
- UI path:
  - Workspace → Integrations; Access → row → Details; Access → Add access
- Changelog updated:
  - yes ([Unreleased] Added)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Direct access connection details

- Done:
  - `connection_access_details.py`: Microsoft Graph mit Access type, Endpoint, Access request; OAuth-Key nur maskiert, `can_rotate` false.
  - `App.tsx` GrantDetailPanel: Zusammenfassung bei Direct oder Relay; `UserIntegrationsPage.tsx`: mehrere Connection-detail-Karten; `AccessCredentialSummary.tsx`: Hinweis ohne Rotate.
  - `test_welle1_smoke.py`: `test_graph_connection_access_details`; `docs/CHANGELOG.md` [Unreleased] Changed.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/connection_access_details.py, backend/test_welle1_smoke.py
  - frontend/src/App.tsx, UserIntegrationsPage.tsx, AccessCredentialSummary.tsx
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m unittest test_welle1_smoke.Welle1SmokeTest.test_graph_connection_access_details`, `cd frontend && npm run build`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Key-Zeile ohne Bullet-Duplikat

- Done:
  - `AccessCredentialSummary.tsx`: ein Statusstring; OAuth vs. Relay; Hinweis nur bei Relay-Rotation; `connection_access_details.py`: Graph-Label **OAuth token**.
  - `docs/CHANGELOG.md` [Unreleased] Changed.
- Next:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/AccessCredentialSummary.tsx, backend/app/connection_access_details.py, docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine
