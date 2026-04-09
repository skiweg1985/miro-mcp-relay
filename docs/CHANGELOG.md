# Changelog

## [Unreleased]

### Fixed

- Integration-OAuth-Callback (`_upsert_user_connection`): Nach erfolgreichem Token-Tausch werden `oauth_refresh_error` / `oauth_refresh_error_at` / `oauth_refresh_error_http_status` aus `user_connections.metadata_json` entfernt. Workspace **Connections** zeigt damit nach **Sign in again** nicht mehr dauerhaft „Action needed“, wenn zuvor ein Refresh-Fehler gespeichert war.

### Changed

- README und `AGENTS.md`: Access-Nutzung/Audit (APIs `GET …/access-grants/{id}/usage-events`, `GET …/admin/access-usage/events`), Workspace-Pfade `/workspace/broker-access` und `/workspace/admin/access-activity`, Hinweis zu `access_usage_events` und Aufbewahrung.

- Workspace **Access** (`/workspace/access`): Usage-Modal radikal vereinfacht — ein einziger sichtbarer Primärblock (Kontextsatz, Method/Endpoint/Header, kopierbares Snippet); Sekundärnutzung unter **Also possible** (eingeklappt); **Technical details** und **Raw details** eingeklappt; kein Overview-DetailSection, kein Reference-Dump, kein Multi-Heading-Layout. Access-Detail: **Overview** + eingeklappte **Technical details**.

- Workspace **Connections** (`/workspace/connections`): Tabellenzeile mit einer primären Aktion (**Open** bzw. bei OAuth ohne Verknüpfung **Connect**) und Overflow-Menü (**⋯**) für **Test**, **Refresh token**, ggf. **Sign in again**, **Disconnect**; schmalere Actions-Spalte; Menü als `position: fixed` per Portal, damit es bei horizontalem Scroll der Tabelle sichtbar bleibt.

### Added

- **Access-Nutzung (Audit):** Tabelle `access_usage_events` mit Indizes `(access_grant_id, created_at)` und `(organization_id, created_at)`; Rollup-Felder auf `access_grants` (`usage_count_total`, `last_success_at`, `last_failure_at`, `last_usage_type`, `last_outcome`). Ereignisse werden an echten Consumer-Pfaden geschrieben (Key-Validierung, Direct-Token, MCP-Relay inkl. Upstream-Status, Tool-Ausführung / discover-tools, Ablehnungen bei widerrufen/abgelaufen/Policy). API: `GET /api/v1/access-grants/{id}/usage-events` (Eigentümer), `GET /api/v1/admin/access-usage/events` (Filter: Nutzer, Integration, Grant, Nutzungsart, Outcome, Zeitraum; Standardfenster 7 Tage). `AccessGrantOut` um Nutzungszahlen und Fenster 24h/7d/30d erweitert. UI: Access-Tabelle und Detail (**Activity**), Admin **Access activity**, erweiterte Nutzer-Detail-Tabelle für Keys.

- Frontend: Brokr-Produktlogo als zentrale SVG-Datei (`frontend/src/assets/logo/brokr.svg`), React-Komponente `BrokrLogo` (Größen `sm`/`md`/`lg`, Varianten `gradient` und `mono` mit `currentColor`), SVG-Favicon zur Laufzeit aus demselben Asset; Einsatz in Sidebar (Name + Tagline), Login-Screen, Lade-Splash, Admin-Login-Modal; optionales `headingIcon` im `Modal`-Header.

- **Upstream-OAuth:** Periodischer Refresh-Task (`app/token_health.py`) aktualisiert `UserConnection`-Tokens vor Ablauf (konfigurierbar über `TOKEN_REFRESH_*`). Fehlgeschlagene Refresh-Versuche schreiben `oauth_refresh_error` / `oauth_refresh_error_at` in `metadata_json`; bei bekannt abgelaufenem Access-Token liefert der Broker keinen ungültigen Token mehr (`get_or_refresh_*`, `access_grants.resolve_upstream_oauth_token_for_grant` mit Ablauf-Check). Consumer-MCP-Relay: bei Upstream-HTTP-401 ein erzwungener Refresh und ein erneuter Request (ohne `X-User-Token` vom Client). Admin: `GET /api/v1/admin/connection-health`, `POST /api/v1/admin/connections/{id}/refresh` (CSRF); User-Detail `connections` enthält `oauth_health`, `oauth_expires_at`, `oauth_refresh_error`. Workspace Admin Users: Spalten OAuth-Status, Ablauf, Button „Refresh“.
- Workspace **Connections** (`/workspace/connections`): `GET /api/v1/integration-instances` liefert pro Instanz `oauth_upstream_health` / `oauth_refresh_error`; Status-Spalte zeigt u. a. „Action needed“, „Expiring soon“, „Limited“. Aktionen **Refresh token** und bei Bedarf **Sign in again**; `POST /api/v1/integration-instances/{id}/oauth-refresh` (CSRF) für eingeloggte Nutzer. Connection-Detail: Hinweis bei defekten Tokens, Zeile „Upstream OAuth“, „Last refresh error“, dieselben Buttons.

- **Direct Token Access (Consumer):** `POST /api/v1/consumer/integration-instances/{id}/token` mit Broker-Access-Key (`X-Broker-Access-Key` oder `Authorization: Bearer bkr_…`) liefert das aktuelle **Upstream-OAuth-Access-Token** (`access_token`, `token_type`, optional `expires_at` / `expires_in`, `connection_id`) — **kein** Refresh Token im Response. Nur wenn der Access Grant `direct_token_access` gesetzt hat und die Connection **OAuth** nutzt; sonst `403` / `400`. Spalte `access_grants.direct_token_access_enabled` (Reconcile in `seed.reconcile_schema`); `AccessGrantCreate` / `AccessGrantOut`: `direct_token_access`. Hilfsfunktionen `get_user_connection_for_grant_oauth`, `oauth_expires_at_from_connection`, `oauth_expires_in_seconds` in `upstream_oauth`. Workspace: neuer Access-Key-Checkbox bei OAuth-Connections; Usage-Modal und Key-Detail: Hinweis / Abschnitt „Direct token access“.

- **Generische Integration-OAuth (`template_key: generic_oauth`):** Admin konfiguriert Authorization-, Token- und optionale Userinfo-URL, Issuer, optional `resource_api_base_url`, Client-ID, verschlüsseltes Client-Secret (`integrations.oauth_client_secret_encrypted`), Scopes, PKCE, Token-Endpoint-Auth (`client_secret_post` / `client_secret_basic`), Claim-Mapping (Pfade wie `sub` oder `user.email`). Nutzer: `POST …/oauth/start` → Callback `…/integration-instances/oauth/callback` → Token-Austausch, optionales Userinfo, Profil in `user_connections.metadata_json` (`external_subject`, `oauth_provider_kind: generic_oauth`). Refresh über `upstream_oauth` mit gleichem Template. `execution_engine_v2` akzeptiert `resource_api_base_url` als Fallback neben `endpoint`. API: `IntegrationCreate.oauth_integration_client_secret`, `IntegrationUpdate.oauth_integration_client_secret` / `clear_oauth_integration_client_secret`. Workspace: Wizard „External OAuth / OIDC“, Modal „OAuth / OIDC settings“, angepasste Labels und Callback-Hinweise. Tests: `backend/test_generic_integration_oauth.py`.

- Workspace **Access** / Neuer Access-Key: optionales Feld **Expires after (days)** (1–3650); leer lassen = kein Ablauf (`expires_at` weiterhin optional im API).

