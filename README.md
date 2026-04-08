# miro-mcp-relay

## Was ist das?
`miro-mcp-relay` ist ein Broker für OAuth-geschützte Integrationen mit Fokus auf MCP- und API-basierte Tool-Nutzung.  
Das Projekt trennt Integrationsdefinition, konkrete Instanzen, OAuth-Verbindungen und Zugriffsschlüssel sauber voneinander, damit Admins und Endnutzer unabhängig arbeiten können.  
Die Laufzeit besteht aus einem FastAPI-Backend (`backend/app`) und einer React/Vite-UI (`frontend`), optional im Docker-Stack mit HAProxy und Postgres.

## Wofür ist das sinnvoll? (Praxisbeispiele)
- Ein Team will Miro-Tools in eigene Automationen einbinden, ohne Provider-Tokens in jedem Consumer-System zu speichern.
- Eine Plattform soll Endnutzer-Logins über Microsoft erlauben und danach OAuth-Verbindungen für Integrationen pro Nutzer verwalten.
- Ein Service braucht feingranulare Access Grants, die auf einzelne Integration-Instanzen und optional auf Tool-Listen eingeschränkt sind.
- Ein Betriebsteam möchte Upstream-Calls zentral überwachen (Audit), statt verteilte Tokens und Logs in mehreren Services nachzuverfolgen.

## Features
- FastAPI Broker API unter `/api/v1` mit Session- und CSRF-Schutz.
- Integration-V2-Modell mit getrennten Ressourcen:
  - Integrationen (`/integrations`)
  - Integration-Instanzen (`/integration-instances`)
  - OAuth-Connect/Disconnect pro Instanz.
- Microsoft Login für Endnutzer (`/auth/microsoft/start`, `/auth/microsoft/callback`).
- Access-Grant-Lifecycle (erstellen, validieren, widerrufen, löschen).
- Consumer-Ausführung und Tool-Discovery mit Broker Access Key.
- Streamable-HTTP MCP Relay für MCP-Server-Integrationen.
- Docker-Setup mit HAProxy, Backend, Frontend, Postgres.
- OpenAPI-Dokumentation unter `/api/v1/docs`.

## Wie funktioniert das? (einfach erklärt)
1. Ein Admin legt Integrationen und Instanzen an (z. B. Miro oder Microsoft Graph).  
2. Nutzer melden sich am Broker an und verbinden ihre OAuth-Konten pro Instanz.  
3. Nutzer erzeugen Access Grants für eine Instanz; dabei entsteht ein einmalig ausgegebener Broker Access Key (`bkr_...`).  
4. Ein Consumer ruft den Broker mit diesem Key auf:
   - entweder als strukturierter Execute-Call,
   - oder als MCP-Relay-Call für streamable HTTP.  
5. Der Broker prüft Grant, Tool-Policy und OAuth-Zustand, führt den Upstream-Call aus und protokolliert die Nutzung.

## Verfügbare Funktionen / Schnittstellen / Tools

### Kern-APIs
- `GET /api/v1/health`  
  Health-Check für Backend-Liveness.

- `POST /api/v1/auth/login`  
  Session-Login (lokaler User), Antwort enthält `csrf_token`.

- `POST /api/v1/auth/{provider_id}/start`  
  Startet Broker-Login für einen konfigurierten Provider (z. B. `microsoft` oder OIDC-`provider_id` aus **Sign-in providers**).

- `GET /api/v1/integrations`  
  Listet Integrationen der Organisation.

- `GET /api/v1/integration-instances`  
  Listet Instanzen; zentrale Ressource für OAuth, Tool-Discovery und Execute.

- `POST /api/v1/integration-instances/{instance_id}/oauth/start`  
  Startet OAuth-Verbindung für die Instanz.

- `POST /api/v1/access-grants`  
  Erzeugt Access Grant und liefert den Klartext-Key einmalig zurück.

- `POST /api/v1/consumer/integration-instances/{instance_id}/execute`  
  Führt eine Action/Tool-Nutzung über den Broker aus.

- `POST /api/v1/consumer/integration-instances/{instance_id}/discover-tools`  
  Liest verfügbare Tools der Zielintegration.

- `POST /api/v1/consumer/integration-instances/{instance_id}/mcp`  
  MCP Relay Entry-Point (zusätzliche Pfade sind erlaubt).

- `POST /api/v1/consumer/integration-instances/{instance_id}/token`  
  Liefert das aktuelle Upstream-OAuth-Access-Token, nur wenn der Access Grant **Direct token access** erlaubt und die Connection OAuth nutzt; kein Refresh Token in der Antwort (optional `email` / `username` aus Profil-Metadaten).

### Wichtige Header
- `X-CSRF-Token`: Pflicht für state-changing Session-Endpunkte.
- `X-Broker-Access-Key`: Broker-Key für Consumer-Endpunkte.
- `Authorization: Bearer bkr_...`: Alternative zu `X-Broker-Access-Key`.
- `X-User-Token`: optionaler Upstream-Token für bestimmte Flows.

