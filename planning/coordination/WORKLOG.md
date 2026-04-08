## 2026-04-07 – Cursor Agent – dist push

- Done:
  - Commit `chore(frontend): aktualisierte dist-Assets und tsbuildinfo` (neue hashed JS/CSS, `index.html`, `tsconfig.tsbuildinfo`); Push `codex/hard-refactor-integration-model` → origin.
- Next: keine
- Blockers: keine
- Branch/PR: branch `codex/hard-refactor-integration-model`, PR none
- Files touched: `frontend/dist/assets/*`, `frontend/dist/index.html`, `frontend/tsconfig.tsbuildinfo`
- Changelog updated: no
- Follow-ups: keine

## 2026-04-07 – Cursor Agent – reconcile_schema PostgreSQL TIMESTAMP

- Done:
  - `backend/app/seed.py`: `reconcile_schema` setzt `deleted_at` / `invalidated_at` dialectabhängig (`TIMESTAMP` für PostgreSQL, `DATETIME` für SQLite).
  - `docs/CHANGELOG.md` [Unreleased] Fixed.
- Next: keine
- Blockers: keine
- Branch/PR: branch lokal, PR none
- Files touched: `backend/app/seed.py`, `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`
- Test notes: `python3 -m py_compile backend/app/seed.py`
- Changelog updated: yes (Unreleased Fixed)
- Follow-ups: keine

## 2026-04-07 – Cursor Agent – Destructive actions & Access-Grant-Lifecycle

- Done:
  - Backend: `AccessGrantStatus.INVALID`, `invalidated_at`; Soft-Delete `Integration`/`IntegrationInstance`; `access_grant_lifecycle` (Invalidierung mit Codes `connection_deleted`, `integration_deleted`, `critical_settings_changed`, `integration_config_changed`); `PATCH`/`DELETE` Instance, `DELETE` Integration (geschützte Defaults); `DELETE` Access-Grant; Consumer/Session-Routen prüfen `deleted_at`; `AccessGrantOut` um `effective_status`, `invalidation_reason` erweitert; `reconcile_schema` für neue Spalten.
  - Frontend: `ConfirmModal`-Flows; `ConnectionEditModal`; Connections Edit/Delete; Integrations Delete; Access Revoke/Remove; Labels `effective_status`, Invalidierungsgründe, `integrationDeletable`.
  - `docs/CHANGELOG.md`, WORKLOG.
- Next: keine
- Blockers: keine
- Branch/PR: branch lokal, PR none
- Files touched: `backend/app/models.py`, `backend/app/seed.py`, `backend/app/schemas.py`, `backend/app/services/access_grant_lifecycle.py`, `backend/app/services/access_grants.py`, `backend/app/routers/access_grants.py`, `backend/app/routers/integrations_v2.py`, `backend/app/routers/consumer_execution.py`, `backend/app/routers/integration_oauth.py`, `frontend/src/*` (Connections, Integrations, Access, api, types, labels), `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`
- Test notes: `PYTHONPATH=backend python3 -m unittest backend.test_smoke -v`; `cd frontend && npm run build`
- Changelog updated: yes (Unreleased Added)
- Follow-ups: keine

## 2026-04-07 – Cursor Agent – Usage-Modal nach Integrationstyp

- Done:
  - `AccessGrantUsageModal`: MCP-Discovery und Abschnitt „MCP connection“ nur bei `integration.type === "mcp_server"` und `mcp_enabled`; Texte für `oauth_provider` / `api` / `mcp_server` (Beschreibung, What-for, Endpunkt-Labels, Direct-token-Hinweis, Automation-JSON-Caption, Call-tool-Caption); **Advanced** (`X-User-Token`) nur bei `auth_mode === oauth`.
  - `docs/CHANGELOG.md` (Unreleased) ergänzt.
- Next: keine
- Blockers: keine
- Branch/PR: branch lokal, PR none
- Files touched: `frontend/src/AccessGrantUsageModal.tsx`, `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`
- Test notes: `cd frontend && npm run build`
- Changelog updated: yes (Unreleased Added, Ergänzung)
- Follow-ups: keine

## 2026-04-07 – Cursor Agent – Access Usage Modal

- Done:
  - `AccessGrantUsageModal.tsx`: produktorientierte „How to use this access“-Ansicht (Overview, What this access is for, Authentication, Available endpoints, optional MCP/Direct token, Examples mit Copy, Advanced `X-User-Token`, aufklappbare Raw details).
  - `BrokerAccessPage.tsx`: Aktion **Usage** pro Zeile; nach Key-Erstellung **How to use**; `AccessGrantDetailModal` optional **How to use**.
  - `frontend/src/index.css`: Styles für Usage-Snippets.
  - `docs/CHANGELOG.md` [Unreleased] Added.
- Next: keine
- Blockers: keine
- Branch/PR: branch lokal, PR none
- Files touched: `frontend/src/AccessGrantUsageModal.tsx`, `frontend/src/BrokerAccessPage.tsx`, `frontend/src/AccessGrantDetailModal.tsx`, `frontend/src/index.css`, `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`
- Test notes: `cd frontend && npm run build`
- endpoints: Consumer `POST /api/v1/consumer/integration-instances/{id}/execute`, optional `…/discover-tools`, `POST /api/v1/access-grants/validate`
- UI path: `/workspace/broker-access` → Usage / How to use
- Changelog updated: yes (Unreleased Added)
- Follow-ups: keine

## 2026-04-07 – Cursor Agent – Graph OAuth Profil via GET /me

- Done:
  - `integration_oauth._profile_metadata_for_oauth`: Für `microsoft_graph` zuerst `GET https://graph.microsoft.com/v1.0/me` mit Access Token (Anzeigename, E-Mail, UPN, ggf. Vor-/Nachname, Jobtitel); `id_token`-Claims nur noch als Ergänzung/Fallback (u. a. `tenant_id`).
  - `docs/CHANGELOG.md`, `docs/technische-referenz.md`, WORKLOG.
- Next: Bestehende Graph-Verbindung ggf. einmal Disconnect + Connect, damit Metadaten neu geschrieben werden.
- Blockers: keine
- Branch/PR: branch lokal, PR none
- Files touched: `backend/app/routers/integration_oauth.py`, `frontend/src/ConnectionDetailModal.tsx`, `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `planning/coordination/WORKLOG.md`
- Test notes: `python3 -m py_compile backend/app/routers/integration_oauth.py`; `cd frontend && npm run build`
- Changelog updated: yes (Unreleased Added, Beschreibung OAuth-Profil)
- Follow-ups: keine

## 2026-04-07 – Cursor Agent – Detail-Modale & GET integration-instances inspect

- Done:
  - Backend: `decode_jwt_payload_unverified` in `security.py`; OAuth-Callback schreibt Profil-Metadaten in `user_connections.metadata_json` (Graph: `id_token`; Miro: optional User-API); Disconnect leert Metadaten; `GET /api/v1/integration-instances/{id}/inspect` mit `IntegrationInstanceInspectOut`.
  - Frontend: `ConnectionDetailModal`, `IntegrationInspectModal`, `AccessGrantDetailModal`, `object-detail-ui` (Raw JSON); API `integrationInstanceInspect`; Connections- und Access-Tabelle zeilenklickbar + Open; Integrations „Open“ mit erweiterter Ansicht.
  - `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `backend/test_smoke.py` (401 auf inspect).
- Next: keine
- Blockers: keine
- Branch/PR: branch lokal, PR none
- Files touched: `backend/app/security.py`, `backend/app/routers/auth.py`, `backend/app/routers/integration_oauth.py`, `backend/app/routers/integrations_v2.py`, `backend/app/schemas.py`, `backend/test_smoke.py`, `frontend/src/*.tsx`, `frontend/src/index.css`, `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `planning/coordination/WORKLOG.md`
- Test notes: `PYTHONPATH=backend python3 -m unittest backend.test_smoke -v`; `cd frontend && npm run build`
- Changelog updated: yes (Unreleased Added)
- Follow-ups: Bestehende Verbindungen einmal neu verbinden, damit Profil-Metadaten gefüllt werden

## 2026-04-07 – Cursor Agent – Miro MCP OAuth Token-Endpoint (401 Client not found)

- Done:
  - `default_integrations.py`: `oauth_token_endpoint` = `{miro_mcp_base}/token`; `LEGACY_MIRO_REST_OAUTH_TOKEN_ENDPOINT`; `reconcile_miro_default_integration_token_endpoint` für leere oder frühere REST-Token-URL; Aufruf am Ende von `ensure_default_integrations`.
  - `integration_oauth.py`: Fallback Token-URL `{miro_mcp_base}/token`.
  - `docs/CHANGELOG.md` [Unreleased] Fixed; `docs/technische-referenz.md` (Miro MCP vs. REST Token-URL).
  - `backend/test_smoke.py`: `test_miro_default_integration_uses_mcp_token_endpoint`, `test_reconcile_miro_default_updates_legacy_rest_token_endpoint`.
- Next: keine
- Blockers: keine
- Branch/PR: branch lokal, PR none
- Files touched: `backend/app/default_integrations.py`, `backend/app/routers/integration_oauth.py`, `backend/test_smoke.py`, `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `planning/coordination/WORKLOG.md`
- Test notes: `PYTHONPATH=backend python3 -m unittest backend.test_smoke -v`
- Changelog updated: yes (Unreleased Fixed)
- Follow-ups: Nutzer nach Deploy: Connect erneut; bei Bedarf Disconnect vorher

## 2026-04-07 – Cursor Agent – Integration-OAuth Token-Exchange Diagnose-Logging

- Done:
  - `integration_oauth.py`: bei HTTP-Fehler vom Token-Endpoint von Miro bzw. Microsoft Graph `logging.warning` mit Status, Endpoint und gekürztem Response-Body (kein Klartext von Secrets im Request).
  - `docs/CHANGELOG.md` [Unreleased] Added.
- Next: Nutzer: `docker compose logs broker-backend` nach fehlgeschlagenem Connect; Miro-`error`/`error_description` auswerten.
- Blockers: keine
- Branch/PR: branch lokal, PR none
- Files touched: `backend/app/routers/integration_oauth.py`, `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`
- Test notes: `python3 -m py_compile backend/app/routers/integration_oauth.py`
- Changelog updated: yes (Unreleased Added)
- Follow-ups: keine

## 2026-04-07 – Cursor Agent – Graph Redirect /connections/microsoft-graph/callback