- Admin-Benutzerverwaltung: Backend `users.deleted_at`, `users.last_login_at` (Reconcile in `seed.reconcile_schema`); Kontostatus **active** / **disabled** / **deleted**; Deprovision beendet Sessions, widerruft aktive Access Grants, trennt UserConnections (OAuth-Felder geleert); Soft-Delete und Hard Delete (E-Mail-Bestätigung); Reactivate stellt aktive Konten ohne `deleted_at` wieder her; Broker-Login verweigert deaktivierte oder entfernte Konten (`AuthFlowFailureCode.ACCOUNT_DISABLED`). API unter `/api/v1/admin/users` (Liste, Detail, Lifecycle). Workspace-UI `/workspace/admin/users` (Suche, Filter, Detailmodal, Bestätigungsmodals mit Impact-Zusammenfassung).
- `test_broker_login_flow.test_generic_oidc_public_auth_host_internal_token_host`: prüft OIDC-Konfiguration mit öffentlicher Authorization-URL und internen Token-/Userinfo-URLs (z. B. `localhost` vs. Docker-Service-Name); erfasst per Mock die tatsächlichen Backend-HTTP-Ziele.
- Optionaler Integrationstest `backend/test_keycloak_broker_login_integration.py`: bei `KEYCLOAK_LOGIN_INTEGRATION=1` und laufendem Keycloak (`docker-compose.test.yml`) echter Authorization-Code-Flow inkl. Formular-Login am IdP und Broker-Callback (ohne Browser); Discovery-Endpunkte werden auf `KEYCLOAK_BASE_URL` normalisiert, damit Host-Läufe durchgängig z. B. `localhost:8180` nutzen; Hilfstest `TestDiscoveryOriginHelpers`; Realm-Client **broker-login-confidential** um Redirects `http://localhost:8000/*` / `http://127.0.0.1:8000/*` ergänzt.
- Admin-UI **Sign-in providers** (`/workspace/admin/login-providers`): CRUD für generische OIDC-Login-Provider; Hinweis Broker-Login vs. Integration OAuth.
- Keycloak-Teststack: `docker-compose.test.yml` mit `--import-realm`, Realm-JSON unter `testing/keycloak/import/`, Vorlage `.env.test.example`.
- Backend-Tests `backend/test_broker_login_flow.py` (Happy Path, invalid state, Provider-Mismatch, Token-Fehler, fehlende Claims, deaktivierter Provider, Admin-Validierung 422); verschärfte Schema-Validierung für OIDC-URLs und Claim-Mapping (`subject`/`email` Pflicht).
- Runbook `docs/runbook-broker-login-testing.md`.

- Broker sign-in refactor: `app/broker_login` (canonical user claims, `MicrosoftEntraLoginProvider`, `GenericOidcLoginProvider`), `POST/GET /api/v1/auth/{provider_id}/start|callback`, pending flow `broker_login` mit Provider-Binding und Correlation-ID; Admin-API `/api/v1/admin/broker-login-providers` für deklarative OIDC-Provider; Tabelle `broker_login_providers`; `GET /api/v1/auth/login-options` liefert `login_providers`; `docs/troubleshooting-broker-login.md`; optional `docker-compose.test.yml` (Keycloak-Dev).
- Connections-Detailmodal zeigt OAuth-Token-Zeitpunkte aus der Connection-Metadaten: `Access token expires` (`oauth_expires_at`) und `Last token refresh` (`oauth_last_refresh_at`).
- `docs/troubleshooting-consumer-mcp-relay.md`: Symptome, Ursachen (OAuth, Streamable-HTTP/TCP, Multi-Worker, HAProxy-Timeouts), Checks (`grep mcp_relay_`, Debug-Skript); Verweis in `AGENTS.md`.
- `.cursor/rules/mcp-relay-troubleshooting.mdc`: Kurz-Checkliste für Agent-Runs zu Consumer-MCP-Relay.

- `scripts/debug-mcp-consumer-relay.py`: lokaler Ablauf Health → `mcp-connection-info` → JSON-RPC `initialize` / `notifications/initialized` / `tools/list` gegen `POST /api/v1/consumer/integration-instances/{id}/mcp` (httpx; optional `--insecure` für HTTPS-Dev-Zertifikat). Konfiguration per `--base-url` / `--access-key` oder `DEBUG_MCP_ACCESS_KEY`, `BROKER_PUBLIC_BASE_URL`, `DEBUG_MCP_INSTANCE_ID`.

- **Consumer MCP relay (streamable HTTP):** `ANY /api/v1/consumer/integration-instances/{id}/mcp` und optional `…/mcp/{path}` — Access-Key (`X-Broker-Access-Key` oder `Authorization: Bearer bkr_…`), gültiger Grant, MCP-fähige Integration (`mcp_enabled`, Typ `mcp_server`), `access_mode=relay`; `access_config.consumer_mcp_relay` in der Instance (Standard: an) schaltet die Relay-Route ab. Upstream-Auth löst der Broker (`resolve_outbound_headers` + OAuth über Grant/Connection/`X-User-Token`); Antwort wird gestreamt (`text/event-stream` / JSON). Ziel-URL nur gleiche Scheme/Host/Port wie `config.endpoint`. `GET …/mcp-connection-info` liefert Transport-Hinweis. Module `mcp_relay_engine`, `services/consumer_access.py`.
- **Workspace:** Access Usage Modal — `streamable-http`-JSON-Beispiel, `curl -N` für Relay, Endpunktliste inkl. `mcp` und `mcp-connection-info`.
- **Lifecycle & Sicherheit (Broker):** Access-Grants `invalid` mit `invalidated_at` und `invalidation_reason` in Metadaten; `effective_status` in API-Antworten; Soft-Delete für `integrations` und `integration_instances` (`deleted_at`); `DELETE /api/v1/integration-instances/{id}` (invalidiert abhängige Keys), `PATCH /api/v1/integration-instances/{id}` (kritische Auth-/Traffic-Änderungen mit `acknowledge_critical_change`); `DELETE /api/v1/integrations/{id}` (geschützte Default-Integrationen blockiert); `DELETE /api/v1/access-grants/{id}` für entfernte/revoked Keys. Consumer-API lehnt Kontext ohne gültige Connection/Integration ab (`access_grant_context_invalid`).
- Workspace: Bestätigungsmodals für Revoke/Remove von Access Keys, Disconnect, Connection- und Integrations-Löschen; Connection **Edit**; Integrations **Delete** (wenn erlaubt); Toasts mit Anzahl invalidierter Keys wo relevant.

- Workspace Access: pro Access Key ein **Usage**-Modal mit broker-spezifischer Anleitung (Endpunkte `POST /api/v1/consumer/integration-instances/{id}/execute`, optional `…/discover-tools`, `POST /api/v1/access-grants/validate`), Auth (`X-Broker-Access-Key` / `Authorization: Bearer bkr_…`), copybare curl-/Env-/JSON-Beispiele; nach Key-Erstellung **How to use**; Detailmodal **How to use**. Inhalt des Usage-Modals abhängig vom **Integrationstyp** (`mcp_server`: MCP inkl. discover; `oauth_provider` / `api`: angepasste Texte; **Advanced** `X-User-Token` nur bei OAuth-Connection).

- **`GET /api/v1/integration-instances/{id}/inspect`**: Liefert `IntegrationInstanceOut`, `IntegrationOut` und optional `user_connection` (`id`, `status`, Zeitstempel, `profile` aus `metadata_json`).
- Integration-OAuth-Callback: Profil-Metadaten in `user_connections.metadata_json` (Microsoft Graph: **`GET https://graph.microsoft.com/v1.0/me`** mit Access Token, Fallback Claims aus `id_token` wenn vorhanden; Miro: optional `GET https://api.miro.com/v1/users/me`); bei `oauth/disconnect` wird `metadata_json` geleert.
- Workspace-UI: Detail-Modale für Connections (Zusammenfassung, verknüpftes Konto, aufklappbare Rohdaten), erweiterte Integrations-Detailansicht (Open), Access-Key-Details mit Roh-JSON; Tabellenzeilen öffnen Details; Hilfsfunktion `decode_jwt_payload_unverified` in `app.security`.
- Integration-OAuth: Bei fehlgeschlagenem Token-Austausch mit Miro oder Microsoft Graph schreibt das Backend HTTP-Status und einen gekürzten Antworttext des Upstream-Endpoints ins Log (`integration_oauth`).

