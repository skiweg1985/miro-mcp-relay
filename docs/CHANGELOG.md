# Changelog

## [Unreleased]

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
- Frontend: Integrations-Karten (Grid) nicht mehr über die volle Zeilenhöhe gestreckt; Beschreibung wächst nicht mehr mit `flex: 1`, Buttons bleiben unter dem Text (`align-items: start` auf `.integration-grid`, Beschreibung `flex: 0 1 auto`).
- Legacy-MCP-Proxy nutzt Request-DB-Session statt vorzeitig geschlossener Session.
- Miro-Setup-Token: Commit nach Verbrauch, damit Einmal-Nutzung gilt.
