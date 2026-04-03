# Dokumentation

## Inhalt

- [`funktionsuebersicht.md`](funktionsuebersicht.md) — Rollen, fachliche Ablaeufe und Oberflaechenbereiche
- [`technische-referenz.md`](technische-referenz.md) — Architektur, Datenmodell, APIs, Konfiguration und lokale Entwicklung

## Ueberblick

Die Anwendung ist ein OAuth-Broker mit zwei Nutzungsarten:

- Admin-Control-Deck fuer Betrieb, Konfiguration und Governance
- Self-Service-Workspace fuer Endnutzer: Konten verbinden, Freigaben erstellen, Zugriffe pruefen

Miro ist der zentral angebundene Downstream-Provider im Self-Service-Flow. Das Modell laesst sich um weitere Provider-Apps, Service-Clients und delegierte Zugriffsszenarien erweitern.