### Fixed

- **Access** / Modal „New access key“: Hook-Reihenfolge korrigiert (`useMemo` nach bedingtem `return` entfernt; Auswahl der Connection ohne Hook), vermeidet React-Fehler beim Öffnen des Modals.

- Admin **Users**-Tabelle: Sign-in- und andere gekürzte Spalten — `admin-users-truncate` nicht mehr auf `<td>` (verhindert Layoutbruch in Firefox); Ellipsis auf innerem `span`, `inline-block` + `vertical-align: middle`.

- `GET /api/v1/admin/users/{id}`: Session-Ablauf mit `ensure_utc` gegen `utcnow()` vergleichen (PostgreSQL liefert oft naive `TIMESTAMP`); vermeidet `TypeError: can't compare offset-naive and offset-aware datetimes`. Aktive Sessions in `lifecycle_cleanup_counts` werden analog gezählt.
- `POST /api/v1/integration-instances/{id}/discover-tools` erlaubt den Connection-Test jetzt für alle authentifizierten Nutzer der Organisation (nicht nur Admin), damit der Test-Button in `/workspace/connections` auch im User-Kontext funktioniert.
- OAuth-Upstream-Tokens (Miro, Microsoft Graph und gleich konfigurierte Custom-OAuth-Integrationen): serverseitige Expiry-Prüfung mit automatischem `refresh_token`-Flow vor Ablauf. Für bestehende Verbindungen ohne gespeichertes `oauth_expires_at` wird einmalig ein Refresh-Versuch zur Normalisierung durchgeführt; bei Erfolg werden Access-/Refresh-Token und neues `oauth_expires_at` persistiert.
- Consumer-MCP-Relay: Upstream-`httpx.AsyncClient` wird pro Access-Grant wiederverwendet (Pool mit LRU, Shutdown schließt Clients). Streamable-HTTP-Ziele wie Miro MCP erwarten dieselbe TCP-Verbindung für `initialize` und Folge-POSTs (`tools/list` lieferte zuvor oft einen leeren Body). Hinweis: bei mehreren Uvicorn-Workern kann dieselbe Grant-ID auf verschiedene Prozesse fallen — dann ggf. `--workers 1` oder Sticky Routing.

- Consumer-MCP-Relay: Bei abgebrochenem Upstream-Stream (`httpx.ReadError` beim Lesen der Antwort) wird eine Warnung geloggt und der Stream beendet — kein ASGI-Traceback mehr durch `StreamingResponse`-Passthrough.

- `seed.reconcile_schema`: Zeitstempel-Spalten (`deleted_at`, `invalidated_at`) für PostgreSQL als `TIMESTAMP` statt `DATETIME` (SQLite-Syntax verursachte Startfehler unter Docker/Postgres).

- Miro MCP Integration-OAuth: Default `oauth_token_endpoint` ist `{miro_mcp_base}/token` (MCP-Authorization-Server), nicht `https://api.miro.com/v1/oauth/token`; behebt 401 „Client not found“ bei Token-Austausch nach DCR. `reconcile_miro_default_integration_token_endpoint` setzt bei bestehender Default-Integration fehlende oder frühere REST-Token-URL auf die MCP-Token-URL; Fallback in `integration_oauth` nutzt `{miro_mcp_base}/token`.

### Changed

- **Dokumentation:** `docs/technische-referenz.md` und `docs/funktionsuebersicht.md` an Integration V2, aktuelle Router und Workspace-Pfade angeglichen; `docs/README.md` und Root-`README.md` um Direct-Token-Endpoint und generischen Broker-Login-Start ergänzt; veraltete Abschnitte (Legacy-Miro-Router, Delegation/alter Admin-Pfad) entfernt oder ersetzt. Eingechecktes `frontend/dist` an den Vite-Build angepasst (Asset-Hash).

- **Direct Token Access** (`POST …/consumer/integration-instances/{id}/token`): Response um **`connection_name`** (Integration Instance), **`access_name`** (Access Grant) sowie optionale **`email`** / **`username`** aus Connection-Profil-Metadaten (`upstream_identity_from_connection` in `upstream_oauth`).

- Keycloak für Broker-Login-Tests: Service in `docker-compose.yml` unter Profil `test` (statt separater Datei `docker-compose.test.yml`); Runbook/`.env.test.example`/`AGENTS.md` angepasst (`docker compose --profile test up -d`).
- Vite-Dev-Proxy: `/api` zeigt standardmäßig auf `http://localhost` (Port 80/443 je nach lokalem Stack).
- Workspace **Access** — Modal „How to use this access“: fokussierte Struktur (Kurz-Summary, dann **Primary usage** mit Endpunkt/Header/Beispiel je nach Integration: MCP streamable Relay vs. MCP über Consumer-API vs. HTTPS-Toolcalls); weitere Beispiele und `validate` unter ausklappbaren Abschnitten; Verbindungs-/Policy-Details ebenfalls einklappbar; `deriveAccessPrimaryUsage` / `AccessPrimaryUsageKind` für die Auswahl des Hauptblocks.

- Workspace **Connections** (`/workspace/connections`): Tabelle `table-layout: fixed` mit Spaltenanteilen über die volle Card-Breite; Authentication/Traffic/Status ohne unnötigen Zeilenumbruch; Name/Integration/Auth mit `table-cell-ellipsis` und `title` bei Kürzung; Aktionszeile `inline-actions--table`; „Connect“ als `secondary-button`. Aktions-Spalte fest `calc(8 * --space-6)`; übrige Spalten anteilig von `100% − Aktionsbreite` (verhindert Überlappung von Status-Badge und Aktionsbuttons); Status-Zelle `overflow: hidden` + Ellipsis auf Badge; `StatusBadge` optional `title`.

- README grundlegend überarbeitet: klare Struktur nach Zweck, Praxisbeispielen, Features, Architektur, Kern-APIs, Use-Cases, Quickstart, API-/CLI-Beispielen und technischen Einschränkungen.

- Consumer-MCP-Relay: INFO-Logs `mcp_relay_upstream_client_cache_hit`, `mcp_relay_upstream_client_cache_miss`, `mcp_relay_upstream_response_start` (u. a. `upstream_status`, `upstream_content_type`, `upstream_host` ohne Pfad/Query).

- Workspace: Integrations are shown as cards (status, type line, Open / Add connection / Test / Graph settings); connection management moved to `/workspace/connections` (table with actions); Access keys use a table plus modal-based creation; add-integration and add-connection use step modals. Human-readable labels for auth and access modes live in `integrationLabels.ts`. Legacy path `/app/connections` redirects to `/workspace/connections`.

- Frontend: `formatDateTime` uses locale `en` (consistent English dates/times); OAuth redirect `message` query codes mapped to English copy for connection error toasts.

- Frontend: Clarity UI Mono v2 — consolidated spacing and type tokens (`--ink-primary`, `.muted`); landing, buttons, tables, and modals aligned to the 4–32 px scale; sidebar branding with `brand-kicker`; workspace nav label “Access”; integrations and access pages with calmer primary-button interaction, English UI copy, connection lists using `stack-cell--row`, and card form-action spacing.

- Admin **Users** (`/workspace/admin/users`): Tabellenführung auf sechs Spalten, ruhigeres Detail (Sektionen statt verschachtelter Cards, Kennzahlenpanel), Copy gekürzt, Fehlerzustand mit Retry, fokussierbare Zeilen und Hilfetext (`sr-only`); Styles nur über `--space-*` und bestehende Typ-Tokens.

