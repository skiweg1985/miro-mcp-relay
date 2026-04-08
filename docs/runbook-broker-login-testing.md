# Runbook: Broker sign-in (OIDC) und Tests

## Neuen generischen OIDC-Provider hinzufügen

1. Workspace als Admin öffnen → **Sign-in providers** (`/workspace/admin/login-providers`).
2. **Add provider**: Provider id (Kleinbuchstaben, für die URL `/api/v1/auth/{id}/…`), Anzeigename, Client id/secret vom IdP.
3. **Redirect URI** am IdP eintragen: exakt den Wert **Copy redirect** aus der Tabelle (oder `{BROKER_PUBLIC_BASE_URL}{api_v1_prefix}/auth/{provider_key}/callback`).
4. Authorization-, Token- und optional Userinfo-URL aus dem Discovery-Dokument des IdP übernehmen.
5. **Claim paths**: mindestens **Subject** und **E-Mail** (typisch `sub` und `email`); bei Keycloak oft identisch mit Standardwerten.
6. Speichern. Auf der Login-Seite erscheint ein Button **Sign in with …** sobald der Provider aktiv ist.

**Häufige Fehler**

| Problem | Prüfung |
|---------|---------|
| 400/422 beim Speichern | URLs müssen `http://` oder `https://` inkl. Host sein; Subject-/E-Mail-Pfad darf nicht leer sein. |
| Redirect-Mismatch am IdP | Callback-URL im IdP exakt wie vom Broker (kein trailing slash-Zwang beachten, je nach IdP). |
| Token-Austausch schlägt fehl | Client secret, Redirect-URI und PKCE müssen zum IdP-Eintrag passen. |

## Microsoft Entra (Broker-Login)

Unverändert unter **Microsoft sign-in** (`/workspace/admin/microsoft-oauth`). Redirect: `…/auth/microsoft/callback`.

## Lokale Mock-Umgebung mit Keycloak

1. Stack starten:
   ```bash
   docker compose --profile test up -d
   ```
2. Warten bis Keycloak bereit ist, dann Konsole: `http://localhost:8180/` (Admin: `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` aus `docker-compose.yml`, Service `keycloak`).
3. Realm **broker-test** wird beim Start per Import aus `testing/keycloak/import/broker-test-realm.json` angelegt (sofern Import ohne Fehler durchläuft).
4. Testnutzer: `testuser` / `change-me`, E-Mail `testuser@example.com`; Attribute `locale=de-DE`, `zoneinfo=Europe/Berlin`.
5. Vertraulicher Client: **broker-login-confidential**, Secret: `broker-test-client-secret-change-me` (nur für lokale Tests).
6. Broker lokal starten (siehe `.env.test.example`): `BROKER_PUBLIC_BASE_URL` muss zu den im Realm eingetragenen Redirect-URIs passen (z. B. `http://localhost:8000`).
7. OIDC-Provider im Broker wie oben anlegen; Endpoints z. B.:
   - Issuer: `http://localhost:8180/realms/broker-test`
   - Authorization: `http://localhost:8180/realms/broker-test/protocol/openid-connect/auth`
   - Token: `http://localhost:8180/realms/broker-test/protocol/openid-connect/token`
   - Userinfo: `http://localhost:8180/realms/broker-test/protocol/openid-connect/userinfo`

**Wenn der Realm-Import fehlschlägt**

Keycloak-Logs prüfen (`docker compose --profile test logs keycloak`). JSON-Import ist versionsabhängig; Realm dann manuell anlegen und Clients/Redirect-URIs wie oben setzen.

## Automatisierte Tests (ohne Keycloak)

```bash
PYTHONPATH=backend python3 -m unittest backend.test_broker_login_flow backend.test_broker_login backend.test_smoke -v
```

`test_broker_login_flow` nutzt Mocks für HTTP (Token/Userinfo) und deckt Happy Path sowie zentrale Fehlerpfade ab; Microsoft-Regression über gemockte `resolve_microsoft_oauth` + Callback. Gemischte Authorization-URL (Browser, z. B. `localhost:8180`) und Token-/Userinfo-URL (Broker im Docker-Netz, z. B. `http://keycloak:8180/...`) deckt `test_generic_oidc_public_auth_host_internal_token_host` ab.

## Integrationstest mit laufendem Keycloak

Voraussetzungen: Keycloak wie oben erreichbar; Unittest vom Projektroot mit `PYTHONPATH=backend` (gleiche SQLite-Datei wie die übrigen Backend-Tests, übliches Arbeitsverzeichnis beachten). Standard `BROKER_PUBLIC_BASE_URL` ist `http://localhost:8000`; die Callback-URL muss bei **broker-login-confidential** als Redirect-URI erlaubt sein.

```bash
docker compose --profile test up -d
KEYCLOAK_LOGIN_INTEGRATION=1 PYTHONPATH=backend python3 -m unittest backend.test_keycloak_broker_login_integration -v
```

Der Test nutzt `TestClient` (Broker im selben Prozess): OIDC-Endpunkte aus dem Discovery-Dokument, danach auf die Origin von `KEYCLOAK_BASE_URL` (Standard `http://localhost:8180`) normalisiert, damit vom Host aus alle Aufrufe über die published URL laufen. Login-Formular gegen Keycloak, anschließend `GET /api/v1/auth/.../callback` mit echtem `code`. Erwartet werden Redirect mit `login_status=success` und Session-Cookie. Läuft nur bei `KEYCLOAK_LOGIN_INTEGRATION=1` und erreichbarem IdP.

## Abgrenzung

- **Broker sign-in**: Nutzer melden sich am Workspace an (dieses Runbook).
- **Integration OAuth** (Connections / Miro / Graph): andere Clients, andere Redirects — siehe Integrations- und Callback-Dokumentation.

Weitere Hinweise: [troubleshooting-broker-login.md](./troubleshooting-broker-login.md).