## Beispiel-Use-Cases (sehr wichtig)
1. **Miro-Relay für Agent-Clients**  
   Ein Agent ruft `.../consumer/integration-instances/{id}/mcp` auf, der Broker hält OAuth-Tokens intern und streamt die Antwort durch.

2. **Tool-Freigabe pro Consumer**  
   Access Grant enthält erlaubte Tool-Namen; der Consumer kann nur diese Tools ausführen.

3. **Zero-Trust zwischen Plattform und Integrationen**  
   Consumer kennt nur Broker-Key, nicht den echten Provider-Token.

4. **Mehrmandantenfähige Integrationsverwaltung**  
   Integrationen und Instanzen sind organisationsgebunden; Nutzer verbinden eigene OAuth-Konten pro Instanz.

5. **Betriebsnahe Fehlersuche**  
   Audit und klare API-Fehler (`missing_broker_access_key`, `oauth_upstream_token_missing`, `integration_not_mcp_enabled`) erleichtern Debugging in Produktion.

## Quickstart

### 1) Installation
```bash
npm ci
cp .env.example .env
```

### 2) Konfiguration
Mindestens diese Werte in `.env` prüfen:
```bash
BROKER_PUBLIC_BASE_URL=http://localhost
FRONTEND_BASE_URL=http://localhost
CORS_ORIGINS=http://localhost
SESSION_SECRET=change-me-broker-session-secret
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=change-me-admin-password
```

Für Microsoft Login zusätzlich:
```bash
MICROSOFT_BROKER_TENANT_ID=common
MICROSOFT_BROKER_CLIENT_ID=YOUR_CLIENT_ID_HERE
MICROSOFT_BROKER_CLIENT_SECRET=YOUR_CLIENT_SECRET_HERE
MICROSOFT_BROKER_SCOPE=openid profile email User.Read
```

### 3) Erster Start (Docker)
```bash
docker compose up -d --build
```

Danach erreichbar:
- UI: [http://localhost](http://localhost)
- API Docs: [http://localhost/api/v1/docs](http://localhost/api/v1/docs)
- Health: [http://localhost/api/v1/health](http://localhost/api/v1/health)

### 4) Erster Start (ohne Docker)
Backend:
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

## Beispiele

### Session-Login
```bash
curl -sS -X POST http://localhost/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "change-me-admin-password"
  }'
```

### Access Grant erstellen (mit Session-Cookie + CSRF)
```bash
curl -sS -X POST http://localhost/api/v1/access-grants \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -b "broker_session=<session_cookie>" \
  -d '{
    "integration_instance_id": "<instance_id>",
    "name": "ci-relay-key",
    "allowed_tools": ["boards.list"]
  }'
```

### Consumer Execute mit Broker-Key
```bash
curl -sS -X POST http://localhost/api/v1/consumer/integration-instances/<instance_id>/execute \
  -H "Content-Type: application/json" \
  -H "X-Broker-Access-Key: bkr_YOUR_ACCESS_KEY_HERE" \
  -d '{
    "action": "tool",
    "tool_name": "boards.list",
    "arguments": {}
  }'
```

### Consumer Tool-Discovery
```bash
curl -sS -X POST http://localhost/api/v1/consumer/integration-instances/<instance_id>/discover-tools \
  -H "X-Broker-Access-Key: bkr_YOUR_ACCESS_KEY_HERE"
```

### MCP Relay-Aufruf
```bash
curl -sS -X POST http://localhost/api/v1/consumer/integration-instances/<instance_id>/mcp \
  -H "X-Broker-Access-Key: bkr_YOUR_ACCESS_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Hinweise / Einschränkungen
- `src/` enthält Legacy-Node-Code als Referenz und Tests, ist aber nicht der aktive Runtime-Pfad.
- State-changing Endpunkte mit Session erwarten `X-CSRF-Token`; ohne Token kommen `4xx`-Fehler.
- Für OAuth-Instanzen schlägt Consumer-Ausführung ohne verfügbaren Upstream-Token mit `oauth_upstream_token_missing` fehl.
- MCP Relay ist nur für Instanzen mit `integration.type = mcp_server`, `mcp_enabled = true` und `access_mode = relay` verfügbar.
- Lokales HTTPS (`https://localhost`) verwendet ein selbstsigniertes Zertifikat aus `./devcert`.
- Standard-Bootstrap-Credentials sind nur für lokale Entwicklung geeignet und müssen in realen Umgebungen ersetzt werden.

## Validierung
- Alle Node-Tests:
```bash
npm test
```
- Direkter Node-Testlauf:
```bash
node --test
```
- Python Syntax-Check:
```bash
python3 -m py_compile backend/app/*.py backend/app/routers/*.py backend/app/core/*.py
```

## Projektstruktur
- `backend/app`: FastAPI API, Auth, OAuth, Access Grants, Relay-Logik.
- `frontend`: React/Vite Oberfläche für Login, Integrationen und Workspace.
- `haproxy`: lokaler Reverse Proxy (HTTP/HTTPS).
- `docker-compose.yml`: lokaler Full-Stack-Start.