- Microsoft Graph integration OAuth: default redirect `{BROKER_PUBLIC_BASE_URL}{api_v1_prefix}/connections/microsoft-graph/callback`; same handler as `…/integration-instances/oauth/callback`. Override via `MICROSOFT_GRAPH_OAUTH_REDIRECT_URI`, `MICROSOFT_GRAPH_OAUTH_REDIRECT_PATH`, or `config_json.graph_oauth_redirect_uri`.

### Added

- Microsoft Graph (Integration): optionale eigene Entra-App über `PATCH /api/v1/integrations/{id}` (Admin, CSRF): `config_json` mit `graph_oauth_use_broker_defaults`, `graph_oauth_authority_base`, `graph_oauth_tenant_id`, `graph_oauth_client_id`, `graph_oauth_scope`; Body-Feld `graph_oauth_client_secret` speichert verschlüsselt in `integrations.oauth_client_secret_encrypted`. Resolver `resolve_microsoft_oauth_for_graph_integration`. `IntegrationOut`: `oauth_client_secret_configured`, `integration_oauth_callback_url`.
- Miro MCP: OAuth mit dynamischer Client-Registrierung am `oauth_registration_endpoint` (Default `…/register` unter `miro_mcp_base`), PKCE; DCR-Credentials pro Nutzer/Instanz in `user_connections.oauth_dcr_client_id` / `oauth_dcr_client_secret_encrypted`; Default `oauth_authorization_endpoint` unter `miro_mcp_base`; weiterhin statische `MIRO_OAUTH_*` oder `oauth_client_id`/`oauth_client_secret` in Config/Env.
- `GET /api/v1/broker-callback-urls`: Feld `integration_oauth` (Miro-Integration-OAuth); `microsoft_graph` (Graph-Redirect); `miro` gleich `integration_oauth`.

### Changed

- `seed.reconcile_schema`: SQLite-Spalten `integrations.oauth_client_secret_encrypted`, `user_connections.oauth_dcr_*`.
- Default-Integration Miro: `oauth_dynamic_client_registration_enabled`, Authorize unter MCP-Basis statt nur `miro.com`.

### Added

- Microsoft-Enduser-Login: Tabelle `microsoft_oauth_settings` (org-bezogen, verschlüsseltes Client-Secret); Resolver wählt vollständige DB-Konfiguration vor Umgebungsvariablen `MICROSOFT_BROKER_*`. Admin-API `GET/PUT /api/v1/admin/microsoft-oauth` (Admin-Session, `PUT` mit `X-CSRF-Token`). Frontend: Workspace-Route `/workspace/admin/microsoft-oauth` (nur `is_admin`), Navigation „Microsoft sign-in“.
- V2-Integrationsplattform: neue Datenmodelle `Integration`, `IntegrationInstance`, `IntegrationTool` mit Trennung von Integrationstyp, Authentisierung und Zugriffskanal.
- Neue API-Routen unter `/api/v1`: `GET/POST /integrations`, `GET/POST /integration-instances`, `POST /integration-instances/{id}/execute`, `POST /integration-instances/{id}/discover-tools`.
- Generischer MCP-Client (`discover_tools`, `call_tool`) und V2-Execution-Engine mit Auth-Injektion für `none`, `oauth`, `api_key`, `shared_credentials`.
- Frontend-Seite `Integrations V2` mit 3-Schritt-Flow (Typ → Auth-Mode → Konfiguration) und Navigation unter `/workspace/integrations-v2`.
- AccessGrant (Broker-Access-Keys, Speicher nur als Hash und Prefix): Tabellen `access_grants`, `user_connections`; API `GET/POST /api/v1/access-grants`, `POST /api/v1/access-grants/validate`, `POST /api/v1/access-grants/{id}/revoke`; Consumer-Pfade `POST /api/v1/consumer/integration-instances/{id}/execute` und `.../discover-tools` mit `X-Broker-Access-Key` oder `Authorization: Bearer bkr_...` (getrennt von Upstream-Auth). Frontend: `/workspace/broker-access`.
- `execution_engine_v2.enforce_consumer_tool_policy` verbindet IntegrationTool-Policy und optionale Grant-Tool-Liste.
- Seed: `default_integrations.py` legt je Default-Organisation **Miro MCP** (`mcp_server` + OAuth-Instanz, Endpoint `…/mcp` unter `miro_mcp_base`) und **Microsoft Graph** (`oauth_provider`, Graph-OAuth-Metadaten, ohne MCP-Flag) an; idempotent mit festen Primärschlüsseln.
- User-OAuth „Connect“ für `IntegrationInstance` mit `auth_mode=oauth`: Router `integration_oauth` — `POST /integration-instances/{id}/oauth/start`, `GET /integration-instances/oauth/callback`, `POST .../oauth/disconnect` (CSRF); Tokens verschlüsselt in `user_connections` (optional `oauth_refresh_token_encrypted`). Microsoft Graph nutzt dieselbe Entra-App wie `resolve_microsoft_oauth`; Miro nutzt `oauth_authorization_endpoint` / `oauth_token_endpoint` aus der Integration und optional `MIRO_OAUTH_CLIENT_ID` / `MIRO_OAUTH_CLIENT_SECRET`.
- `upstream_oauth.py`: gemeinsame Auflösung gespeicherter Tokens; Session-`execute`/`discover-tools` nutzen `UserConnection` vor `X-User-Token`. `GET /integration-instances` liefert `oauth_connected`.

### Changed

- `POST /api/v1/integrations`, `POST /api/v1/integration-instances` und `POST .../discover-tools` erfordern Admin-Session (`require_admin`). Listen und `execute` bleiben für alle aktiven Nutzer der Organisation.
- Integrations-UI: Anlegeformulare nur für `is_admin`; andere Nutzer sehen die Übersicht der Instanzen.

- `GET /api/v1/auth/login-options` nutzt den OAuth-Resolver (DB mit vollständiger Registrierung oder ENV-Fallback).
- Runtime-Hard-Cut im Backend: `main.py` bindet `public`, `auth`, `integrations_v2`, `integration_oauth`, `access_grants`, `consumer_execution` und `admin_microsoft_oauth`; frühere Connection-/Token-Issuance-/Legacy-Admin-/User-Router sind nicht mehr aktiv.
- Frontend-Routing priorisiert den neuen V2-Pfad; Legacy-Workspace-Pfade leiten auf `/workspace/integrations-v2`.

### Removed

- Legacy-Backend-Module und -Router entfernt (u. a. Provider-/App-/Connection-Modelle, Relay, Miro/Graph-Integration, Delegation, Token-Issuance, Admin-/User-APIs). Aktiver Codepfad: `public`, `auth`, `integrations_v2`.
- ORM-Tabellen auf Kern + V2 reduziert; Microsoft-Enduser-Login über `MICROSOFT_BROKER_CLIENT_ID` / `MICROSOFT_BROKER_CLIENT_SECRET` und OAuth-Identitäten in `oauth_identities` statt `ProviderApp`.
- Legacy-Frontend entfernt (Admin-Bereich, alte Workspace-Integrations-, Grants- und Clients-Seiten).

### Added

