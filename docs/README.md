# Dokumentation

Dieser Ordner beschreibt die Anwendung aus zwei Blickwinkeln:

- fachlich: Was die App macht, welche Rollen es gibt und was die einzelnen Menuepunkte bedeuten
- technisch: Wie Frontend, Backend, Authentifizierung, Datenmodell und API zusammenspielen

## Inhalte

- `funktionsweise-und-menuepunkte.md`
  Erklaert den Zweck der App, die Benutzerrollen und alle sichtbaren Menuebereiche im Admin- und Self-Service-Frontend.

- `technische-dokumentation.md`
  Beschreibt die Architektur, zentrale Ablaeufe, Datenmodelle, APIs, Konfiguration und lokale Entwicklungs-/Testpfade.

## Kurzueberblick

Die Anwendung ist ein OAuth-Broker mit zwei Nutzungsarten:

- Admin-Control-Deck fuer Betrieb, Konfiguration und Governance
- Self-Service-Workspace fuer Endnutzer zum Verbinden von Konten, Erstellen von Freigaben und Pruefen von Zugriffen

Aktuell ist Miro der wichtigste angebundene Downstream-Provider im Self-Service-Flow. Die Plattform ist aber bereits so aufgebaut, dass weitere Provider-Apps, Service-Clients und delegierte Zugriffsszenarien ergaenzt werden koennen.
