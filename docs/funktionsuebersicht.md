# Funktionsübersicht

## Zweck

Die Anwendung ist ein OAuth-Broker zwischen Nutzern, konfigurierten Integrationen (Miro MCP, Microsoft Graph, generische OAuth/OIDC-Integrationen) und Consumern, die über **Broker Access Keys** zugreifen.

Sie adressiert typischerweise:

- zentrale Verwaltung von Integrationsdefinitionen und Instanzen pro Organisation
- pro Nutzer gespeicherte OAuth-Verbindungen (**User connections**) zu einer **Integration instance**
- Ausstellung und Lebenszyklus von **Access grants** (einmaliger Klartext-Key `bkr_…`, danach nur Hash in der Datenbank)
- Ausführung von Tools, MCP-Relay und optional **Direct token access** für autorisierte Clients

## Rollen

- **Admin**  
  Konfiguriert Microsoft-Sign-in, optionale OIDC-Sign-in-Provider, Nutzerlifecycle (deaktivieren, löschen, Sessions beenden) und — je nach API — Integrationen/Instanzen. Arbeitet in derselben Workspace-Shell wie Endnutzer, mit zusätzlichen Navigationspunkten.

- **Endnutzer**  
  Meldet sich am Broker an, verbindet OAuth-Konten zu Integration-Instanzen, erstellt und verwaltet eigene Access Keys unter **Access**.

## Kernobjekte

| Begriff | Bedeutung |
|---------|-----------|
| **Integration** | Technische Definition (Typ z. B. MCP-Server oder API/OAuth-Provider, Endpunkte, OAuth-Metadaten). |
| **Integration instance** | Konkrete Ausprägung einer Integration für die Organisation. |
| **User connection** | OAuth-Sitzung des Nutzers zu einer Instanz inkl. Tokens und Profil-Metadaten. |
| **Access grant** | Freigabe für Consumer: gehört zu einer Instanz, enthält Policy (z. B. erlaubte Tools), optional Ablauf und Flags wie Direct Token Access. |
| **Broker access key** | Geheimnis `bkr_…`, mit dem Consumer-APIs aufgerufen werden; wird nur bei Erstellung im Klartext gezeigt. |

## Typischer Ablauf

1. Admin richtet Sign-in (Microsoft und/oder OIDC-Provider) und Integrationen ein.
2. Nutzer meldet sich am Workspace an.
3. Nutzer öffnet **Integrations**, wählt eine **Instanz** und startet **Connect** (OAuth zum Provider).
4. Nutzer öffnet **Access**, erstellt einen Access Grant (Name, optional Ablauf, Tool-Einschränkungen, Direct Token Access bei OAuth falls vorgesehen).
5. Consumer ruft mit dem Broker Access Key z. B. `execute`, `discover-tools`, `mcp` oder bei freigegebenem Grant `token` auf; der Broker löst Upstream-OAuth und Richtlinien auf.

## Oberfläche (Workspace)

Nach erfolgreichem Login (Startseite **Sign in**: SSO-Buttons und **Admin sign-in** für lokales Admin-Konto):

| Pfad | Inhalt |
|------|--------|
| `/workspace/integrations-v2` | Integrationen und Instanzen, Verknüpfung zu Connections |
| `/workspace/connections` | Verbindungen pro Instanz: Connect, Disconnect, Test, Status |
| `/workspace/broker-access` | Access Grants: erstellen, widerrufen, Nutzungshinweise (**Usage**) |

Nur **Admin**:

| Pfad | Inhalt |
|------|--------|
| `/workspace/admin/users` | Nutzerliste, Lifecycle, Detail |
| `/workspace/admin/microsoft-oauth` | Microsoft-App für Broker-Login |
| `/workspace/admin/login-providers` | OIDC-Provider für Broker-Login |

## Consumer-Seite (ohne UI)

Automationen und MCP-Clients verwenden die unter `docs/technische-referenz.md` und README beschriebenen Endpunkte mit `X-Broker-Access-Key` oder `Authorization: Bearer bkr_…`. Fehlersuche: `docs/troubleshooting-consumer-mcp-relay.md`.

## Abgrenzung

- **Broker sign-in** (Microsoft / OIDC): Anmeldung am Workspace.
- **Integration OAuth**: Verbindung zu Miro, Microsoft Graph oder generischen OAuth-Zielen für eine **Instanz** — andere Redirects und Clients als beim reinen Broker-Login.

Weitere technische Details: [`technische-referenz.md`](technische-referenz.md).
