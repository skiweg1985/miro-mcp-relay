# Dokumentation

## Inhalt

- [`funktionsuebersicht.md`](funktionsuebersicht.md) — Rollen, Kernobjekte, Workspace-Pfade, Consumer-Abgrenzung
- [`technische-referenz.md`](technische-referenz.md) — Architektur, Datenmodell, Router, Konfiguration, lokale Entwicklung
- [`runbook-broker-login-testing.md`](runbook-broker-login-testing.md) — OIDC-Sign-in-Provider, Keycloak-Testprofil, Unittests
- [`troubleshooting-broker-login.md`](troubleshooting-broker-login.md) — Broker-Anmeldung (OIDC / Microsoft)
- [`troubleshooting-consumer-mcp-relay.md`](troubleshooting-consumer-mcp-relay.md) — Consumer-MCP-Relay, Streams, HAProxy

## Überblick

Die Anwendung ist ein OAuth-Broker: Admins richten Integrationen und Sign-in ein, Nutzer verbinden OAuth-Konten zu **Integration instances**, und **Access grants** steuern den Zugriff für Consumer-APIs (`execute`, `discover-tools`, MCP-Relay, optional Direct Token).

Miro ist ein vordefiniertes Integrationsbeispiel (MCP); das Modell unterstützt weitere Integrationstypen und generische OAuth/OIDC-Anbindungen.

Das Repository-Root-[`README.md`](../README.md) enthält Quickstart, Beispiel-`curl`-Aufrufe und Projektstruktur.