- **Credential Scope**: `ConnectedAccount` unterscheidet `personal` und `shared` (`credential_scope`, `managed_by_user_id`); Backfill vorhandener Einträge auf `personal`.
- **Shared Credential Management (Admin)**: CRUD-Endpunkte `POST/GET /admin/shared-credentials`, `POST .../revoke`, `POST .../refresh`; Admin-UI zeigt Shared Credentials pro Integration mit Revoke/Refresh.
- **MCP Tool Discovery**: Modell `DiscoveredTool` mit stabilem Schlüssel (`provider_app_id + tool_name`); `tool_discovery.py` ruft `tools/list` vom Upstream ab, normalisiert und persistiert; Admin-Trigger `POST /admin/provider-apps/{id}/discover-tools`.
- **Tool Access Policy**: Modell `ToolAccessPolicy` pro Tool (`visible`, `allowed_with_personal`, `allowed_with_shared`); Standard: Personal erlaubt, Shared gesperrt (Least Privilege); CRUD + Bulk-Endpunkte; `tool_policy.py` mit `check_tool_access()`.
- **Serverseitiges Policy Enforcement**: Relay Engine parst MCP-Body (`tools/call` → Tool-Name, `tools/list` → Response-Filterung); `403` bei Policy-Verstoß; Defense-in-Depth unabhängig von Client-seitiger Filterung.
- **Execution Identity (User UI)**: Badge "Your account" / "Shared credential (managed by admin)" in Verbindungsdetails und Grant-Ansicht; Shared-Credentials-Sektion auf der Integrations-Seite.
- **Admin Tool Management UI**: Panel in Integration-Detail mit "Discover tools"-Button, Policy-Tabelle (Visible/Personal/Shared Checkboxen), Removed-Tools-Sektion.
- User-Endpunkt `GET /api/v1/shared-credentials` für verfügbare organisationsweite Credentials (Metadaten).
- `brokerTerminology.ts` erweitert: `personalConnection`, `sharedCredential`, `executionIdentity`, `runsAsPersonal`, `runsAsShared`, `discoveredTools`, `toolPolicy`.

### Changed

- Admin **Integrations** · Detail: kontextsensitive **Basic**-Ansicht nach `template_key` (Miro / Microsoft Graph / Microsoft Login / Custom). Miro-Default ohne „Overview“-Karte; operative Felder (Redirect, Sign-in-Bereitschaft, Upstream, Zugriffsmodus, kompakte Upstream-Auth) sichtbar; Metadaten, Scopes, Roh-OAuth-Endpoints und Low-level-Relay (Keys, `forward_*`, Retries, Circuit Breaker, Header-Maps) unter **Technical details** (eingeklappt). Custom-OAuth: OAuth-Endpoints und DCR-Kurzzeile im Basic; Issuer und Registrierungsdetails zusätzlich unter Technical.

### Added

- Cursor-Regel `.cursor/rules/terminology-naming-consistency.mdc`: konsistente Terminologie und Benennung über Admin-UI, User-UI, API-Mappings und Doku; Workflow bei Umbenennungen (Audit, Glossar, Self-Check).
- **Dynamic Client Registration (DCR)** optional pro `ProviderApp`: Felder `oauth_dynamic_client_registration_enabled`, `oauth_registration_endpoint`, `oauth_registration_auth_method` (Schema-Reconcile); Admin- und User-`provider-apps` liefern die Felder; bei DCR **an** ist die Konfiguration ohne statische Client-ID gültig, wenn Authorize-/Token-URL und Registration-URL gesetzt sind. Generic-OAuth-Connect registriert vor dem Authorize (RFC-7591-ähnlicher POST), legt dynamische Credentials im Pending-State ab (Secret verschlüsselt); Callback und Refresh nutzen pro Verbindung gespeicherte OAuth-Client-Daten. Miro-Template (`miro-default`): DCR standardmäßig **an**, Registration `https://mcp.miro.com/register` (Backfill/Seed); Miro-Connect nutzt konfigurierbaren Endpoint, alternativ statische Client-ID/Secret wenn DCR aus. Hilfsmodule `oauth_integration_status`, `oauth_dcr`. Tests: `backend/test_oauth_integration_status.py`.

- **Custom Integration entfernen (Soft-Delete)**: `DELETE /api/v1/admin/provider-apps/{id}` nur für `template_key is null`; Blocker **409** mit Zählern (`active_delegation_grants`, `active_connected_accounts`, `pending_oauth_flows`); Template-Apps **403**; Erfolg **204**; Audit `admin.integration.delete.blocked` / `admin.integration.deleted`. Modell `provider_apps.deleted_at`; Schema-Reconcile; Schlüssel wird mit `-deleted-<uuid>` freigegeben; optionale Deaktivierung der `ProviderInstance`, wenn keine aktive App mehr verweist.
- **`force=true`** (Query): vor dem Löschen alle zugehörigen **Delegation Grants** widerrufen, **Connected Accounts** widerrufen und zugehörige **TokenMaterial**-Zeilen entfernen, passende **oauth_pending_states** löschen; danach Soft-Delete (Audit `cleared_dependencies`).
- Admin-UI **Integrations**: „Remove“ mit Option „Zugriffsregeln und Verbindungen automatisch widerrufen“; **409** mit deutscher Zusammenfassung der Blocker.
- Datenbank-Seed: Provider-Definition **`generic_oauth`** für im Admin angelegte Custom-OAuth-Instanzen (statt stiller Zuordnung zur Miro-Definition).
- Admin-API: `ProviderAppUpdate.clear_client_secret` entfernt das gespeicherte Client-Secret (z. B. bei PKCE-only).
- **Custom OAuth (Self-Service)**: `POST /api/v1/connections/provider-connect/start` startet für `template_key=null` einen generischen Authorize-Flow; `GET /api/v1/connections/provider-oauth/callback` tauscht den Code (PKCE/`client_secret_post`), legt `ConnectedAccount`/`TokenMaterial` an bzw. aktualisiert bei Reconnect; Pending-State über bestehende Tabelle **`oauth_pending_states`** (Flow `generic_provider_connect`). Refresh (`generic_provider.connection.refresh`) und Probe (UserInfo, Fallback gespeicherte Identität) für Custom.
- **API** `GET /api/v1/provider-apps`: Zusatzfelder `oauth_authorization_endpoint`, `oauth_token_endpoint`, `oauth_userinfo_endpoint`, `oauth_instance_settings` (für Nutzer-UI und konfiguriert-Prüfung).
- Frontend: `oauthIntegrationStatus.ts` — gemeinsame OAuth-Konfigurationsprüfung; Workspace **Integrations** listet Custom-Apps; Connect deaktiviert bei unvollständiger Konfiguration mit Hinweis.

### Changed

- Frontend: zentrale Begriffslogik `brokerTerminology.ts` (`brokerUi`-Labels, Formatter für Access-Modi, Relay, Token-Entscheidungen, Upstream-Authentifizierung); Admin-Integrations-Detail und -Wizard nutzen einheitliche Bezeichnungen (**Available access methods**, **How access works**, **Authentication to upstream**, **Sign-in setup**, **Broker relay**, Advanced: interne Keys, OAuth-Endpunkte, **Relay API style**); Self-Service **Access**-Modal: Tooltip und ARIA nur noch **Access key** (kein „connection key“); OAuth-Konfig-Hinweise in `oauthIntegrationStatus.ts` auf Authorization/Token-Endpoint formuliert.
- Admin **Integrations** · **Custom integration**: Wizard und Bearbeiten speichern Endpoints, Issuer, Default-Scopes, Scope-Ceiling, PKCE, Connection Types (direct/relay), Relay (`relay_type`, `token_transport`, Upstream-URL), `relay_protocol`, Aktiviert; bestehende `relay_config`- und Instance-`settings`-Felder werden zusammengeführt statt verworfen.
- Self-Service **Access** (`/grants`) und **Activity**: Spalten und Texte sprechen durchgängig von **Client** (gebundener Service-Client), nicht „App“; direkte Nutzung als „Direct“ / „Direct access“.
- **Clients** (`/workspace/clients`): Anlegen nur noch **Name**; technischer Unique-Key (`key`) wird serverseitig per UUID vergeben; optional weiterhin manuelles `key` in der API; Tabelle **Client ID**; Bearbeiten zeigt Client-ID read-only.
- Frontend: `tsconfig.tsbuildinfo` um `oauthintegrationstatus.ts` ergänzt.

### Fixed

- Admin **Integrations**: Status „Configured“ / **Active** setzt kein gespeichertes Client-Secret mehr zwingend voraus, wenn PKCE aktiv ist und Authorize-/Token-URL sowie Client-ID gesetzt sind; Detail **OAuth**-Zeile entspricht dieser Logik.
- `diagnose_service_access`: Delegation Grants mit gebundenem `service_client_id` werden ohne `X-Service-Secret` abgewiesen (**401** `Service client secret required`); direkte Grants (`service_client_id` **NULL**) bleiben mit `X-Access-Key` allein nutzbar.

