# Technische Referenz

## Architekturueberblick

Das Repository umfasst drei Schichten:

- `frontend/`
  React/Vite-Single-Page-App fuer Admin- und Self-Service-Oberflaechen

- `backend/app/`
  FastAPI-Backend fuer Sessions, Provider-Verwaltung, Connected Accounts, Delegation Grants, Token-Issuance und Audit

- `src/index.js`
  bestehender Node/Express-basierter Legacy-Relay fuer den urspruenglichen Miro-MCP-Flow

Die neue Hauptanwendung fuer Broker-Funktionen ist das FastAPI-Backend plus React-Frontend. Der Node-Service bleibt fuer Kompatibilitaet bestehen.

## Architekturprinzipien

- Trennung zwischen Benutzeroberflaeche, Broker-Logik und Legacy-Relay
- serverseitige Speicherung sensibler Tokenmaterialien
- explizite Freigabe von Servicezugriffen ueber Service-Clients und Delegation Grants
- klare Auditierbarkeit aller relevanten Zustandsaenderungen und Zugriffsvorgaenge

## Laufzeitarchitektur

```mermaid
flowchart LR
    Browser["Browser / React Frontend"] --> API["FastAPI Backend (/api/v1)"]
    API --> DB["SQLite oder andere SQLAlchemy-DB"]
    API --> Miro["Miro OAuth / API"]
    API --> Microsoft["Microsoft Login / OIDC"]
    Service["Service Client"] --> API
    Legacy["Node Relay (src/index.js)"] --> Miro
```

## Frontend

### Technologie

- React 18
- TypeScript
- Vite
- clientseitige Routing-Logik auf Basis von `window.location.pathname`

### Zentrale Dateien

- `frontend/src/App.tsx`
  enthaelt Routing, Seitenlogik und Rollentrennung zwischen Admin und Endnutzer

- `frontend/src/api.ts`
  kapselt alle HTTP-Aufrufe gegen `/api/v1`

- `frontend/src/app-context.tsx`
  verwaltet Session-Zustand, Login/Logout und Toasts

- `frontend/src/components.tsx`
  wiederverwendbare UI-Bausteine

### Routing-Modell

Die App verwendet keinen externen Router; das Routing ist in der Anwendung implementiert.

Admin-Routen:

- `/app`
- `/app/providers`
- `/app/connections`
- `/app/service-clients`
- `/app/delegation`
- `/app/audit`

Self-Service-Routen:

- `/workspace`
- `/connect/miro`
- `/grants`
- `/token-access`

Rollenselektion:

- Admins werden aus Self-Service-Routen nach `/app` umgeleitet
- Endnutzer werden aus Admin-Routen nach `/workspace` umgeleitet

## Backend

### Technologie

- FastAPI
- SQLAlchemy ORM
- Pydantic / pydantic-settings
- httpx fuer externe OAuth- und Provider-Requests

### Einstiegspunkt

- `backend/app/main.py`

Das Backend registriert folgende Router unter `/api/v1`:

- `public`
- `auth`
- `connections`
- `token_issuance`
- `user`
- `admin`

### Konfiguration

Die Konfiguration wird in `backend/app/core/config.py` ueber Umgebungsvariablen geladen.

Wichtige Variablen:

- `DATABASE_URL`
- `BROKER_PUBLIC_BASE_URL`
- `FRONTEND_BASE_URL`
- `CORS_ORIGINS`
- `SESSION_SECRET`
- `SESSION_SECURE_COOKIE`
- `BROKER_ENCRYPTION_KEY`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `MICROSOFT_BROKER_*`
- `MIRO_OAUTH_SCOPE`
- `MIRO_OAUTH_EMAIL_MODE`
- `MIRO_RETRY_COUNT`
- `MIRO_BREAKER_FAIL_THRESHOLD`
- `MIRO_BREAKER_OPEN_MS`

Besonderheit:

- Wenn `BROKER_ENCRYPTION_KEY` nicht gesetzt ist, wird er aus `SESSION_SECRET` abgeleitet.

## Datenhaltung

### Datenbank

Die neue Broker-Anwendung nutzt SQLAlchemy mit einer konfigurierbaren Datenbank.

Standard lokal:

- `sqlite:///./broker.db`

### Wichtige Entitaeten

Die zentralen Tabellen sind in `backend/app/models.py` definiert.

