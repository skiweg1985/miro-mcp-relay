# Changelog

## [Unreleased]

### Changed

- Frontend: Self-Service **Access** (`/grants`): Tabellenliste standardmäßig nur **aktive** Einträge; ein Umschalter **Show expired and paused** / **Active only** blendet alle weiteren Status ein bzw. aus; inaktive Zeilen optisch abgeschwächt (`data-table-row--grant-muted`); `DataTable` mit `rowClassName` und `wrapKey` beim Wechsel.

- Frontend: durchgängiges Layout (Spacing-Skala, Typografie, weniger Rahmen, Milchglas-Modals mit kurzer Einblendanimation, vereinheitlichte Buttons und Tabellenzeilen); Navigation und Seitenkopf gestrafft (Workspace/Admin); Aktivität und Admin-Übersicht/Logs: Tabellen ohne JSON in Zellen, Details in Modals; Grants-Tabelle auf sechs Spalten (Limits nur im Detailmodal); `Modal` mit optionalem Kurztext (`description`), `PageIntro` mit optionalem Eyebrow; Login- und Integrations-Texte sachlich vereinfacht.

- Frontend: Self-Service **App access** (`/grants`): gesamte Tabellenzeile öffnet **Access details**; **View** in der Spalte Limits entfällt; **Remove access** löst die Zeilenaktion nicht aus (`DataTable`: `onRowClick`, `getRowAriaLabel`, klickbare Zeile per Tastatur).

### Added

- Frontend: Self-Service **App access** (`/grants`): Hilfe-Button (**?**) an der Karte „Your app access“ mit Erklärung zu Delegated Credential; im Modal **Access details** Abschnitt **Use in your application** mit kopierbaren HTTP-Beispielen (Direct connection, Miro-Relay, Hinweis Profil-URL/`X-Relay-Key` vs. Credential); `Card` unterstützt `headerActions`.

### Fixed

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