- Frontend: Self-Service **Access**-Modal **cURL** für **Direct** (z. B. Microsoft Graph, `POST …/token-issues/provider-access`): fehlender Header `X-Access-Key: <access key>` ergänzt (entspricht der API; zuvor nur Relay-Zweig).

### Added

- Datenmodell: `service_clients.created_by_user_id` (FK `users`, nullable); `reconcile_schema` + Backfill ältester Nutzer pro Organisation für bestehende Zeilen.
- API (Session, CSRF bei Schreibzugriffen): `GET/POST/PATCH/DELETE /api/v1/service-clients`, `POST /api/v1/service-clients/{id}/rotate-secret` — nur eigene Clients (`created_by_user_id`); `ServiceClientCreate` optional `client_secret` (mind. 16 Zeichen); `ServiceClientOut` enthält `allowed_provider_app_keys`.
- API (Admin, CSRF): `GET /api/v1/admin/users/{user_id}/service-clients` — Clients des gewählten Nutzers für Access-Regeln.

### Changed

- API: `GET /api/v1/admin/service-clients` bleibt als **Leselist** für die Organisation; **POST** und **DELETE** `/api/v1/admin/service-clients` entfallen (Verwaltung über User-API).
- Frontend: Workspace-Navigation **Clients** (`/workspace/clients`), Verwaltung analog **Access**; Admin-Seite **Services** entfällt (Legacy `/app/services` → `/workspace/clients`).
- Admin **Access**: Client-Auswahl pro **Person** über die Clients des jeweiligen Nutzers; Spalte „Client“ statt „Service“.
- README: HTTP-Übersicht zu Service-Clients und Pflicht von `X-Service-Secret` bei gebundenem Grant.

### Changed

- Frontend: eingechecktes `frontend/dist` (Vite-Build: `index.html`, gebündelte JS/CSS-Hashes) mit aktuellem Build abgeglichen.

### Removed

- Root-Router `legacy_miro` (`POST /miro/mcp/{profile_id}`, Redirects unter `/miro/*`, `/start`, `/healthz`, `/readyz`).
- Tabellenspalten `connected_accounts.legacy_profile_id`, `legacy_relay_token_hash`, `encrypted_legacy_relay_token`.
- API: `GET /api/v1/connections/{id}/miro-access`, `POST .../miro-access/reset`, `POST /api/v1/connections/miro/setup/exchange`, `POST /api/v1/connections/{id}/access-details/rotate`.

### Changed

- Frontend: Self-Service **Access**-Detailmodal: einspaltige Reihenfolge **Access key** → **Endpoint** → **Connection**; Schlüssel- und Endpoint-Zeilen einzeilig, Monospace, horizontal scrollbar; Inline-Aktionen am Schlüssel; **Usage example** (kopierbarer `curl`, Direct/Relay) und **Developer details** getrennt einklappbar.

- Miro-Relay: nur noch `POST /api/v1/broker-proxy/miro/{connected_account_id}` mit Delegation-Grant (`X-Access-Key`); `GET .../access-details` liefert Relay-URL und Authentifizierungshinweis (Grant-Access-Key), ohne separaten Verbindungs-Key.
- HAProxy: Backend nur noch für `/api` (kein Routing mehr von `/miro`, `/start`, `/healthz`, `/readyz` zum API-Backend).

### Added

- Datenmodell: `connected_accounts.encrypted_legacy_relay_token` (Fernet) für den Miro-Relay-Key neben `legacy_relay_token_hash`; bei Erstausstellung und Rotation befüllt; `reconcile_schema` ergänzt die Spalte.
- API: `POST /api/v1/delegation-grants/{id}/rotate-credential` (CSRF): neues Delegated Credential für den Grant; altes Secret ungültig; Audit `user.delegation_grant.credential_rotated`.
- API: `GET /api/v1/delegation-grants/{id}/delegated-credential` (Session): Klartext für den Grant-Inhaber; **404** `delegated_credential_not_stored` wenn kein gespeicherter Ciphertext existiert.
- Datenmodell: `delegation_grants.encrypted_delegated_credential` (Fernet, `BROKER_ENCRYPTION_KEY`); bei Create/Rotate befüllt, bei Revoke geleert; bestehende Zeilen ohne Spaltenwert bleiben über Rotate einmalig nachziehbar.
- Frontend: Self-Service **Access**-Detail: Delegated Credential per API laden; **Reveal** / **Copy**; **Replace secret** nur bei Bedarf (eingeklappt bzw. bei fehlendem Speicher).
- API: `GET /api/v1/connections/{id}/access-details` und `POST /api/v1/connections/{id}/access-details/rotate` liefern ein gemeinsames Schema für sichtbare Verbindungs-/Endpoint-Zugangsdaten (Key-Status, maskiert, einmaliger Klartext nach Rotation); erste Anbindung über Miro; bestehende Routen `miro-access` und `miro-access/reset` bleiben parallel.
- Frontend: `AccessCredentialSummary` (Endpoint, Key-Status, Kopieren für Endpoint, Schlüssel nur im Bestätigungs-Modal); **Integrations**, **Access**-Detailmodal und **Add access**-Vorschau bei gewählter Verbindung.
- Backend: generische Relay-Engine `execute_relay_request` (`relay_engine.py`) mit konfigurierbarem Upstream, Headern, Token-Transport, Retry und Circuit Breaker; OAuth-Refresh über `oauth_connection_tokens.refresh_oauth_tokens` (verbundenes Konto vs. Provider-App je nach `oauth_refresh_client_credential_source`).
- Datenmodell: `provider_apps.relay_config_json` (JSON) für Relay-/Verbindungskonfiguration; Presets pro Template in `relay_config.effective_relay_config` (u. a. Miro `streamable_http`, Microsoft Graph `rest_proxy`).
- API: `ProviderAppOut` um `allowed_connection_types` und `relay_config`; Create/Update optional `allowed_connection_types` / `relay_config`; Legacy-Felder `access_mode` / `allow_relay` werden aus `relay_config` synchron gehalten (`sync_legacy_access_fields_from_relay`).
- API: `DELETE /api/v1/admin/service-clients/{service_client_id}` entfernt einen Service der Organisation; **409**, solange noch **aktive** Access-Regeln (`delegation_grants` mit `revoked_at IS NULL`) diesen Service referenzieren; sonst werden verknüpfte (widerrufene) Grants und `token_issue_events` von der FK entkoppelt (`service_client_id` → `NULL`), Audit `admin.service_client.deleted`.
- Frontend: Admin **Services** – **Remove** pro Zeile mit Bestätigung; Fehlermeldung der API bei blockierenden Regeln.
- Frontend: Self-Service **App access** (`/grants`): Hilfe-Button (**?**) an der Karte „Your app access“ mit Erklärung zu Delegated Credential; im Modal **Access details** Abschnitt **Use in your application** mit kopierbaren HTTP-Beispielen (Direct connection, Miro-Relay, Hinweis Profil-URL/`X-Relay-Key` vs. Credential); `Card` unterstützt `headerActions`.

### Changed

- Frontend: `AccessCredentialSummary` / Mapper: Verbindungsschlüssel einheitlich **Connection key**; Header-Referenz-Platzhalter `<connection key>`.
- HTTP: Kanonischer Header `X-Access-Key` für Service-APIs (`/api/v1/token-issues/provider-access`, `/api/v1/broker-proxy/miro/…`) und Legacy-MCP (`POST /miro/mcp/…`); Abwärtskompatibilität `X-Delegated-Credential` bzw. `X-Relay-Key` (Priorität jeweils `X-Access-Key`). JSON: `access_credential`; Endpoint `GET /api/v1/delegation-grants/{id}/access-credential` (Legacy-Pfad `…/delegated-credential`); Fehlercode `access_credential_not_stored`. Typ `AccessCredential` / `AccessCredentialRotateOut` im Backend; MCP-Config-JSON nutzt `X-Access-Key`.
- UI/Doku: einheitliche Bezeichnung **Access key**; README, technische Referenz, Funktionsübersicht, Legacy-`src/index.js` angepasst.