- Done:
  - `microsoft_graph_oauth_redirect_uri(settings, cfg)` in `microsoft_oauth_resolver.py`; Standardpfad `/connections/microsoft-graph/callback`; Env + `graph_oauth_redirect_uri` in Integration.
  - `GET /api/v1/connections/microsoft-graph/callback` (Alias); Pending-State `graph_redirect_uri` für Token-Austausch.
  - `broker-callback-urls.microsoft_graph` getrennt von Miro-Callback; `IntegrationsV2Page` Feld Redirect-Override; `.env.example`.
  - `docs/CHANGELOG.md`, `docs/technische-referenz.md`; `test_smoke` neuer Callback-Test.
- Next: keine
- Blockers: keine
- Branch/PR: branch `codex/hard-refactor-integration-model`, PR none
- Files touched: `backend/app/core/config.py`, `backend/app/microsoft_oauth_resolver.py`, `backend/app/routers/integration_oauth.py`, `backend/app/routers/integrations_v2.py`, `backend/app/routers/public.py`, `backend/app/default_integrations.py`, `backend/test_smoke.py`, `frontend/src/IntegrationsV2Page.tsx`, `.env.example`, `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `planning/coordination/WORKLOG.md`
- Test notes: `PYTHONPATH=backend python3 -m unittest backend.test_smoke -v`, `cd frontend && npm run build`
- Changelog updated: yes (Unreleased Changed)
- Follow-ups: Entra Redirect-URI in App-Registrierung auf neuen Pfad umstellen

## 2026-04-07 – Cursor Agent – Graph custom Entra + Miro DCR

- Done:
  - `resolve_microsoft_oauth_for_graph_integration`; `integration_oauth` Graph-Start/Callback; Miro DCR (`oauth_dcr.py`, `user_connections.oauth_dcr_*`), PKCE, statischer OAuth-Client optional; Disconnect leert DCR-Felder.
  - `PATCH /api/v1/integrations/{id}`; `IntegrationOut` mit Callback-URL und Secret-Flag; `broker-callback-urls` inkl. `integration_oauth`.
  - `seed.reconcile_schema` für neue Spalten; Default-Integration Miro (`oauth_authorization_endpoint` unter MCP-Basis, DCR-Flag).
  - Frontend: Graph-OAuth-Formular auf Integrations V2; `patchIntegrationV2`.
  - `docs/CHANGELOG.md`, `docs/technische-referenz.md`.
- Next: keine
- Blockers: keine
- Branch/PR: branch `codex/hard-refactor-integration-model`, PR none
- Files touched: `backend/app/microsoft_oauth_resolver.py`, `backend/app/routers/integration_oauth.py`, `backend/app/routers/integrations_v2.py`, `backend/app/routers/public.py`, `backend/app/schemas.py`, `backend/app/seed.py`, `backend/app/default_integrations.py`, `frontend/src/IntegrationsV2Page.tsx`, `frontend/src/api.ts`, `frontend/src/types.ts`, `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `planning/coordination/WORKLOG.md`
- Test notes: `PYTHONPATH=backend python3 -m unittest backend.test_smoke -v`, `cd frontend && npm run build`
- Changelog updated: yes (Unreleased Added/Changed)
- Follow-ups: bestehende DBs ohne Re-Seed: Miro-`config_json` manuell um DCR/Authorize-URL ergänzen oder neue Integration anlegen

## 2026-04-07 – Cursor Agent – User-OAuth Connect (Integration Instances)

- Done:
  - `upstream_oauth.py` + Session-`execute`/`discover-tools` nutzen `UserConnection` vor `X-User-Token`; `IntegrationInstanceOut.oauth_connected`.
  - Router `integration_oauth`: `POST .../oauth/start`, `GET .../oauth/callback`, `POST .../oauth/disconnect`; Microsoft Graph via `resolve_microsoft_oauth`; Miro via Endpoints in Seed + `MIRO_OAUTH_*`.
  - `UserConnection.oauth_refresh_token_encrypted`; `seed.reconcile_schema` für SQLite.
  - Frontend `IntegrationsV2Page`: Verbinden/Trennen, Query `connection_status`; `api.startIntegrationOAuth` / `disconnectIntegrationOAuth`.
  - `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `.env.example`; `backend/test_smoke.py`.
- Next: Refresh-Token-Rotation bei Ablauf
- Blockers: keine
- Branch/PR: branch `codex/hard-refactor-integration-model`, PR none
- Files touched: `backend/app/upstream_oauth.py`, `backend/app/routers/integration_oauth.py`, `backend/app/routers/integrations_v2.py`, `backend/app/services/access_grants.py`, `backend/app/models.py`, `backend/app/core/config.py`, `backend/app/default_integrations.py`, `backend/app/seed.py`, `backend/app/main.py`, `backend/test_smoke.py`, `frontend/src/IntegrationsV2Page.tsx`, `frontend/src/api.ts`, `frontend/src/types.ts`, `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `.env.example`, `planning/coordination/WORKLOG.md`
- Test notes: `PYTHONPATH=backend python3 -m unittest backend.test_smoke -v`, `cd frontend && npm run build`
- Changelog updated: yes (Unreleased Added/Changed)
- Follow-ups: Entra Redirect-URI in Deployment prüfen

## 2026-04-07 – Cursor Agent – Integrations-Anlage nur Admin

- Done:
  - `integrations_v2`: `require_admin` für `POST /integrations`, `POST /integration-instances`, `POST .../discover-tools` (persistiert Tool-Katalog).
  - `IntegrationsV2Page`: Anlegeformulare nur bei `is_admin`; `PageIntro`-Text angepasst.
  - `docs/CHANGELOG.md`, `docs/technische-referenz.md`.
- Next: keine
- Blockers: keine
- Branch/PR: branch `codex/hard-refactor-integration-model`, PR none
- Files touched: `backend/app/routers/integrations_v2.py`, `frontend/src/IntegrationsV2Page.tsx`, `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `planning/coordination/WORKLOG.md`
- Test notes: `PYTHONPATH=backend python3 -m unittest backend.test_smoke -v`, `cd frontend && npm run build`
- Changelog updated: yes (Unreleased Changed)
- Follow-ups: bei Bedarf `execute` nur für bestimmte Rollen

## 2026-04-07 – Cursor Agent – Default-Integrationen Miro + Graph (V2-Seed)

- Done:
  - `backend/app/default_integrations.py`: idempotente Vorlagen **Miro MCP** (`mcp_server`, Endpoint unter `miro_mcp_base`, OAuth-Instanz) und **Microsoft Graph** (`oauth_provider`, OAuth-URLs aus Settings, `mcp_enabled` false).
  - `seed.py`: `ensure_default_integrations` nach Bootstrap-User.
  - Tests: `test_seed_creates_default_integrations`; Doku `docs/technische-referenz.md`, `docs/CHANGELOG.md`.
- Next: optional UI-Kennzeichnung `template_key` in der Integrationsliste.
- Blockers: keine
- Branch/PR: branch `codex/hard-refactor-integration-model`, PR none
- Files touched: `backend/app/default_integrations.py`, `backend/app/seed.py`, `backend/test_smoke.py`, `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `planning/coordination/WORKLOG.md`
- Test notes: `PYTHONPATH=backend python3 -m unittest backend.test_smoke -v`
- Changelog updated: yes (Unreleased Added)
- Follow-ups: Graph-REST-Executor falls gewünscht (aktuell kein MCP-Upstream)

## 2026-04-07 – Cursor Agent – AccessGrant / Consumer Access (Domain-Fix)

- Done:
  - Domain: `UserConnection`, `AccessGrant` in `models.py`; `IntegrationInstance.access_*` im Kommentar als Broker-Relay-Metadaten von Consumer-Access getrennt.
  - Service `services/access_grants.py` (Key-Ausgabe `bkr_…`, SHA-256-Lookup-Hash, OAuth-Upstream-Auflösung über UserConnection oder optional `X-User-Token`).
  - Router `access_grants`: CRUD-ähnlich (Liste, Erstellen mit einmaligem Klartext-Key, Details, Revoke, `POST .../validate` ohne Session).
  - Router `consumer_execution`: `POST /consumer/integration-instances/{id}/execute` und `.../discover-tools` mit `X-Broker-Access-Key` / `Authorization: Bearer bkr_…`; `enforce_consumer_tool_policy` in `execution_engine_v2`.
  - Frontend: `BrokerAccessPage`, Route `/workspace/broker-access`, Navigation, API-Methoden, Legacy-Pfade `/grants` → Broker-Zugang.
  - Doku: `docs/CHANGELOG.md`, `docs/technische-referenz.md`; Tests in `backend/test_smoke.py`.
- Next: OAuth-„Verbindung herstellen“-UI zum Befüllen von `UserConnection.oauth_access_token_encrypted` (falls gewünscht).
- Blockers: keine
- Branch/PR: branch `codex/hard-refactor-integration-model`, PR none
- Files touched: `backend/app/models.py`, `backend/app/schemas.py`, `backend/app/execution_engine_v2.py`, `backend/app/main.py`, `backend/app/services/access_grants.py`, `backend/app/routers/access_grants.py`, `backend/app/routers/consumer_execution.py`, `backend/test_smoke.py`, `frontend/src/App.tsx`, `frontend/src/api.ts`, `frontend/src/types.ts`, `frontend/src/utils.ts`, `frontend/src/BrokerAccessPage.tsx`, `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `planning/coordination/WORKLOG.md`
- Test notes: `PYTHONPATH=backend python3 -m unittest backend.test_smoke -v`, `cd frontend && npm run build`
- endpoints: `GET/POST /api/v1/access-grants`, `POST /api/v1/access-grants/validate`, `POST /api/v1/access-grants/{id}/revoke`, `POST /api/v1/consumer/integration-instances/{id}/execute`, `POST .../discover-tools`
- UI path: `/workspace/broker-access`
- Changelog updated: yes (Unreleased Added/Changed)
- Follow-ups: UserConnection-OAuth-Flow UI; Rate-Limits für `/validate` falls öffentlich exponiert

## 2026-04-07 – Cursor Agent – Microsoft OAuth Admin (Workspace)

- Done:
  - DB-Modell `MicrosoftOAuthSettings`, Resolver `microsoft_oauth_resolver` (vollständige DB-Konfiguration vor `MICROSOFT_BROKER_*`), Anpassungen in `auth` und `public` (`login-options`).
  - Router `admin_microsoft_oauth`: `GET/PUT /api/v1/admin/microsoft-oauth` (Admin, `PUT` mit CSRF).
  - Frontend: `MicrosoftOAuthAdminPage`, Route `/workspace/admin/microsoft-oauth`, Sidebar-Eintrag für Admins, `HttpMethod` um `PUT` ergänzt.
  - `test_smoke`: `TestClient` als Kontextmanager (Lifespan), Test `test_admin_microsoft_oauth_requires_session`.
  - `docs/CHANGELOG.md`, `docs/technische-referenz.md`.
- Next: keine
- Blockers: keine
- Branch/PR: branch `codex/hard-refactor-integration-model`, PR none
- Files touched: `backend/app/models.py`, `backend/app/microsoft_oauth_resolver.py`, `backend/app/routers/auth.py`, `backend/app/routers/public.py`, `backend/app/routers/admin_microsoft_oauth.py`, `backend/app/main.py`, `backend/app/schemas.py`, `backend/test_smoke.py`, `frontend/src/App.tsx`, `frontend/src/api.ts`, `frontend/src/types.ts`, `frontend/src/utils.ts`, `frontend/src/MicrosoftOAuthAdminPage.tsx`, `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `planning/coordination/WORKLOG.md`
- Test notes: `PYTHONPATH=backend python3 -m unittest backend.test_smoke -v`, `cd frontend && npm run build`
- endpoints: `GET/PUT /api/v1/admin/microsoft-oauth`
- UI path: `/workspace/admin/microsoft-oauth`
- Changelog updated: yes (Unreleased Added/Changed)
- Follow-ups: bei Bedarf weitere Admin-Einstellungen nach gleichem Muster