#### Organization

- organisatorische Mandantentrennung

#### User

- Benutzerkonto innerhalb einer Organisation
- kann Admin oder Endnutzer sein

#### Session

- serverseitige Session mit gehashtem Session-Token und CSRF-Token

#### ProviderDefinition

- abstrakter Providertyp, z. B. Miro oder Microsoft

#### ProviderInstance

- konkrete technische Instanz eines Providers

#### ProviderApp

- Richtlinienobjekt fuer Downstream-Zugriff
- enthaelt unter anderem Scopes, Access-Mode und Flags fuer Relay oder Direct Token

#### UserAuthIdentity

- Verknuepfung eines Benutzers mit externer Identitaet, insbesondere fuer Microsoft-Login

#### ConnectedAccount

- konkrete Benutzerverbindung zu einer Provider-App

#### TokenMaterial

- verschluesseltes Access- und Refresh-Token zu einer Verbindung

#### ServiceClient

- technischer Verbraucher des Brokers mit Shared Secret

#### DelegationGrant

- delegierte Zugriffsfreiabe zwischen Benutzer, Service-Client und Provider-App

#### GrantedCapability

- optionale feingranulare Zusatzfaehigkeiten pro Grant

#### TokenIssueEvent

- Diagnostik- und Historieneintrag fuer Zugriffsausgaben und Relay-Entscheidungen

#### AuditEvent

- allgemeines Audit-Logging fuer Zustandsaenderungen

## Seed und Initialisierung

Beim Start wird `init_db()` aus `backend/app/seed.py` ausgefuehrt.

Dabei werden:

- die Datenbanktabellen erzeugt
- Schema-Erweiterungen nachgezogen
- eine Default-Organisation angelegt
- ein Bootstrap-Admin erzeugt
- Provider-Definitionen und Standard-Provider-Apps angelegt

Vordefinierte Seed-Objekte:

- `miro`
- `microsoft`
- `miro-default`
- `microsoft-broker-default`
- `microsoft-graph-default`

## Authentifizierung und Sessions

### Admin-Login

Flow:

1. `POST /api/v1/auth/login`
2. Backend prueft E-Mail und Passwort gegen `users`
3. Session wird erzeugt
4. Session-Cookie wird gesetzt
5. CSRF-Token wird in der Response zurueckgegeben

### Microsoft-Login fuer Endnutzer

Flow:

1. Frontend ruft `POST /api/v1/auth/microsoft/start` auf
2. Backend erzeugt `state`, `nonce` und PKCE-Werte
3. Browser wird zu Microsoft weitergeleitet
4. Callback landet auf `GET /api/v1/auth/microsoft/callback`
5. Backend tauscht Code gegen Tokens, validiert Claims und ordnet den Benutzer zu oder legt ihn an
6. Session-Cookie wird gesetzt
7. Redirect auf `/workspace?login_status=success`

Sicherheitsmerkmale:

- PKCE
- `state`-Pruefung
- Nonce-Pruefung
- serverseitige Session
- CSRF-Schutz fuer schreibende Requests

## Miro-Connect-Flow

Der Miro-Flow ist in `backend/app/routers/connections.py` und `backend/app/miro.py` implementiert.

Flow:

1. Frontend ruft `POST /api/v1/connections/miro/start`
2. Backend erstellt oder erneuert einen Pending-State fuer den OAuth-Flow
3. Browser wird zu Miro weitergeleitet
4. Callback kommt auf `GET /api/v1/connections/miro/callback`
5. Das Backend tauscht den Code gegen Tokenmaterial
6. Die erkannte Provider-Identitaet wird geprueft
7. `ConnectedAccount` und `TokenMaterial` werden angelegt oder aktualisiert
8. Redirect zurueck ins Frontend auf `/connect/miro` mit Statusparametern

Stand Self-Service und Miro:

- Self-Service-Connect ist fuer Miro umgesetzt
- Refresh und Probe sind fuer Miro implementiert

## Delegation und Servicezugriff

### Grundprinzip

Ein Service darf nicht allein mit seinem Shared Secret auf Providerdaten zugreifen. Zusaetzlich wird ein `delegated_credential` benoetigt, das an einen konkreten Grant gebunden ist.

### Direct Token Issuance

Endpunkt:

- `POST /api/v1/token-issues/provider-access`

Erwartete Header:

- `X-Service-Secret`
- `X-Delegated-Credential`

Payload:

- `provider_app_key`
- optionale `requested_scopes`
- optional `connected_account_id`

Das Backend prueft unter anderem:

- Service-Client-Authentifizierung
- Gueltigkeit des Grants
- erlaubten Access-Mode
- Scope-Grenzen
- Zugehoerigkeit zu Provider-App und Connected Account

Danach wird entweder:

- ein Zugriffstoken ausgegeben oder
- der Zugriff blockiert

Beide Faelle werden in `TokenIssueEvent` und `AuditEvent` dokumentiert.

### Relay-Zugriff fuer Miro

Endpunkt:

- `POST /api/v1/broker-proxy/miro/{connected_account_id}`

Auch hier werden `X-Service-Secret` und `X-Delegated-Credential` erwartet. Der Broker validiert die Berechtigung und leitet den Request danach gegen Miro weiter.

## API-Struktur

### Public

- `GET /api/v1/health`
- `GET /api/v1/provider-definitions`

### Auth

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/microsoft/start`
- `GET /api/v1/auth/microsoft/callback`
- `POST /api/v1/auth/logout`
- `GET /api/v1/sessions/me`

### User / Self-Service

- `GET /api/v1/provider-apps`
- `GET /api/v1/connections`
- `POST /api/v1/connections/miro/start`
- `GET /api/v1/connections/miro/callback`
- `POST /api/v1/connections/{id}/refresh`
- `POST /api/v1/connections/{id}/revoke`
- `POST /api/v1/connections/{id}/probe`
- `GET /api/v1/service-clients`
- `GET /api/v1/delegation-grants`
- `POST /api/v1/delegation-grants`
- `POST /api/v1/delegation-grants/{id}/revoke`
- `GET /api/v1/token-issues`

### Admin

- `GET /api/v1/admin/users`
- `GET/POST /api/v1/admin/provider-instances`
- `GET/POST /api/v1/admin/provider-apps`
- `GET /api/v1/admin/connected-accounts`
- `POST /api/v1/admin/connected-accounts/manual`
- `GET/POST /api/v1/admin/service-clients`
- `GET/POST /api/v1/admin/delegation-grants`
- `POST /api/v1/admin/delegation-grants/{id}/revoke`
- `GET /api/v1/admin/audit`
- `GET /api/v1/admin/token-issues`
- `GET /api/v1/admin/migrations/miro/status`
- `POST /api/v1/admin/migrations/miro/import`

## Security-Modell

### Session und CSRF

- authentifizierte Browser-Requests verwenden Cookies
- schreibende Requests verwenden zusaetzlich `X-CSRF-Token`

### Secret-Handling

- Service-Client-Secrets werden nur gehasht gespeichert
- Delegated Credentials werden nur gehasht gespeichert
- Provider-Tokens und Client-Secrets werden verschluesselt gespeichert

### Rollen

- `require_admin` schuetzt Admin-Endpunkte
- normale Benutzer koennen nur auf eigene Verbindungen, Grants und Token-Issue-Historie zugreifen

## Legacy-Node-Service

`src/index.js` enthaelt weiterhin den urspruenglichen Miro-Relay.

Merkmale:

- Express-Anwendung
- dateibasierte Persistenz unter `data/`
- Health-, Ready- und Relay-Endpunkte
- historischer Browser-Flow fuer Miro

Der neue Broker ersetzt diese Schicht nicht vollstaendig, sondern existiert parallel dazu.

## Lokale Entwicklung

### Node-Relay

```bash
npm install
npm start
```

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Docker-Stack

```bash
docker compose up -d --build
```

## Verifikation und Tests

### Relay

```bash
node --check src/index.js
node --test
```

### Backend

```bash
python3 -m py_compile backend/app/*.py backend/app/routers/*.py backend/app/core/*.py
python3 -m unittest backend/test_welle1_smoke.py
```

## Bekannte Grenzen

- Der generische Broker ist modellseitig vorbereitet; der Self-Service-Connect ist auf Miro fokussiert.
- Connection-Probe und Refresh sind fuer Miro implementiert.
- Das Frontend setzt In-App-Routing ohne externe Router-Bibliothek ein.
- Der Legacy-Relay und der neue Broker existieren parallel; im Repository gibt es damit zwei technische Integrationspfade.
