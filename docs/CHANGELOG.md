# Changelog

## [Unreleased]

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