## 2026-04-07 – Cursor Agent – OAuth-Broker UX-Terminologie (Admin/User)

- Done:
  - `frontend/src/brokerTerminology.ts`: kanonische UI-Strings und Formatter (Access-Modi, Verbindungsarten, Relay, Token-Outcome-Labels, Upstream-Auth-Zusammenfassung).
  - `IntegrationOverview.tsx`: Detailseite (Labels, Advanced-Bereich, Metrik „Recent token activity (sample)“, einheitliche Token-Outcome-Beschriftung mit Activity-Seite).
  - `IntegrationsPage.tsx`: Wizard-Felder (available access methods, relay transport/API style, authentication to upstream, OAuth-Endpunkt-Labels).
  - `App.tsx`: `formatTokenIssueDecisionLabel`, `formatAccessModeShortLabel`; Access-Key-Actions ohne „connection key“-Variante.
  - `oauthIntegrationStatus.ts`: Fehlermeldungen „Authorization endpoint“ / „Token endpoint“.
  - `docs/CHANGELOG.md` [Unreleased] Changed.
- Next: keine
- Blockers: keine
- Branch/PR: branch `codex/oauth-broker-redesign`, PR none
- Files touched: `frontend/src/brokerTerminology.ts`, `frontend/src/admin/IntegrationOverview.tsx`, `frontend/src/admin/IntegrationsPage.tsx`, `frontend/src/App.tsx`, `frontend/src/oauthIntegrationStatus.ts`, `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`
- Test notes: `cd frontend && npm run build`
- Changelog updated: yes (Unreleased Changed)
- Follow-ups: bei Bedarf weiteres Audit weiterer Admin-Seiten (Access, Users) auf verbliebene Legacy-Formulierungen

## 2026-04-07 – Cursor Agent – Admin Integration Detail Basic/Technical

- Done:
  - `IntegrationOverview.tsx`: Variantenlogik (`integrationVariant`); Miro: schlanke Basic-Karten (Configuration, Usage, Health); Microsoft/Custom: Overview + Configuration; Custom: OAuth-Endpoints + DCR-Zeile im Basic; Sektion **Technical details** (ehem. Advanced), Standard zu; Miro-Metadaten/Scopes in Technical; `formatAuthenticationToUpstreamBasic` für kompakte Miro-Upstream-Zeile; Relay-Keys und `advancedRelayRows` nur Technical.
  - `brokerTerminology.ts`: `technicalDetails`, DCR-/Registrierungs-Labels, `tokenDeliveryDetail`; `formatAuthenticationToUpstreamBasic`.
  - `index.css`: `.integration-advanced-block`.
  - `docs/CHANGELOG.md` [Unreleased] Changed.
- Next: keine
- Blockers: keine
- Branch/PR: branch `codex/oauth-broker-redesign`, PR none
- Files touched: `frontend/src/admin/IntegrationOverview.tsx`, `frontend/src/brokerTerminology.ts`, `frontend/src/index.css`, `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`, `frontend/dist/*` (nach Build)
- Test notes: `cd frontend && npm run build`
- Changelog updated: yes (Unreleased Changed)
- Follow-ups: keine

## 2026-04-07 – Cursor Agent – Cursor-Regel Terminologie & Naming

- Done:
  - Neue Regel `.cursor/rules/terminology-naming-consistency.mdc` (globs `**/*.{tsx,ts,js,jsx,py,md}`): ein Konzept = ein Primärbegriff, UI-sprachlich klar, technische Rohbegriffe in Advanced-Bereichen, Mapping-Legacy/API, Workflow Audit → Glossar → Umsetzung → Self-Check.
  - `docs/CHANGELOG.md` [Unreleased] Added ergänzt.
- Next: keine
- Blockers: keine
- Branch/PR: branch `codex/oauth-broker-redesign`, PR none
- Files touched: `.cursor/rules/terminology-naming-consistency.mdc`, `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`
- Test notes: keine (nur Regel/Doku)
- Changelog updated: yes (Unreleased Added)
- Follow-ups: keine

## 2026-04-05 – Cursor Agent – Force-Delete Custom Integration

- Done:
  - `DELETE …/provider-apps/{id}?force=true`: Grants widerrufen, Verbindungen widerrufen, `TokenMaterial` entfernen, OAuth-Pending-Zeilen löschen, dann Soft-Delete; Audit `cleared_dependencies`.
  - Admin-Modal: Checkbox für automatisches Widerrufen; API `deleteProviderApp(..., { force })`.
  - Test: 409 ohne Force, 204 mit Force bei aktiver Verbindung; `docs/CHANGELOG.md`.
- Next: keine
- Blockers: keine
- Branch/PR: branch `codex/oauth-broker-redesign`, PR none
- Files touched: `backend/app/provider_app_delete.py`, `backend/app/routers/admin.py`, `backend/test_provider_app_delete.py`, `frontend/src/api.ts`, `frontend/src/admin/IntegrationsPage.tsx`, `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`, `frontend/dist/*`
- Test notes: `python3 -m unittest test_provider_app_delete`, `npm run build`
- Changelog updated: yes (Unreleased Added)
- Follow-ups: keine

## 2026-04-05 – Cursor Agent – Custom Integration Soft-Delete

- Done:
  - Soft-Delete: `provider_apps.deleted_at`, `is_enabled=false`, Client-Secret entfernt, `key` mit Suffix für Unique-Constraint; `ProviderInstance` ohne verbleibende aktive App deaktiviert.
  - Blocker: aktive Delegation Grants (nicht revoked, nicht abgelaufen), nicht widerrufene `ConnectedAccount`, offene `oauth_pending_states` (Flow `generic_provider_connect`).
  - API `DELETE /api/v1/admin/provider-apps/{id}`; 409 mit strukturiertem `detail`; Audit-Events; `GET` user/admin Listen filtern gelöschte Apps; `deps`/`generic_oauth`/`provider_templates` angepasst.
  - Frontend: Remove + `ConfirmModal`, API `deleteProviderApp`, 409-Toast; `api.ts` parst `detail`-Objekte.
  - Tests `backend/test_provider_app_delete.py`; `docs/CHANGELOG.md`.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/models.py, seed.py, schemas.py, provider_app_delete.py, routers/admin.py, connections.py, user.py, deps.py, provider_templates.py, generic_oauth.py
  - backend/test_provider_app_delete.py
  - frontend/src/api.ts, types.ts, admin/IntegrationsPage.tsx, admin/IntegrationOverview.tsx
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m py_compile …`, `python3 -m unittest test_provider_app_delete test_generic_oauth`, `cd frontend && npm run build`
  - endpoints: `DELETE /api/v1/admin/provider-apps/{id}` (CSRF)
  - UI path: /app/integrations → Custom-Karte / Detail „Remove“
- Changelog updated:
  - yes (Unreleased Added)
- Follow-ups:
  - keine

## 2026-04-05 – Cursor Agent – Custom-Integration Wizard & PKCE-Status

- Done:
  - `statusLabel` / `IntegrationOverview.oauthConfigured`: OAuth konfiguriert mit Client-ID + Authorize-/Token-URL + (Secret oder PKCE); Microsoft-Tenant-Logik unverändert.
  - Custom-Wizard: Felder für Endpoints, Issuer, Scopes/Ceiling, PKCE, Connection Types, Relay (`relay_config` + `relay_protocol`), Enabled; Merge von `settings`/`relay_config` beim Update; Create mit `provider_definition_key: generic_oauth`.
  - Backend: Seed `generic_oauth`; `ProviderAppUpdate.clear_client_secret`; `_apply_provider_app_payload` löscht Secret bei Flag.
  - `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`; `frontend/dist` (index.html + JS mit `git add -f`).
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/schemas.py, backend/app/routers/admin.py, backend/app/seed.py
  - frontend/src/admin/IntegrationsPage.tsx, IntegrationOverview.tsx, constants.ts
  - frontend/dist/index.html, frontend/dist/assets/index-CSIneTnr.js
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m py_compile …`, `python3 -m unittest backend/test_welle1_smoke.py`, `cd frontend && npm run build`
  - endpoints: Admin PATCH provider-apps mit `clear_client_secret`
  - UI path: /app/integrations → Custom integration
- Changelog updated:
  - yes (Unreleased Added/Changed/Fixed)
- Follow-ups:
  - keine

## 2026-04-05 – Cursor Agent – Generic OAuth Custom Self-Service

