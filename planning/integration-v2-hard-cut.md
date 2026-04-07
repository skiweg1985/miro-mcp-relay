# Integration V2 Hard Cut

## Zielbild

- Integration beschreibt das Zielsystem (`type`, `config`, `mcp_enabled`).
- Authentisierung wird pro Instanz über `auth_mode` und `auth_config` geführt.
- Zugriff wird pro Instanz über `access_mode` und `access_config` geführt.
- MCP ist eine Fähigkeit der Integration, nicht der Relay-Mechanismus.

## Datenmodell

- `integrations`
  - `id`, `organization_id`, `name`, `type`, `config_json`, `mcp_enabled`, Zeitstempel
- `integration_instances`
  - `id`, `organization_id`, `integration_id`, `name`
  - `auth_mode`, `auth_config_json`
  - `access_mode`, `access_config_json`
  - `created_by_user_id`, Zeitstempel
- `integration_tools`
  - `id`, `organization_id`, `integration_id`, `tool_name`
  - `description`, `input_schema_json`
  - `visible`, `allowed`, Zeitstempel
  - Unique: `integration_id + tool_name`

## API Contract (V2)

- `GET /api/v1/integrations`
- `POST /api/v1/integrations`
- `GET /api/v1/integration-instances`
- `POST /api/v1/integration-instances`
- `POST /api/v1/integration-instances/{instance_id}/execute`
- `POST /api/v1/integration-instances/{instance_id}/discover-tools`

## Validierung

- `type = mcp_server` erfordert `mcp_enabled = true`.
- `type = mcp_server` erlaubt nur `access_mode = relay`.
- `type = oauth_provider` erlaubt nur `auth_mode = oauth`.
- `auth_mode = none` erlaubt keine Credentials im `auth_config`.

## Runtime-Schnitt

- Aktive Router im Backend:
  - `public`
  - `auth`
  - `integrations_v2`
- Frontend-Einstieg für Self-Service:
  - `/workspace/integrations-v2`

## Physische Bereinigung

- Legacy-Python-Module und -Router zum alten Integrations-/Relay-Modell wurden entfernt.
- Microsoft-Login (Endnutzer) liest Client-ID und Secret aus der Umgebung (`MICROSOFT_BROKER_CLIENT_ID`, `MICROSOFT_BROKER_CLIENT_SECRET`, Tenant/Authority über bestehende Settings). Verknüpfung Nutzer ↔ Microsoft-Subject in `oauth_identities`.
- Für eine saubere lokale Datenbank kann `broker.db` gelöscht und der Dienst neu gestartet werden (neues Schema ohne Alt-Tabellen).