- Auth: Delegation-Grants und Service-Clients ohne gesetzten Lookup-Hash (`credential_lookup_hash` / `secret_lookup_hash`) werden nicht mehr per Vollscan authentifiziert.

- Miro-Verbindungen: Relay-Key ist nach Session-Authentifizierung aus `GET /api/v1/connections/{id}/miro-access` und `GET /api/v1/connections/{id}/access-details` anzeig- und kopierbar, sobald der verschlüsselte Wert in der DB liegt (Erstausstellung, Rotation oder Erzeugung in `ensure_legacy_miro_identity`).

- Frontend: Self-Service **Access** (`/grants`): Detailmodal auf Verbindungsnutzung fokussiert; bei „automatischer“ Verbindung weiter Auflösung per `GET /api/v1/connections`.

- Frontend: **Connection details** Key-Zeile ohne doppelte Bullet-Anzeige; getrennte Kurztexte für rotierbaren Relay-Key vs. OAuth; Graph-Label **OAuth token**.

- API/UI: Microsoft-Graph-Verbindungen liefern `GET .../access-details` mit Direct-/Relay-Zeilen, API-**Endpoint**, **Access request** (Token-Ausgabe-URL), Key-Status (maskiert, kein Klartext, kein Rotate); **App access**-Detail zeigt dieselbe Zusammenfassung bei **Direct** oder **Relay** (nicht nur Relay).
- Frontend: **Integrations** lädt **Connection details** für alle Verbindungen mit unterstützten Zugangsdaten (mehrere Karten bei mehreren aktiven Integrationen).