- Done:
  - Backend: `generic_oauth.py` (Start, Callback, Refresh, Probe); `connections.py` Branch für `template_key is None`; Callback-Route ersetzt „unsupported“; `ProviderAppOut` OAuth-Felder; Admin `_provider_app_out` befüllt dieselben Felder.
  - Pending: bestehende `oauth_pending_states` + Flow `generic_provider_connect` (kein neues Model).
  - Refresh/Probe: **Option MVP+** — generischer Refresh (PKCE ohne Secret vs. mit Secret); Probe über UserInfo bzw. gespeicherte Referenz.
  - Frontend: `oauthIntegrationStatus.ts`; `UserIntegrationsPage`, `IntegrationsPage`, `IntegrationOverview`, Workspace-Metrik; `App.tsx` connectableCount inkl. Custom.
  - Tests: `backend/test_generic_oauth.py`; Smoke + npm test + `npm run build`.
  - `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`; `frontend/dist`.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/generic_oauth.py, routers/connections.py, routers/admin.py, schemas.py, test_generic_oauth.py
  - frontend/src/oauthIntegrationStatus.ts, UserIntegrationsPage.tsx, App.tsx, admin/IntegrationsPage.tsx, admin/IntegrationOverview.tsx, types.ts
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md, frontend/dist/*
- Test notes:
  - commands: `python3 -m unittest backend/test_generic_oauth.py backend/test_welle1_smoke.py`, `npm test`, `cd frontend && npm run build`
  - endpoints: provider-connect/start, provider-oauth/callback
  - UI path: /workspace/integrations
- Changelog updated:
  - yes (Unreleased Added/Changed)
- Follow-ups:
  - optional: `client_secret_basic` für Token-Endpoint

## 2026-04-05 – Cursor Agent – Client-Terminologie & Auto-Key

- Done:
  - `ServiceClientCreate`: `key` optional; ohne Eingabe UUID via `new_id()`; manuelles `key` weiter erlaubt (API).
  - `MyClientsPage`: nur **Name** beim Anlegen; Tabelle **Client ID**; Edit-Modal mit read-only Client-ID.
  - `App.tsx` (Access, Activity, Filter): „App“ → „Client“ / „Direct“ / „Callers“ wo Service-Client gemeint.
  - `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`; `frontend/dist` Build.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/schemas.py, backend/app/routers/user.py
  - frontend/src/App.tsx, MyClientsPage.tsx, types.ts, frontend/dist/*
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m unittest backend/test_welle1_smoke.py`, `cd frontend && npm run build`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Access-Modal Layout (SaaS)

- Done:
  - `frontend/src/App.tsx`: Access-Modal einspaltig (Access key → Endpoint → Connection); `AccessModalEndpoint` / `AccessModalConnection`; Schlüssel in `.access-modal-key-scroll` mit `access-modal-key-text`; **Usage example** und **Developer details** als getrennte `<details>`.
  - `frontend/src/index.css`: Credentials-Card, Bundle/Context-Trenner, `secret-line`/`key-scroll`-Styles; `access-modal-root` Abstand; entferntes 2-Spalten-Grid.
  - `docs/CHANGELOG.md`: [Unreleased] / Changed.
  - `planning/coordination/WORKLOG.md`: dieser Eintrag.
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
  - UI path: Self-Service App access → Zeile → Modal **Access**
- Changelog updated:
  - yes (Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – git push (dist + Branch)

- Done:
  - `frontend/dist`: `npm run build`; `index.html` und `assets/index-*.js` / `index-*.css` per `git add -f` eingecheckt; `git push` `codex/oauth-broker-redesign` → `origin`.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/dist/index.html
  - frontend/dist/assets/index-BdXiX1Cs.js
  - frontend/dist/assets/index-r3BwuCIG.css
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- Changelog updated:
  - yes (Changed, dist-Abgleich)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – cURL Direct: X-Access-Key

- Done:
  - `frontend/src/App.tsx`: Im **Direct**-Zweig des **cURL**-Beispiels `X-Access-Key: <access key>` ergänzt (`/token-issues/provider-access` verlangt denselben Delegation-Grant wie Relay).
  - `docs/CHANGELOG.md`: Eintrag unter [Unreleased] / Fixed.
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
- Changelog updated:
  - yes (Fixed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Access-Modal cURL-Beispiel

- Done:
  - `frontend/src/App.tsx`: **Usage example** → **cURL**; Inhalt als `curl -sS …` mit `-H` / `-d`, Relay inkl. `X-Access-Key: <access key>`; `shellSingleQuoted` für sichere Quotes im kopierten Befehl.
  - `docs/CHANGELOG.md`: Eintrag unter [Unreleased] / Changed.
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
  - UI path: Self-Service App access → Zeile → Modal **Access** → **cURL** aufklappen → **Copy**
- Changelog updated:
  - yes (Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Access-Modal Layout (kompakt)

- Done:
  - `frontend/src/App.tsx`: Access-Detail mit 2-Spalten-Grid (`GrantAppAccessKeySection`, `ConnectionCredentialGridCells`), Endpoint + Copy in einer Zeile, `createPortal` für Replace-Confirm; Developer-Bereich mit verschachtelten `<details>` für Usage/Headers.
  - `frontend/src/index.css`: Grid-, Feld- und Disclosure-Styles; `.access-modal-root` volle Breite.
  - `docs/CHANGELOG.md`: Eintrag unter [Unreleased] / Changed.
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
  - UI path: Self-Service App access → Zeile öffnen → Modal **Access**
- Changelog updated:
  - yes (Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Keine Lookup-Fallbacks ohne secret_lookup_hash

- Done:
  - `backend/app/deps.py`: `_find_delegation_grant_by_credential` ohne Scan nach Grants mit `credential_lookup_hash IS NULL`; Service-Client-Auth ohne Fallback für `secret_lookup_hash IS NULL`.
  - `docs/CHANGELOG.md`, `docs/technische-referenz.md`: Formulierungen ohne „Legacy-Bestand“-Rahmen bei Relay/Delegated-Credential.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/deps.py
  - docs/CHANGELOG.md
  - docs/technische-referenz.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - `cd backend && python3 -m unittest test_welle1_smoke -v`
- Changelog updated:
  - yes (Changed / technische Referenz)
- Follow-ups:
  - Datenbankzeilen ohne `credential_lookup_hash` / ohne `secret_lookup_hash` authentifizieren nicht mehr; bei Bedarf einmalig per Migration befüllen.

## 2026-04-04 – Cursor Agent – Miro Relay-Key verschlüsselt speichern

- Done:
  - `connected_accounts.encrypted_legacy_relay_token`; `reconcile_schema`; `ensure_legacy_miro_identity` + `issue_rotated_connection_access_key` schreiben Fernet-Ciphertext; `build_miro_access_payload` entschlüsselt für API-Antworten.
  - `test_welle1_smoke`: Erwartungen für `miro-access` / `access-details` (Key `ready` mit Klartext nach Erstausstellung).
  - `docs/CHANGELOG.md`, `docs/technische-referenz.md`.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/models.py
  - backend/app/seed.py
  - backend/app/miro.py
  - backend/app/connection_access_details.py
  - backend/test_welle1_smoke.py
  - docs/CHANGELOG.md
  - docs/technische-referenz.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - `cd backend && python3 -m unittest test_welle1_smoke -v`
- UI path:
  - `/grants` → **Access** (Miro-Verbindung)
- Changelog updated:
  - yes (Added, Changed)
- Follow-ups:
  - Delegation-Grants ohne `encrypted_delegated_credential` (sehr alter Bestand): Klartext nicht rekonstruierbar; Nutzer **Replace key** einmalig oder Datenmigration aus Backup.

## 2026-04-04 – Cursor Agent – Access-Key Icons im Modal

- Done:
  - `frontend/src/App.tsx`: `GrantAppAccessKeySection` und `AccessConnectionTool` – Access Key in `.access-modal-secret-line` mit `AccessKeyIconActions` (Auge/Kopieren); **Replace key** getrennt.
  - `frontend/src/index.css`: `.access-modal-secret-line`, `.access-key-icon-group`, `.access-key-icon-btn`, `.access-modal-replace-key`, `.access-modal-key-box--grow`.
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
  - `/grants` → Zeile → **Access** (App-Zugang + Verbindung)
- Changelog updated:
  - yes (Changed)
- Follow-ups:
  - keine

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

## 2026-04-04 – Cursor Agent – Access Key / X-Access-Key Vereinheitlichung

- Done:
  - Backend: `AccessCredential`-Alias, `coalesce_service_access_headers` / `coalesce_legacy_mcp_access_headers`, `diagnose_service_access(..., access_credential=...)`, Responses `access_credential`, `AccessCredentialRotateOut`, `GET .../access-credential` + Legacy `.../delegated-credential`, MCP-JSON `X-Access-Key`, Legacy-MCP akzeptiert `X-Access-Key` vor `X-Relay-Key`.
  - Frontend: API/Typen, UI-Texte „Access key“, CSS `grant-access-credential-*`, Developer-Beispiele, `SecretPanel`-Titel.
  - Doku: README, AGENTS.md, `docs/technische-referenz.md`, `docs/funktionsuebersicht.md`, `docs/CHANGELOG.md`; Legacy `src/index.js` Header/JSON.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/deps.py, schemas.py, miro.py, routers/token_issuance.py, connections.py, legacy_miro.py, user.py, admin.py, test_welle1_smoke.py
  - frontend/src/App.tsx, api.ts, types.ts, index.css, AccessCredentialSummary.tsx, accessCredentialMappers.ts, admin/AccessPage.tsx
  - README.md, AGENTS.md, docs/CHANGELOG.md, docs/technische-referenz.md, docs/funktionsuebersicht.md, src/index.js, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m unittest backend.test_welle1_smoke -v`, `cd frontend && npm run build`, `npm test`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Access-Modal: Access key vs. Connection key

- Done:
  - `GrantDetailPanel` / `AccessConnectionTool` (`App.tsx`): Abschnitte **Access** und **Connection** mit klarer Benennung; Hilfetexte; **Developer details** mit eingebettetem Usage example; ARIA für Schlüssel-Aktionen (`access` vs. `connection`); Toasts/Replace-Labels für Verbindungsschlüssel angepasst.
  - `index.css`: `.access-modal-section*`, Trennlinie zwischen Abschnitten.
  - `AccessCredentialSummary.tsx`, `accessCredentialMappers.ts`: **Connection key** für Verbindungsdaten.
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
  - frontend/src/AccessCredentialSummary.tsx
  - frontend/src/accessCredentialMappers.ts
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- UI path:
  - Self-Service **Access** → Zeile → Modal **Access**
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – App access key oben im Access-Detailmodal

- Done:
  - `GrantDetailPanel` (`App.tsx`): `GrantAppAccessKeySection` (Reveal, Copy, Replace für Delegated Credential) aus **Developer details** nach oben verschoben (nach Verbindungs-Hinweisen, vor Connection/Endpoint-Block).
  - `docs/CHANGELOG.md` [Unreleased] Changed (Bullet zum Access-Detailmodal angepasst).
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
- UI path:
  - Self-Service **Access** → Zeile → **Access details** → Delegated App-Zugangsschlüssel oben
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Replace access key als Icon

- Done:
  - `App.tsx`: `IconRefresh`, `AccessKeyIconActions` mit optionalem Replace (Refresh-Icon), Spinner bei `replaceBusy`; Grant **Access key** und Connection **stored**-Key: Replace neben Show/Copy statt darunter; Missing-Zeile mit Icon statt Text-Button.
  - `index.css`: `.access-modal-missing-key-row`, `.access-key-icon-spinner`, `.access-modal-key-inline-hint`.
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/App.tsx, frontend/src/index.css, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- Changelog updated:
  - no
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Access-Modal Breite

- Done:
  - `App.tsx`: Modal **Access** (Grant-Details) mit `wide`; `index.css`: `.modal-panel--wide` max. 640px → 720px.
- Next:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/src/App.tsx, frontend/src/index.css, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- Changelog updated:
  - no
- Follow-ups:
  - keine

## 2026-04-05 – Cursor Agent – Nutzergesteuerte Service Clients

- Done:
  - Backend: `service_clients.created_by_user_id`, `reconcile_schema` + Backfill; User-CRUD `/api/v1/service-clients` (+ rotate-secret); Admin nur GET Org-Liste + `GET .../admin/users/{user_id}/service-clients`; Admin POST/DELETE Service-Clients entfernt; `diagnose_service_access` verlangt bei gebundenem Grant `X-Service-Secret`; Delegation-Create prüft Client-Besitz.
  - Frontend: `/workspace/clients` (`MyClientsPage`), Admin-Services-Seite entfernt; Access-Admin lädt Clients pro gewählter Person; Grants-Dropdown nur aktive eigene Clients + Hinweis `X-Service-Secret`.
  - Tests: `test_welle1_smoke.py` (gebundener Grant ohne Secret → 401); `docs/CHANGELOG.md`, `docs/technische-referenz.md`, `README.md`.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/models.py, seed.py, schemas.py, deps.py, routers/user.py, routers/admin.py, test_welle1_smoke.py
  - frontend/src/App.tsx, api.ts, types.ts, MyClientsPage.tsx, admin/AccessPage.tsx, admin/DashboardPage.tsx; removed admin/ServicesPage.tsx
  - docs/CHANGELOG.md, docs/technische-referenz.md, README.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m unittest backend/test_welle1_smoke.py`, `cd frontend && npm run build`
- Changelog updated:
  - yes ([Unreleased] Fixed/Added/Changed)
- Follow-ups:
  - keine

## 2026-04-04 – Cursor Agent – Unified Key: Legacy Relay entfernt

- Done:
  - `legacy_miro.py` entfernt; `ConnectedAccount` ohne Legacy-Spalten; `miro.py` ohne Relay-Token/Setup-Token; `connection_access_details` mit Miro-Broker-URL; Routen `miro-access`, `setup/exchange`, `access-details/rotate` entfernt; Schemas bereinigt.
  - Frontend: ein Access-Key-Flow; `ConnectionEndpointGridCells`; API ohne Miro-Relay-Endpoints; `UserIntegrationsPage` ohne `miro_setup`-Exchange; `AccessCredentialSummary` angepasst.
  - `haproxy.cfg`: API-Backend nur `/api`; `broker.db` gelöscht; `docs/CHANGELOG.md`, `AGENTS.md`; `test_welle1_smoke.py` angepasst.
- Next:
  - README/technische-referenz bei Bedarf nachziehen.
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/main.py, models.py, miro.py, connection_access_details.py, routers/connections.py, schemas.py, deps.py, seed.py, test_welle1_smoke.py
  - frontend/src/App.tsx, api.ts, types.ts, AccessCredentialSummary.tsx, UserIntegrationsPage.tsx; removed accessCredentialMappers.ts
  - haproxy/haproxy.cfg, docs/CHANGELOG.md, AGENTS.md, broker.db (deleted)
- Test notes:
  - commands: `python3 -m unittest backend/test_welle1_smoke.py`, `cd frontend && npm run build`
- Changelog updated:
  - yes ([Unreleased] Removed/Changed)
- Follow-ups:
  - README.md und docs/technische-referenz.md noch auf Legacy-Pfade prüfen

## 2026-04-05 11:06 – Cursor Agent – TypeScript-Build-Info synchronisieren

- Done:
  - `frontend/tsconfig.tsbuildinfo` nach Projektänderung aktualisiert (`oauthintegrationstatus.ts` in `root`); Commit und Push auf `codex/oauth-broker-redesign`.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - frontend/tsconfig.tsbuildinfo
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build` (optional, zur Verifikation)
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - keine

## 2026-04-05 – Cursor Agent – Dynamic Client Registration (DCR)

- Done:
  - `provider_apps`: `oauth_dynamic_client_registration_enabled`, `oauth_registration_endpoint`, `oauth_registration_auth_method`; Reconcile in `seed.py`; Pydantic-Validierung bei DCR an.
  - `oauth_integration_status.py`, `oauth_dcr.py` (RFC7591-ähnliche Registrierung); `generic_oauth.py`: DCR-Pfad mit Pending-State; Refresh bevorzugt `ConnectedAccount`-OAuth-Felder.
  - `miro.py`: Registrierung über konfigurierbaren Endpoint / statischer Client bei DCR aus; Seed/Backfill Miro-Default DCR + `https://mcp.miro.com/register`.
  - Admin/User `ProviderAppOut` erweitert; Integrations-Wizard Miro + Custom: DCR-Toggle, Registration-URL; `oauthIntegrationConfigured` abgestimmt.
  - `backend/test_oauth_integration_status.py`; `docs/CHANGELOG.md` [Unreleased] Added.
- Next:
  - Bei Bedarf: Registration `bearer`/`basic` in `oauth_dcr` implementieren.
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/models.py, schemas.py, seed.py, generic_oauth.py, miro.py, routers/admin.py, routers/connections.py, oauth_dcr.py, oauth_integration_status.py, test_oauth_integration_status.py
  - frontend/src/types.ts, oauthIntegrationStatus.ts, admin/IntegrationsPage.tsx, dist/* (gebaute Assets)
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `PYTHONPATH=backend python3 -m unittest discover -s backend -p "test_*.py"`, `cd frontend && npm run build`
- Changelog updated:
  - yes ([Unreleased] Added)
- Follow-ups:
  - keine

## 2026-04-07 – cursor-agent – OAuth Broker: Personal/Shared Access, Tool Discovery & Policy Enforcement

- Done:
  - Phase 1: `credential_scope` (personal/shared) und `managed_by_user_id` auf `ConnectedAccount`; Schema-Reconcile + Backfill; `ConnectedAccountOut`/`ConnectedAccountCreate` erweitert
  - Phase 2: Admin-API `shared-credentials` (CRUD, Revoke, Refresh); `SharedCredentialCreate`/`SharedCredentialOut` Schemas
  - Phase 3: `DiscoveredTool`-Modell + `ToolAccessPolicy`-Modell; `tool_discovery.py` (MCP tools/list, SSE-Parsing, Normalisierung); Admin-Endpunkte discover-tools, tools, tool-policies, bulk
  - Phase 4: `tool_policy.py` mit `check_tool_access()`, `get_effective_policy()`, `filter_tools_list_response()`
  - Phase 5: Relay Engine MCP Body-Parsing (`parse_mcp_request`), `tools/call` Policy-Check vor Upstream, `tools/list` Response-Filterung (JSON + SSE), credential_scope Durchleitung
  - Phase 6: User UI Shared-Credentials-Sektion, Execution-Identity-Badge in Details und Grant-Panel, `brokerTerminology.ts` erweitert
  - Phase 7: Admin Tool Management Panel (Discovery-Button, Policy-Tabelle mit Checkboxen), Shared Credentials Panel in Integration Detail
- Next:
  - E2E-Tests mit laufendem MCP-Upstream
  - Admin-UI: Shared-Credential-Erstellung (OAuth-Flow für Shared) statt nur manueller Token-Eingabe
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/oauth-broker-redesign
  - PR: none
- Files touched:
  - backend/app/models.py, schemas.py, seed.py, relay_engine.py, tool_discovery.py, tool_policy.py, connection_serializers.py
  - backend/app/routers/admin.py, connections.py
  - frontend/src/types.ts, api.ts, brokerTerminology.ts, UserIntegrationsPage.tsx, App.tsx
  - frontend/src/admin/IntegrationsPage.tsx, ToolManagementPanel.tsx, SharedCredentialsPanel.tsx
  - docs/CHANGELOG.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m py_compile backend/app/*.py backend/app/routers/*.py`, `cd frontend && npx tsc --noEmit && npm run build`
  - endpoints: `POST /admin/shared-credentials`, `POST /admin/provider-apps/{id}/discover-tools`, `GET /admin/provider-apps/{id}/tools`, `GET /admin/provider-apps/{id}/tool-policies`, `PATCH /admin/tool-policies/{id}`, `GET /shared-credentials`
  - UI path: /app/integrations/{id} (Shared Credentials + Tool Management Panels), /workspace/integrations (Shared Access Sektion)
- Changelog updated:
  - yes ([Unreleased] Added: 10 Eintraege)
- Follow-ups:
  - OAuth-basierte Shared-Credential-Erstellung (Admin startet OAuth-Flow fuer Shared Account)
  - Automatisches Tool-Discovery (Background-Job statt manueller Trigger)
  - Policy-Caching (LRU) fuer Performance bei hohem Relay-Traffic

## 2026-04-07 11:48 – cursor-agent – Hard Cut auf Integration V2

- Done:
  - Neuen V2-Branch-Stand umgesetzt: Modelle `Integration`, `IntegrationInstance`, `IntegrationTool` ergänzt.
  - Generischen MCP-Client und V2-Execution-Engine (Auth-Modi: `none`, `oauth`, `api_key`, `shared_credentials`) implementiert.
  - Neue V2-Router `integrations_v2` eingebunden und Runtime-Router in `main.py` auf `public`, `auth`, `integrations_v2` reduziert.
  - Frontend auf V2-Navigation geschnitten: zentrale Route `/workspace/integrations-v2`, neue Seite `IntegrationsV2Page`.
  - Legacy-Workspace-Routen auf V2 umgebogen.
  - Planungsdokument `planning/integration-v2-hard-cut.md` für API/DB-Änderungen ergänzt.
- Next:
  - Legacy-Modelle und Legacy-Routerdateien physisch entfernen.
  - Auth/Seed vollständig von alten Provider-App-Tabellen entkoppeln.
  - V2-Tool-Discovery im Frontend (Anzeige und Tool-Call) vervollständigen.
- Blockers:
  - Keine funktionalen Blocker; vollständige physische Löschung des Legacy-Codes ist noch offen.
- Branch/PR:
  - branch: codex/hard-refactor-integration-model
  - PR: none
- Files touched:
  - backend/app/main.py
  - backend/app/models.py
  - backend/app/schemas.py
  - backend/app/mcp_client.py
  - backend/app/execution_engine_v2.py
  - backend/app/routers/integrations_v2.py
  - frontend/src/App.tsx
  - frontend/src/api.ts
  - frontend/src/types.ts
  - frontend/src/utils.ts
  - frontend/src/IntegrationsV2Page.tsx
  - docs/CHANGELOG.md
  - planning/integration-v2-hard-cut.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m py_compile backend/app/*.py backend/app/routers/*.py backend/app/core/*.py`, `cd frontend && npm run build`
  - endpoints: `/api/v1/integrations`, `/api/v1/integration-instances`, `/api/v1/integration-instances/{id}/execute`, `/api/v1/integration-instances/{id}/discover-tools`
  - UI path: `/workspace/integrations-v2`
- Changelog updated:
  - yes ([Unreleased] Added/Changed)
- Follow-ups:
  - Vollständige Deletion der Legacy-Provider-/Connection-/Relay-Struktur in separatem Bereinigungsschritt.

## 2026-04-07 11:53 – cursor-agent – Physische Legacy-Bereinigung (V2)

- Done:
  - `models.py` auf Organisation, Nutzer, Session, Audit, OAuth-Pending, `oauth_identities`, V2-Integrations-Tabellen reduziert.
  - `seed.py` ohne Provider-Definitionen/-Apps; nur Organisation und Bootstrap-Admin.
  - Microsoft-Enduser-Login in `auth.py` über Umgebungsvariablen und `oauth_identities`; Redirect nach `/workspace/integrations-v2`.
  - `public.py` ohne Provider-Definitions-Endpoint; `schemas.py` und `deps.py` auf Session/CSRF/Audit reduziert.
  - Legacy-Backend-Dateien und -Router entfernt; `backend/test_smoke.py` ergänzt; alte Backend-Unit-Tests zu Provider/Connections entfernt.
  - Frontend auf schlanke `App.tsx`, `api.ts`, `types.ts`, `utils.ts`; Admin- und Workspace-Legacy-Seiten gelöscht.
  - `docs/CHANGELOG.md` [Unreleased] Removed; `planning/integration-v2-hard-cut.md` um physische Bereinigung ergänzt.
- Next:
  - `docs/technische-referenz.md` und README an V2 anpassen (optional).
  - Optional: MCP-Protokoll-Details im generischen Client an echte Upstream-Konvention anbinden.
- Blockers:
  - Bestehende `broker.db` kann historische Tabellen enthalten; bei Bedarf Datei löschen und neu starten.
- Branch/PR:
  - branch: codex/hard-refactor-integration-model
  - PR: none
- Files touched:
  - backend/app/models.py, seed.py, schemas.py, deps.py, core/config.py, routers/auth.py, routers/public.py, execution_engine_v2.py, test_smoke.py
  - backend: entfernte Module und Router (siehe git diff)
  - frontend/src/App.tsx, api.ts, types.ts, utils.ts, IntegrationsV2Page.tsx
  - frontend/src: entfernte Legacy-Komponenten (siehe git diff)
  - docs/CHANGELOG.md, planning/integration-v2-hard-cut.md, planning/coordination/WORKLOG.md
- Test notes:
  - commands: `python3 -m py_compile backend/app/*.py backend/app/routers/*.py backend/app/core/*.py`, `PYTHONPATH=backend python3 -m unittest backend.test_smoke -v`, `cd frontend && npm run build`, `npm test`
- Changelog updated:
  - yes ([Unreleased] Removed)
- Follow-ups:
  - keine kritischen

## 2026-04-07 – Cursor Agent – Clarity UI Mono v2 (Workspace)

- Done:
  - `index.css`: Spacing-Skala durchgezogen, `--ink-primary`, `.muted`, `stack-cell`/`stack-cell--row`, Form-Actions in Karten, Primärbutton ohne Lift, diverse Radius/Padding-Anpassungen.
  - `App.tsx`: Sidebar `brand-kicker`, Nav-Label „Access“.
  - `IntegrationsV2Page.tsx`, `BrokerAccessPage.tsx`: englische Nutzer-Texte, klarere Feld- und Kartentitel, Verbindungszeilen-Layout.
  - `docs/CHANGELOG.md` [Unreleased] Changed.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: codex/hard-refactor-integration-model
  - PR: none
- Files touched:
  - frontend/src/index.css
  - frontend/src/App.tsx
  - frontend/src/IntegrationsV2Page.tsx
  - frontend/src/BrokerAccessPage.tsx
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
  - UI path: `/workspace/integrations-v2`, `/workspace/broker-access`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - Ausnahmen: Blur-/Shadow-Offsets, `vh`/`min-width` in Mediaqueries bleiben nicht auf der 4–32-px-Rasterliste (technisch notwendig).

## 2026-04-07 – Cursor Agent – English-only UI

- Done:
  - `formatDateTime`: locale `en` so formatted dates/times are English regardless of browser locale.
  - `formatOAuthCallbackMessage` + use on Integrations OAuth return: English descriptions for redirect error codes.
  - `docs/CHANGELOG.md`: newest [Unreleased] / Changed bullets translated to English.
- Next:
  - Optional: translate remaining long [Unreleased] changelog history from German.
- Blockers:
  - none
- Branch/PR:
  - branch: codex/hard-refactor-integration-model
  - PR: none
- Files touched:
  - frontend/src/utils.ts
  - frontend/src/IntegrationsV2Page.tsx
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - none

## 2026-04-07 – Cursor Agent – Workspace object UI (integrations / connections / access)

- Done:
  - `integrationLabels.ts`: domain-to-UI labels for integration type, auth mode, access mode, grant status, card copy, lifecycle badges.
  - `IntegrationsV2Page.tsx`: card grid; modals for add integration, add connection, Graph OAuth settings, detail; `View connections` navigates to `/workspace/connections?for=…`.
  - `ConnectionsPage.tsx` (new): connection table; `ConnectionCreateModal`; OAuth return query handling; `Add connection` for admins.
  - `ConnectionCreateModal.tsx`, `IntegrationCreateModal.tsx`, `GraphOAuthSettingsModal.tsx` (new).
  - `BrokerAccessPage.tsx`: access key table; `AccessKeyCreateModal`; loads integrations for integration column.
  - `App.tsx`, `types.ts`, `utils.ts`: route `/workspace/connections`, nav order Integrations → Connections → Access; legacy `/app/connections` → connections.
  - `docs/CHANGELOG.md` [Unreleased] Changed.
- Next:
  - none
- Blockers:
  - none
- Branch/PR:
  - branch: codex/hard-refactor-integration-model
  - PR: none
- Files touched:
  - frontend/src/integrationLabels.ts, IntegrationCreateModal.tsx, ConnectionCreateModal.tsx, GraphOAuthSettingsModal.tsx, ConnectionsPage.tsx, IntegrationsV2Page.tsx, BrokerAccessPage.tsx, App.tsx, types.ts, utils.ts
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `cd frontend && npm run build`
  - UI path: `/workspace/integrations-v2`, `/workspace/connections`, `/workspace/broker-access`
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - none

## 2026-04-07 – Cursor Agent – Consumer MCP streamable HTTP relay

- Done:
  - `backend/app/mcp_relay_engine.py`: Header-Filter, URL-Join, Gleichheit gegen konfiguriertes Endpoint, kein Literal-IP-Upstream.
  - `backend/app/services/consumer_access.py`: gemeinsame Grant-/Instance-/Integration-Auflösung für Consumer-APIs.
  - `backend/app/routers/consumer_mcp_relay.py`: `ANY …/consumer/integration-instances/{id}/mcp` (+ optional `path`), Streaming über httpx, Audit `consumer_mcp_relay`, `GET …/mcp-connection-info`.
  - `consumer_execution.py` nutzt `resolve_consumer_grant_context`; `main.py` registriert Relay-Router.
  - `backend/test_smoke.py`: Relay ohne Key → 401.
  - `frontend/src/AccessGrantUsageModal.tsx`: streamable-http JSON, curl-Beispiele, Abschnitt MCP streamable HTTP.
  - `docs/CHANGELOG.md` [Unreleased] Added.
- Next:
  - none
- Blockers:
  - none
- Branch/PR:
  - branch: codex/hard-refactor-integration-model
  - PR: none
- Files touched:
  - backend/app/mcp_relay_engine.py, services/consumer_access.py, routers/consumer_mcp_relay.py, routers/consumer_execution.py, main.py, test_smoke.py
  - frontend/src/AccessGrantUsageModal.tsx
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands: `PYTHONPATH=backend python3 -m unittest backend.test_smoke -v`, `cd frontend && npm run build`
  - endpoints: `POST /api/v1/consumer/integration-instances/{id}/mcp`, `GET /api/v1/consumer/integration-instances/{id}/mcp-connection-info`
  - UI path: `/workspace/broker-access` → Access key → How to use
- Changelog updated:
  - yes ([Unreleased] Added)
- Follow-ups:
  - none

## 2026-04-07 – Cursor Agent – Consumer MCP relay stream ReadError

- Done:
  - `backend/app/routers/consumer_mcp_relay.py`: `passthrough` fängt `httpx.ReadError` beim Streamen der Upstream-Antwort ab, loggt `mcp_relay_upstream_stream_closed` (instance_id + Exception-Typ), `finally` schließt weiterhin `upstream`; vermeidet ASGI-Traceback bei vorzeitigem Verbindungsabbruch.
  - `docs/CHANGELOG.md` [Unreleased] Fixed.
- Next: keine
- Blockers: keine
- Branch/PR: branch lokal, PR none
- Files touched: `backend/app/routers/consumer_mcp_relay.py`, `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`
- Test notes:
  - commands: `python3 -m py_compile backend/app/routers/consumer_mcp_relay.py`
  - endpoints: `POST /api/v1/consumer/integration-instances/{id}/mcp` (Streaming)
- Changelog updated: yes ([Unreleased] Fixed)
- Follow-ups: keine

## 2026-04-07 – Cursor Agent – debug-mcp-consumer-relay script

- Done:
  - `scripts/debug-mcp-consumer-relay.py`: Health, `mcp-connection-info`, JSON-RPC initialize / notifications/initialized / tools/list gegen Consumer-MCP-Relay; httpx; `.env` optional; `--insecure` für lokales HTTPS; Maskierung des Keys in der Ausgabe.
  - `docs/CHANGELOG.md` [Unreleased] Added, `AGENTS.md` Practical Verification.
- Next: keine
- Blockers: keine
- Branch/PR: branch lokal, PR none
- Files touched: `scripts/debug-mcp-consumer-relay.py`, `docs/CHANGELOG.md`, `AGENTS.md`, `planning/coordination/WORKLOG.md`
- Test notes: `python3 -m py_compile scripts/debug-mcp-consumer-relay.py`
- Changelog updated: yes ([Unreleased] Added)
- Follow-ups: keine

## 2026-04-07 – Cursor Agent – MCP relay upstream client reuse (tools/list)

- Done:
  - `consumer_mcp_relay.py`: `httpx.AsyncClient` pro Access-Grant gecacht (`OrderedDict`, LRU 256, `Limits(max_connections=1)`), `shutdown_relay_upstream_clients` für Prozessende.
  - `main.py`: `shutdown`-Event schließt Relay-Clients.
  - `mcp_relay_engine.py`: `import httpx` für `filter_upstream_response_headers`-Annotation.
  - `debug-mcp-consumer-relay.py`: Tool-Namen nach `tools/list`, robustere SSE-/Body-Parsing-Hilfen.
  - `docs/CHANGELOG.md` [Unreleased] Fixed.
- Next: keine
- Blockers: keine
- Branch/PR: branch lokal, PR none
- Files touched: `backend/app/routers/consumer_mcp_relay.py`, `backend/app/main.py`, `backend/app/mcp_relay_engine.py`, `scripts/debug-mcp-consumer-relay.py`, `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`
- Test notes: `docker compose build broker-backend`, recreate `broker-backend`, `scripts/debug-mcp-consumer-relay.py` gegen localhost — `tools/list` liefert u. a. 13 Miro-Tool-Namen.
- Changelog updated: yes ([Unreleased] Fixed)
- Follow-ups: Multi-Worker / Sticky-Session dokumentiert in Changelog

## 2026-04-07 – Cursor Agent – MCP-Relay Troubleshooting-Doku + Logging

- Done:
  - `docs/troubleshooting-consumer-mcp-relay.md`, `AGENTS.md` (Link + Rule-Files-Zeile), `.cursor/rules/mcp-relay-troubleshooting.mdc`.
  - `consumer_mcp_relay.py`: `mcp_relay_upstream_client_cache_hit` / `cache_miss`, `mcp_relay_upstream_response_start`.
  - `docs/CHANGELOG.md` [Unreleased] Added/Changed.
- Next: keine
- Blockers: keine
- Branch/PR: branch lokal, PR none
- Files touched: `docs/troubleshooting-consumer-mcp-relay.md`, `AGENTS.md`, `.cursor/rules/mcp-relay-troubleshooting.mdc`, `backend/app/routers/consumer_mcp_relay.py`, `docs/CHANGELOG.md`, `planning/coordination/WORKLOG.md`
- Test notes: `python3 -m py_compile backend/app/routers/consumer_mcp_relay.py`
- Changelog updated: yes ([Unreleased] Added, Changed)
- Follow-ups: keine

## 2026-04-08 11:39 – Cursor Agent – OAuth expiry check + auto-refresh

- Done:
  - `backend/app/routers/integration_oauth.py`: speichert beim OAuth-Callback `oauth_expires_at`, `oauth_token_endpoint` und Provider-Kind in `user_connections.metadata_json`.
  - `backend/app/upstream_oauth.py`: zentrale serverseitige Expiry-Prüfung mit automatischem `refresh_token`-Flow (Miro, Microsoft Graph, Custom-OAuth mit konfiguriertem Token-Endpoint und Client-Credentials); persistiert rotiertes Access-/Refresh-Token plus neues `oauth_expires_at`.
  - Legacy-Verbindungen ohne Expiry-Metadaten werden beim nächsten Zugriff einmalig refresh-versucht, um auf den neuen Ablauf zu migrieren.
  - `backend/app/services/access_grants.py`: Grant-Token-Auflösung nutzt zentrale Refresh-Funktion.
  - `docs/CHANGELOG.md` [Unreleased] Fixed ergänzt.
- Next:
  - Optional: reaktiven Retry nach Upstream-401 im `consumer_mcp_relay` ergänzen.
  - Optional: dedizierte Backend-Tests für Refresh-Happy-Path und Refresh-Fehlerfall ergänzen.
- Blockers:
  - none
- Branch/PR:
  - branch: codex/hard-refactor-integration-model
  - PR: none
- Files touched:
  - backend/app/routers/integration_oauth.py
  - backend/app/upstream_oauth.py
  - backend/app/services/access_grants.py
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands:
    - `python3 -m py_compile backend/app/upstream_oauth.py backend/app/routers/integration_oauth.py backend/app/services/access_grants.py`
  - endpoints:
    - `POST /api/v1/integration-instances/{id}/oauth/start`
    - `GET /api/v1/integration-instances/oauth/callback`
    - `POST /api/v1/consumer/integration-instances/{id}/execute`
    - `ANY /api/v1/consumer/integration-instances/{id}/mcp`
  - UI path:
    - `/workspace/integrations-v2`
- Changelog updated:
  - yes ([Unreleased] Fixed)
- Follow-ups:
  - Refresh-401-Retry nur bei Bedarf ergänzen, falls Provider trotz Expiry-Vorprüfung sporadisch `401` liefert.

## 2026-04-08 11:42 – Cursor Agent – Connection modal OAuth token timing

- Done:
  - `backend/app/upstream_oauth.py`: bei erfolgreichem Refresh wird zusätzlich `oauth_last_refresh_at` in `user_connections.metadata_json` persistiert.
  - `frontend/src/ConnectionDetailModal.tsx`: Connected-account-Details zeigen jetzt `Access token expires` (aus `oauth_expires_at`) und `Last token refresh` (aus `oauth_last_refresh_at`) mit klaren Fallback-Texten.
  - `docs/CHANGELOG.md` [Unreleased] Added ergänzt.
- Next:
  - Optional `oauth_last_refresh_at` auch als explizites Feld in einem typed Backend-Schema ausgeben, statt nur über `profile`.
- Blockers:
  - none
- Branch/PR:
  - branch: codex/hard-refactor-integration-model
  - PR: none
- Files touched:
  - backend/app/upstream_oauth.py
  - frontend/src/ConnectionDetailModal.tsx
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands:
    - `python3 -m py_compile backend/app/upstream_oauth.py`
  - endpoints:
    - `GET /api/v1/integration-instances/{id}/inspect`
  - UI path:
    - `/workspace/connections` → `Open` (Connection-Modal)
- Changelog updated:
  - yes ([Unreleased] Added)
- Follow-ups:
  - Optional Anzeige einer relativen Zeit („vor 5 Minuten“) zusätzlich zu Datum/Uhrzeit.

## 2026-04-08 11:47 – Cursor Agent – User darf Connection-Test ausführen

- Done:
  - `backend/app/routers/integrations_v2.py`: `discover-tools`-Route verwendet jetzt `get_current_user` statt `require_admin`.
  - Dadurch funktioniert der Test-Button in `/workspace/connections` auch für normale eingeloggte Nutzer.
  - `docs/CHANGELOG.md` [Unreleased] Fixed ergänzt.
- Next:
  - Optional: produktseitig prüfen, ob Nicht-Admins den Test in allen gewünschten Rollen sehen sollen.
- Blockers:
  - none
- Branch/PR:
  - branch: codex/hard-refactor-integration-model
  - PR: none
- Files touched:
  - backend/app/routers/integrations_v2.py
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands:
    - `python3 -m py_compile backend/app/routers/integrations_v2.py`
  - endpoints:
    - `POST /api/v1/integration-instances/{id}/discover-tools`
  - UI path:
    - `/workspace/connections` → `Test`
- Changelog updated:
  - yes ([Unreleased] Fixed)
- Follow-ups:
  - none

## 2026-04-08 11:53 – Cursor Agent – README strukturiert und praxisnah überarbeitet

- Done:
  - `README.md` vollständig neu strukturiert und auf den aktiven Projektstand angepasst (FastAPI + React/Vite, Integration V2, Access Grants, Consumer Execute, MCP Relay).
  - Konkrete API-/CLI-Beispiele ergänzt (`auth/login`, `access-grants`, `consumer execute`, `discover-tools`, `mcp`).
  - `docs/CHANGELOG.md` unter `[Unreleased] Changed` ergänzt.
- Next:
  - Optional README um Architekturdiagramm ergänzen, falls für Onboarding gewünscht.
- Blockers:
  - none
- Branch/PR:
  - branch: codex/hard-refactor-integration-model
  - PR: none
- Files touched:
  - README.md
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands:
    - none (Dokumentationsänderung)
  - endpoints:
    - none
  - UI path:
    - none
- Changelog updated:
  - yes ([Unreleased] Changed)
- Follow-ups:
  - none

## 2026-04-08 – Cursor Agent – Merge codex/hard-refactor-integration-model nach master

- Done:
  - Arbeitsbaum war bereits sauber (keine offenen Commits).
  - Branch `codex/hard-refactor-integration-model` per Fast-Forward in `master` gemerged; `origin/master` gepusht (`60836ff..9ac77c2`).
- Next:
  - none
- Blockers:
  - none
- Branch/PR:
  - branch: master (nach Merge)
  - PR: none
- Files touched:
  - planning/coordination/WORKLOG.md (dieser Eintrag)
- Test notes:
  - commands:
    - `git merge codex/hard-refactor-integration-model`, `git push origin master`
  - endpoints:
    - none
  - UI path:
    - none
- Changelog updated:
  - no (reiner Git-Flow)
- Follow-ups:
  - Im Repo gibt es keinen Branch `main`; Standard-Remote-Branch ist `master`.

## 2026-04-08 – Cursor Agent – Branch feature/dev angelegt

- Done:
  - Branch `feature/dev` von `master` erstellt, `origin/feature/dev` mit Upstream (`git push -u`).
  - Hinweis: Ein Branch mit exaktem Namen `feature` ist wegen bestehendem `feature/multi-user-profiles` in Git nicht möglich.
- Next:
  - none
- Blockers:
  - none
- Branch/PR:
  - branch: feature/dev
  - PR: none
- Files touched:
  - planning/coordination/WORKLOG.md (dieser Eintrag)
- Test notes:
  - commands:
    - `git checkout -b feature/dev`, `git push -u origin feature/dev`
  - endpoints:
    - none
  - UI path:
    - none
- Changelog updated:
  - no
- Follow-ups:
  - none

## 2026-04-08 – Cursor Agent – Broker Login Refactor (generisches OAuth/OIDC)

- Done:
  - `app/broker_login`: `CanonicalUserClaims`, `AuthFlowFailure`, `BrokerLoginAuthProvider`, `MicrosoftEntraLoginProvider`, `GenericOidcLoginProvider`, Registry, `upsert_user_and_oauth_identity`.
  - Routen `POST/GET /api/v1/auth/{provider_id}/start|callback`, Pending-Flow `broker_login` (Provider-Binding, Correlation-ID), Audit `auth.broker_login.success`.
  - DB `broker_login_providers`, Admin-API `/api/v1/admin/broker-login-providers`; `login-options` liefert `login_providers`.
  - Frontend: Landing-Buttons pro Provider; `docs/troubleshooting-broker-login.md`, `docker-compose.test.yml` (Keycloak dev), `docs/technische-referenz.md` SSO-Abschnitt, `docs/CHANGELOG.md`, Tests `backend/test_broker_login.py`.
- Next:
  - Keycloak-Realm + feste E2E gegen laufenden IdP optional nachziehen; JWKS-validiertes `id_token` falls nötig.
- Blockers:
  - none
- Branch/PR:
  - branch: (lokal)
  - PR: none
- Files touched:
  - backend/app/broker_login/*, backend/app/routers/auth.py, public.py, admin_login_providers.py, main.py, models.py, schemas.py, test_smoke.py, test_broker_login.py
  - frontend/src/App.tsx, api.ts, types.ts, index.css
  - docs/*, docker-compose.test.yml
- Test notes:
  - commands:
    - `PYTHONPATH=backend python3 -m unittest backend.test_smoke backend.test_broker_login -v`
    - `cd frontend && npm run build`
  - endpoints:
    - `GET /api/v1/auth/login-options`, `POST /api/v1/auth/microsoft/start`, `GET /api/v1/admin/broker-login-providers` (401 ohne Session)
  - UI path:
    - `/` Landing SSO-Buttons
- Changelog updated:
  - yes ([Unreleased] Added)
- Follow-ups:
  - none

## 2026-04-08 – Cursor Agent – Keycloak-Integration: Discovery auf localhost normalisieren

- Done:
  - `test_keycloak_broker_login_integration`: nach Discovery werden Issuer/Token/Userinfo/JWKS auf `KEYCLOAK_BASE_URL` umgeschrieben; Docstring + Runbook; `TestDiscoveryOriginHelpers`.
- Next:
  - none
- Blockers:
  - none
- Branch/PR:
  - branch: feature/dev
  - PR: none
- Files touched:
  - backend/test_keycloak_broker_login_integration.py
  - docs/runbook-broker-login-testing.md
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands:
    - `PYTHONPATH=backend python3 -m unittest backend.test_keycloak_broker_login_integration -v`
- Changelog updated:
  - yes ([Unreleased] Added, Keycloak-Integration-Zeile erweitert)
- Follow-ups:
  - none

## 2026-04-08 – Cursor Agent – OIDC Split-URL Test (Auth vs. Token-Host)

- Done:
  - `test_broker_login_flow.test_generic_oidc_public_auth_host_internal_token_host`: Mock prüft `auth_url` gegen `localhost:8180` und POST/GET gegen `http://keycloak:8180/.../token|userinfo`.
  - `MockAsyncTransport` optional mit `record_urls`; Runbook- und CHANGELOG-Hinweis.
- Next:
  - none
- Blockers:
  - none
- Branch/PR:
  - branch: feature/dev
  - PR: none
- Files touched:
  - backend/test_broker_login_flow.py
  - docs/runbook-broker-login-testing.md
  - docs/CHANGELOG.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands:
    - `PYTHONPATH=backend python3 -m unittest backend.test_broker_login_flow.TestBrokerLoginFlow.test_generic_oidc_public_auth_host_internal_token_host -v`
  - endpoints:
    - `POST /api/v1/auth/oidc-split-host-test/start`, `GET …/callback` (Testdaten)
  - UI path:
    - none
- Changelog updated:
  - yes ([Unreleased] Added)
- Follow-ups:
  - E2E mit realem Keycloak und Split-URLs nur im Container-Netz sinnvoll (Host-Unittest kann `keycloak` nicht auflösen).

## 2026-04-08 – Cursor Agent – Keycloak-Integrationstest Broker-Login

- Done:
  - `backend/test_keycloak_broker_login_integration.py`: bei `KEYCLOAK_LOGIN_INTEGRATION=1` browserloser Authorization-Code-Flow gegen Keycloak (Formular), anschließend Broker-Callback ohne HTTP-Mocks.
  - `testing/keycloak/import/broker-test-realm.json`: Redirect-URIs für **broker-login-confidential** um `http://localhost:8000/*` und `http://127.0.0.1:8000/*` ergänzt.
  - `docker-compose.test.yml` (Keycloak-Teststack), `.env.test.example` (Testpasswort-Hinweis), `docs/runbook-broker-login-testing.md`, `docs/CHANGELOG.md`, `AGENTS.md`.
- Next:
  - none
- Blockers:
  - none
- Branch/PR:
  - branch: feature/dev
  - PR: none
- Files touched:
  - backend/test_keycloak_broker_login_integration.py
  - testing/keycloak/import/broker-test-realm.json
  - docker-compose.test.yml
  - .env.test.example
  - docs/runbook-broker-login-testing.md
  - docs/CHANGELOG.md
  - AGENTS.md
  - planning/coordination/WORKLOG.md
- Test notes:
  - commands:
    - `python3 -m py_compile backend/test_keycloak_broker_login_integration.py`
    - `PYTHONPATH=backend python3 -m unittest backend.test_keycloak_broker_login_integration -v` (skip ohne Flag)
    - mit Keycloak: `KEYCLOAK_LOGIN_INTEGRATION=1 PYTHONPATH=backend python3 -m unittest backend.test_keycloak_broker_login_integration -v`
  - endpoints:
    - `POST /api/v1/auth/keycloak-it/start`, `GET /api/v1/auth/keycloak-it/callback` (nur im Integrationstest)
  - UI path:
    - none
- Changelog updated:
  - yes ([Unreleased] Added)
- Follow-ups:
  - none

## 2026-04-08 – Cursor Agent – Login-Refactor Abschluss (UI, Keycloak-Tests, Flow-Tests)

- Done:
  - Admin-UI **Sign-in providers** (`BrokerLoginProvidersAdminPage.tsx`, Route `/workspace/admin/login-providers`, API-Anbindung).
  - Backend: OIDC-Config mit http(s)-URL-Validierung und Pflicht-Claim-Pfaden `subject`/`email`.
  - `docker-compose.test.yml`: Keycloak mit `--import-realm`, `testing/keycloak/import/broker-test-realm.json`, `.env.test.example`.
  - `backend/test_broker_login_flow.py` (Microsoft + generischer OIDC Happy Path, Fehlerpfade, Admin 422).
  - `docs/runbook-broker-login-testing.md`, Verweis in `docs/troubleshooting-broker-login.md`, `docs/CHANGELOG.md`, `AGENTS.md`.
- Next:
  - Playwright/CI-E2E gegen laufenden Keycloak optional; `id_token`-Signaturprüfung (JWKS) falls produktionsrelevant.
- Blockers:
  - none
- Branch/PR:
  - branch: feature/dev
  - PR: none
- Files touched:
  - frontend: `BrokerLoginProvidersAdminPage.tsx`, `App.tsx`, `api.ts`, `types.ts`, `utils.ts`
  - backend: `schemas.py`, `broker_login/oidc_config.py`, `test_broker_login_flow.py`
  - `docker-compose.test.yml`, `testing/keycloak/import/*`, `.env.test.example`, `docs/*`, `AGENTS.md`, `planning/coordination/WORKLOG.md`
- Test notes:
  - commands:
    - `PYTHONPATH=backend python3 -m unittest backend.test_broker_login_flow backend.test_broker_login backend.test_smoke -v`
    - `cd frontend && npm run build`
  - UI path:
    - `/workspace/admin/login-providers`
- Changelog updated:
  - yes ([Unreleased] Added)
- Follow-ups:
  - none

## 2026-04-08 – Cursor Agent – Admin User Management

- Done:
  - Backend: `User.deleted_at`, `User.last_login_at`; `services/user_lifecycle.py` (Deprovision, Soft-Delete, Hard-Delete, Session-/Grant-Widerruf, Connections leeren); `routers/admin_users.py` (Liste/Detail/Lifecycle-API); `deps`/`auth`/`user_resolution`/`errors` für Kontosperre und `last_login_at`; `seed.reconcile_schema` für neue Spalten.
  - Frontend: `/workspace/admin/users` mit Tabelle, Suche/Filtern, Detailmodal, Impact-Texte in `ConfirmModal`, Aktionen (Deactivate, Mark removed, Reactivate/Restore, Sessions/Keys, Hard Delete mit E-Mail-Bestätigung).
  - Doku: `docs/CHANGELOG.md`, `docs/technische-referenz.md`; Tests `backend/test_admin_users.py`, Smoke `test_admin_users_requires_session`.
- Next:
  - keine
- Blockers:
  - keine
- Branch/PR:
  - branch: feature/dev (lokal)
  - PR: none
- Files touched:
  - backend: `models.py`, `seed.py`, `schemas.py`, `main.py`, `deps.py`, `routers/auth.py`, `routers/admin_users.py`, `services/user_lifecycle.py`, `broker_login/user_resolution.py`, `broker_login/errors.py`, `test_smoke.py`, `test_admin_users.py`
  - frontend: `App.tsx`, `api.ts`, `types.ts`, `utils.ts`, `UserManagementAdminPage.tsx`, `index.css`
  - docs: `CHANGELOG.md`, `technische-referenz.md`, `planning/coordination/WORKLOG.md`
- Test notes:
  - commands:
    - `PYTHONPATH=backend python3 -m unittest discover -s backend -p 'test_*.py' -v`
    - `cd frontend && npm run build`
  - endpoints:
    - `GET /api/v1/admin/users`, `GET /api/v1/admin/users/{id}`, Lifecycle-POSTs/DELETE wie OpenAPI
  - UI path:
    - `/workspace/admin/users`
- Changelog updated:
  - yes ([Unreleased] Added)
- Follow-ups:
  - keine