- Frontend: Admin **Integrations** – Klick öffnet zuerst eine **Übersichtsseite** (`/app/integrations/{id}`) mit Status, Konfigurationskurzinfo, Nutzung (Verbundkonten, Token-Ereignisse), Health und ausklappbaren technischen Details; **Edit** / **Test connection** / **Enable**/**Disable** dort; Bearbeitung weiter im bestehenden Wizard-Drawer; benutzerdefinierte OAuth-Apps als Karten und mit **Open**; Liste: **Open** statt direktem Editor, **Set up** wenn noch kein Datensatz existiert.
- Relay-Pfade (`/miro/mcp/…`, `/api/v1/broker-proxy/miro/…`) nutzen die generische Engine; Miro-spezifische Upstream-Hardcodes in den Handlern entfernt.
- Service-Zugriff (`diagnose_service_access`): Erlaubnis „relay“ / „direct_token“ aus `effective_allowed_connection_types` statt nur Legacy-Spalten.
- Delegation-Grants (Self-Service und Admin): `allowed_access_modes` im Grant werden aus der Integrationskonfiguration abgeleitet, nicht mehr aus Formular-Modi.
- Admin **Integrations**: Verbindungstypen (Direct / Relay) und Relay-Felder (Typ, Upstream-URL, Authorization) statt getrennter „Access mode“/„allow relay“-Semantik in der Oberfläche.
- Self-Service **App access** / Admin **Access**: Modus-Checkboxen bei neuen Grants entfallen.
- Frontend: Admin **Access**, **People → Connections**, **Integrations**, **Services**: ruhigere Copy (ohne Grant-/OAuth-Jargon wo möglich), Tabellen fokussieren auf Aktives (Connections-Filter standard **Connected**; Access-Regeln mit **Show inactive** wie Self-Service); kürzere Ablauf-Spalte mit Tooltip; Integrations-Karten ohne Directory-GUID, **Apps**-Liste nur Anzeigenamen (interner Key im `title`); manueller Import und Service-Einmalwerte neutral benannt.

- Frontend: Self-Service **Access** (`/grants`): Tabellenliste standardmäßig nur **aktive** Einträge; ein Umschalter **Show expired and paused** / **Active only** blendet alle weiteren Status ein bzw. aus; inaktive Zeilen optisch abgeschwächt (`data-table-row--grant-muted`); `DataTable` mit `rowClassName` und `wrapKey` beim Wechsel.

- Frontend: durchgängiges Layout (Spacing-Skala, Typografie, weniger Rahmen, Milchglas-Modals mit kurzer Einblendanimation, vereinheitlichte Buttons und Tabellenzeilen); Navigation und Seitenkopf gestrafft (Workspace/Admin); Aktivität und Admin-Übersicht/Logs: Tabellen ohne JSON in Zellen, Details in Modals; Grants-Tabelle auf sechs Spalten (Limits nur im Detailmodal); `Modal` mit optionalem Kurztext (`description`), `PageIntro` mit optionalem Eyebrow; Login- und Integrations-Texte sachlich vereinfacht.

- Frontend: Self-Service **App access** (`/grants`): gesamte Tabellenzeile öffnet **Access details**; **View** in der Spalte Limits entfällt; **Remove access** löst die Zeilenaktion nicht aus (`DataTable`: `onRowClick`, `getRowAriaLabel`, klickbare Zeile per Tastatur).

### Fixed

- Frontend: `matchesRoute` erkennt `/app/integrations/:appId`; Admin-Integrations-Detail öffnet nicht mehr die Not-Found-Seite.

- Frontend: Zeitstempel aus der API (naive ISO-UTC ohne `Z`) werden beim Anzeigen und bei Ablaufprüfungen korrekt als UTC gelesen; vermeidet Verschiebung um die lokale UTC-Offset-Stunden (z. B. 2 h in Mitteleuropa).

### Removed

- Verzeichnis `data/` aus dem Repository und der Git-Historie entfernt; `data/` steht in `.gitignore` (lokale Laufzeit-/Legacy-Importdateien nicht versionieren).

### Added

- Frontend: vollständiges Hell-/Dunkel-Theme über semantische CSS-Variablen (`:root` / `html.dark`), Umschalten **System** / **Hell** / **Dunkel** per unauffälligem Icon-Zyklus (ein Klick) mit Persistenz (`localStorage`), FOUC-Vorbelegung im `index.html`-Skript; Steuerung in der Shell und auf der Login-Karte.
- Öffentlicher Endpunkt `GET /api/v1/broker-callback-urls` mit Redirect-URIs für Microsoft Login, Microsoft Graph, Miro und generisches OAuth.
- Admin-Endpunkt `POST /api/v1/admin/integrations/test` zur Erreichbarkeitsprüfung (Microsoft OpenID Discovery bzw. Miro-Authorize).
- Platzhalter-Callback `GET /api/v1/connections/provider-oauth/callback` für künftige benutzerdefinierte OAuth-Apps.
- Tabelle `oauth_pending_states` für OAuth-State über Worker/Container hinweg.
- Spalten `secret_lookup_hash` und `credential_lookup_hash` für schnellen Service-/Grant-Lookup.
- `start:legacy-relay` npm-Script als Alias zum Node-Relay.
- Postgres-Healthcheck in `docker-compose`; Backend startet nach healthy DB.

### Changed

- Frontend: Einmal angezeigte Geheimnisse (Self-Service/Admin-Grants, neuer Service-Client, Admin-Grant) und Miro-Verbindungsdaten erscheinen in einem Modal mit Klartext und Kopieren; Maskierung und „Reveal“ entfallen; mehrere Miro-Blöcke (Access Key, JSON) in einem gemeinsamen Modal.

- Delegation-Grants (Admin `POST /api/v1/admin/delegation-grants`, Self-Service `POST /api/v1/delegation-grants`): Request-Feld `expires_in_hours` durch `expires_in_days` ersetzt (1–365, Standard 365); Ablauf weiterhin maximal ein Jahr; Legacy-Node-Admin-Route akzeptiert `expires_in_days` bevorzugt, sonst weiterhin `expires_in_hours`.
- Frontend: Self-Service-Texte für Endnutzer vereinfacht (Navigation, Seitenkopf, Tabellen, Modals, Toasts, Integrations-/Miro-Karten): Begriffe wie Grant, Token, OAuth, Broker, Relay und „delegiert“ in der sichtbaren Nutzer-UI vermieden; Admin-Oberfläche unverändert technischer; gebaute Assets aktualisiert.
- Frontend: Self-Service **Your grants** (`/grants`): Tabelle auf sieben Spalten (Client, Provider, Connection, Status, Expires, Policy, Actions); keine Modi-Spalte; Policy nur Kurztext (z. B. Inherited, Anzahl Scopes, Custom) und **View**; vollständige Policy (Scopes, Capabilities, Modi) im Modal **Grant details**; Connection zweizeilig bei ` - ` im Anzeigenamen; Ablauf mit kompakter Relativzeit und Zeitstempel in zweiter Zeile; `DataTable` um `tableClassName`, `wrapClassName`, `columnClasses`, `rowKey` erweitert; Tabellenlayout `table-layout: fixed` / `grants-table` gegen horizontales Ausbrechen.
- Frontend: Integrations-Raster (`integration-grid`, User-Integrations-Grid): Zeilen gleich hoch (`align-items: stretch`), Karten `height: 100%`; Bereich für Titel/Status, flexibler Block `integration-card-body` (Beschreibung/Meta), Aktionszeile mit `margin-top: auto`; Beschreibung/Meta mit `line-clamp`; „Add integration“-Karte ohne vertikale Zentrierung, CTA unten wie bei den anderen Karten; Metric-Karten (`metric-grid`): Flex-Spalte, Untertitel (`small`) unten ausgerichtet.
- Frontend: Integrations-Karten: `overflow-x` auf der Aktionszeile entfernt (Rand des letzten Buttons wurde vom Scrollport beschnitten); Raster `minmax(min(100%, 340px), 1fr)`; unter 420px Breite darf die Zeile umbrechen.
- Frontend: sichtbare Rahmen für bisher randlose Steuerflächen (`.ghost-button`, Theme-Umschalter, Registerkarten, „Administrator sign-in“ auf der Login-Seite, Drawer-Schließen); Sidebar-Navigationslinks wieder ohne äußeren Rahmen.
- Frontend: Integrations-Karten und Verbindungs-Detail-Footer: Aktions-Buttons mit `nowrap` (Karten unter 420px Viewportbreite mit Umbruch; Drawer-Footer bei Bedarf horizontal scrollbar); destruktive Aktionen (Verbindung trennen, Grants widerrufen, Admin: Zugriff/Verbindung entfernen) erfordern ein Bestätigungsmodal (`ConfirmModal`).
- Docker Compose (`broker-backend`): Host-Zeitzone read-only gemountet (`/etc/localtime`); Legacy-Volume `./data:/legacy-data` entfernt; `SESSION_SECURE_COOKIE` nicht mehr über Compose-Environment gesetzt (Wert kommt aus Image/`.env` am Start).
- Self-Service **Integrations** (`/workspace/integrations`): Navigationszeile bündelt Provider-Verbindungen; Karten mit Status und Kurzbeschreibung; technische Verbindungsdetails im Wizard-Modal (Account / Session, Refresh/Probe/Disconnect); zweistufiger Connect-Wizard (Overview → Continue to provider) im gleichen Modal-Stil wie die Admin-Integrationen; nach **Disconnect** keine Kontodaten mehr auf der Karte, Miro-MCP-Handoff nur bei aktiver Verbindung; OAuth-Callbacks leiten auf diese Seite; Legacy-Pfade `/connect/*` und `/miro` leiten dorthin um.
- Admin-Shell: Eintrag **Workspace** öffnet dieselbe Self-Service-Oberfläche (u. a. für OAuth-Rückkehr mit Admin-Konto).
- API: `ConnectedAccountOut` um Token-Metadaten ergänzt (`access_token_expires_at`, `refresh_token_expires_at`, `refresh_token_available`, `token_material_updated_at`); keine Geheimnisse im JSON.
- Frontend: `dist/index.html` und `tsconfig.tsbuildinfo` nach Vite-Build (Asset-Hashes, neue Quellpfade) synchronisiert.
- Frontend: Theme-Steuerung von Segment-Buttons auf dezenten Icon-Zyklus (Monitor/Sonne/Mond) umgestellt.
- Frontend: Erstellung und Bearbeitung über Modals (Services, Access, Self-Service-Grants, manueller Token-Import, Token-Access Filter/Probe); Integrations-Konfiguration als zentrierter Wizard-Dialog statt seitlichem Drawer; Provider-„Connect“-Seiten ohne parallele Zwei-Spalten-Formulare.
- Globales UI: Abstands- und Typografie-Tokens in `index.css` (`--space-*`, `--font-*`); einheitliche Steuer- und Flächenabstände für Shell, Karten, Tabellen, Formulare, Drawer, Modals und Toasts; Ersetzung von Integrations-Wizard-Inline-Styles durch `field-hint--flush`.
- Anonyme Startseite (`/login`): reduziert auf zentrierte Kurztexte, dominante primäre Anmeldung (Microsoft-OAuth) und sekundären Administrator-Link; Admin-Anmeldung (E-Mail/Passwort) in kompaktem Modal.
- Self-Service Workspace: große „Connect Miro“ / „Connect Microsoft Graph“-Buttons im Seitenkopf entfernt; Verbindungen weiter über die Shell-Navigation.
- Admin-Frontend: Design-System (helles Layout, hoher Kontrast, System-Schrift), Integrations-Setup als Drawer-Wizard mit Schritten (Microsoft-Anmeldung, Graph, Miro, Custom OAuth), Logs in Tabs (Zugriffsereignisse / Audit), konsistentere Admin-Navigation und Beschriftungen.
- Delegation: `service_client_id` optional; Token-Ausgabe (`/api/v1/token-issues/provider-access`) und Miro-Relay-Proxy akzeptieren `X-Delegated-Credential` ohne `X-Service-Secret`. Optionaler `X-Service-Secret` bleibt für Grants mit gebundenem Service-Client.
- Self-Service- und Admin-Grant-Erstellung: `service_client_key` optional; UI „Credential only“.
- Audit bei Token-/Relay-Zugriff: `actor_type` `credential` und `actor_id` Grant-ID, wenn kein Service-Client beteiligt.
- README: Beispiele credential-first.

- Admin-Oberfläche: Navigation Dashboard, Integrations, Users, Services, Access, Logs; Integrations als Karten mit Modals; vereinfachte Bezeichnungen; Legacy-Routen `/app/providers` usw. leiten auf kanonische Pfade um.
- Admin-APIs nach Organisation gefiltert; Login-E-Mail normalisiert.
- Microsoft-/Miro-/Graph-OAuth-Persistenz in der DB statt In-Memory-Dicts.
- Token-Issuance-Endpunkt asynchron inkl. Graph-Refresh; CORS verlangt gesetzte `CORS_ORIGINS`.
- Frontend: gemeinsamer `isApiError`, robusteres Fetch-Error-Parsing, parallele Aktionen, Routing/Toasts.
- Seed legt Standard-Provider-Apps (`miro-default`, `microsoft-graph-default`, …) an.

### Fixed

- Frontend: `main.page-shell` mit `align-content: start` und `align-items: start`, damit die Hauptspalte bei hoher Sidebar nicht per Grid-Zeilendehnung und `page-intro` (`align-items: flex-end`) den Seitenkopf nach unten schiebt.
- Legacy-MCP-Proxy nutzt Request-DB-Session statt vorzeitig geschlossener Session.
- Miro-Setup-Token: Commit nach Verbrauch, damit Einmal-Nutzung gilt.
