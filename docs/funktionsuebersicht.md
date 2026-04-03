# Funktionsübersicht

## Zweck

Die App dient als OAuth-Broker zwischen Benutzern, angebundenen Providern und internen oder externen Services.

Sie loest dabei drei Kernprobleme:

- Benutzer melden sich am Broker an und verbinden ihre Provider-Konten, ohne Tokens selbst manuell verwalten zu muessen.
- Services erhalten nur die Zugriffe, die ueber Service-Clients und Delegation Grants explizit freigegeben wurden.
- Betreiber koennen Provider, Verbindungen, Freigaben und Audit-Daten zentral verwalten.

## Rollen in der App

Es gibt zwei Hauptrollen:

- `Admin`
  Nutzt das Control Deck unter `/app` und verwaltet die Plattform organisatorisch.

- `Endnutzer`
  Nutzt den Self-Service-Bereich unter `/workspace` und verwaltet nur eigene Verbindungen und Grants.

## Ablauf

Standardablauf:

1. Ein Benutzer meldet sich am Broker an.
2. Der Benutzer verbindet sein Provider-Konto (vorrangig Miro).
3. Ein Admin legt Service-Clients an, also vertrauenswuerdige Verbraucher der Plattform.
4. Der Benutzer oder Admin erstellt einen Delegation Grant fuer einen Service-Client.
5. Ein Service ruft mit `X-Service-Secret` und `X-Delegated-Credential` einen Broker-Endpunkt auf.
6. Der Broker prueft Berechtigung, Scope-Grenzen, Modus und Verbindung und gibt entweder Zugriff frei oder blockiert den Vorgang.

## Einstiegspunkte

### Login-Seite

Die Login-Seite unter `/login` bietet zwei Wege:

- Microsoft-Login fuer Endnutzer
- lokaler Admin-Login mit E-Mail und Passwort

Nach erfolgreichem Login wird automatisch in den passenden Bereich weitergeleitet:

- Admins nach `/app`
- Endnutzer nach `/workspace`

## Admin-Bereich

Der Admin-Bereich ist das "Control Deck" und enthaelt folgende Menuepunkte.

### Overview

Pfad: `/app`

Zweck:

- zeigt einen Ueberblick ueber den Zustand der Plattform
- visualisiert Health-Status, Anzahl der Provider-Apps, Verbindungen, Service-Clients und Delegation Grants
- zeigt die letzten Audit-Ereignisse

Verwendung:

- Betriebscheck und Status
- Orientierung nach dem Login
- Einstieg in die Verwaltungsbereiche

### Providers

Pfad: `/app/providers`

Zweck:

- verwaltet Provider-Definitionen, Provider-Instanzen und Provider-Apps
- legt damit fest, welche Downstream-Systeme angebunden sind und unter welchen Regeln auf sie zugegriffen werden darf

Bereiche innerhalb der Seite:

- `Provider definitions`
  Bereits bekannte Provider-Familien wie Miro oder Microsoft

- `Create provider instance`
  Legt eine konkrete OAuth- oder Broker-Auth-Instanz an, z. B. einen Miro- oder Microsoft-Endpunkt

- `Provider instances`
  Liste aller vorhandenen Instanzen

- `Provider apps`
  Richtlinienebene fuer den Zugriff, inklusive `access_mode`, Relay-Faehigkeit und Direct-Token-Freigabe

- `Create provider app`
  Anlegen einer App mit Client-ID, Secret, Redirect-URIs, Default-Scopes und Scope-Ceiling

Rolle:

- Hier wird die Policy definiert, die spaeter bei Token-Ausgabe und Relay-Zugriff ausgewertet wird.

### Connections

Pfad: `/app/connections`

Zweck:

- zeigt alle brokerseitig gespeicherten Connected Accounts
- erlaubt Filter nach Benutzer, Provider-App und Status
- dient fuer Pruefung, Refresh, Probe und Widerruf von Verbindungen

Moegliche Aktionen:

- `Refresh`
  Versucht die gespeicherten OAuth-Credentials zu aktualisieren

- `Probe`
  Testet, ob der Broker mit den gespeicherten Credentials noch erfolgreich beim Provider arbeiten kann

- `Revoke`
  Markiert eine Verbindung als widerrufen

- `Store connected account`
  Manuelles Bootstrap- oder Migrationsformular fuer Verbindungen inklusive Tokenmaterial

Rolle:

- Dies ist die zentrale Betriebsseite fuer bestehende Nutzerverbindungen.
- Der manuelle Anlagepfad ist vor allem fuer Migration, Recovery oder initiale Datenuebernahme gedacht.

### Service clients

Pfad: `/app/service-clients`

Zweck:

- verwaltet vertrauenswuerdige Systeme, die spaeter Broker-Zugriffe anfragen duerfen

Bereiche:

- `Service clients`
  Liste vorhandener Clients mit Key, Umgebung, Auth-Methode und Erstellungszeitpunkt

- `Create service client`
  Legt einen neuen Service-Client an und verknuepft ihn mit erlaubten Provider-Apps

Hinweis:

- Das `client_secret` wird nur einmal bei der Erstellung angezeigt und muss dann sicher abgelegt werden.

### Delegation

Pfad: `/app/delegation`

Zweck:

- erstellt und verwaltet delegierte Zugriffsfreiaben fuer Service-Clients im Namen von Benutzern

Ein Delegation Grant verbindet:

- einen Benutzer
- einen Service-Client
- eine Provider-App
- optional eine konkrete Connected Account-Instanz
- erlaubte Zugriffsmodi
- Scope-Grenzen
- optionale Capabilities
- Ablaufdatum

Bereiche:

- `Delegation grants`
  Liste aktiver, abgelaufener oder widerrufener Grants

- `Create delegation grant`
  Admin-Seite zum Erstellen einer neuen delegierten Freigabe

Hinweis:

- Das `delegated_credential` wird nur einmal direkt nach der Erstellung angezeigt.

### Audit

Pfad: `/app/audit`

Zweck:

- zeigt Audit-Events fuer Zustandsaenderungen in der Plattform
- zeigt Token-Issue-Diagnostik fuer service-seitige Zugriffsanfragen

Bereiche:

- `Token issue diagnostics`
  Filterbare Historie ueber ausgegebene, blockierte oder fehlgeschlagene Broker-Zugriffe

- `Audit events`
  Allgemeine Plattform-Aktivitaeten wie Login, Verbindungsaktionen oder Grant-Aenderungen

Rolle:

- Dies ist die wichtigste Seite fuer Nachvollziehbarkeit, Troubleshooting und Governance.

## Self-Service-Bereich

Der Self-Service-Bereich ist fuer Endnutzer gedacht und enthaelt folgende Menuepunkte.

### Workspace

Pfad: `/workspace`

Zweck:

- zentrale Uebersicht ueber eigene Provider-Verbindungen
- Anzeige wichtiger Kennzahlen wie aktive Verbindungen, Fehler und letzter Probe-Status

Moegliche Aktionen:

- `Connect Miro`
  Startet den Miro-Verbindungsflow

- `Refresh`
  Aktualisiert vorhandene Zugangsdaten

- `Probe`
  Fuehrt einen sicheren Verbindungstest aus

- `Revoke`
  Entzieht dem Broker den Zugriff auf die Verbindung

Rolle:

- Dies ist die Startseite fuer Endnutzer nach dem Login.

### Connect Miro

Pfad: `/connect/miro`

Zweck:

- startet oder erneuert die Verbindung eines Miro-Kontos mit dem Broker

Seiteninhalt:

- `Miro authorization`
  Startet den OAuth-Flow

- `Current Miro state`
  Zeigt den gespeicherten Broker-Zustand der Miro-Verbindung

Hinweis:

- Der Broker speichert das Tokenmaterial serverseitig.
- Nach erfolgreichem Callback wird automatisch zur App zurueckgeleitet.

### My Grants

Pfad: `/grants`

Zweck:

- Endnutzer koennen eigene Delegation Grants fuer bereits freigegebene Service-Clients erzeugen und widerrufen

Seiteninhalt:

- `Your grants`
  Liste der eigenen Grants mit Provider, Verbindung, Modus, Ablauf und Policy

- `Create a grant`
  Formular zum Erstellen eines Self-Service-Grants

Ein Benutzer waehlt dabei:

- den Service-Client
- die Provider-App
- die konkrete Verbindung
- erlaubte Zugriffsmodi
- optional engere Scope-Grenzen
- optionale Capabilities
- Laufzeit

Hinweis:

- Nur die eigenen Grants werden angezeigt.
- Das neue `delegated_credential` wird nur einmal eingeblendet.

### Token Access

Pfad: `/token-access`

Zweck:

- zeigt die Zugriffshistorie fuer eigene Grants
- unterstuetzt bei der Fehlersuche mit einem sicheren Connection-Probe

Bereiche:

- `Filters`
  Eingrenzung nach Service-Client, Grant und Entscheidung

- `Connection probe`
  Manuelle Verbindungspruefung gegen den Provider, ohne rohe Tokens anzuzeigen

- `Token issue history`
  Historie aller Broker-Entscheidungen fuer eigene Grants

Moegliche Ergebnisse:

- `issued`
- `relayed`
- `blocked`
- `error`

## Fachliche Kernbegriffe

### Provider Definition

Abstrakte Beschreibung eines Providers, z. B. Miro oder Microsoft.

### Provider Instance

Konkrete technische Instanz eines Providers innerhalb der Organisation, z. B. mit spezifischen Endpunkten.

### Provider App

Die Policy-Schicht fuer den Zugriff. Hier wird unter anderem geregelt:

- welche Scopes standardmaessig genutzt werden
- wie eng der Scope maximal sein darf
- ob Relay erlaubt ist
- ob Direct-Token-Ausgabe erlaubt ist
- welcher Access-Mode gilt

### Connected Account

Eine konkrete Benutzerverbindung zu einem Provider, inklusive serverseitig gespeicherter Tokens.

### Service Client

Ein vertrauenswuerdiger Verbraucher des Brokers, der sich mit einem Secret gegen den Broker authentifiziert.

### Delegation Grant

Eine explizite Freigabe, dass ein bestimmter Service-Client im Kontext eines Benutzers auf eine bestimmte Provider-App zugreifen darf.

### Delegated Credential

Ein einmalig ausgegebenes Geheimnis, mit dem ein Service zusammen mit seinem Client-Secret einen konkreten Grant nutzen kann.

## Self-Service und Downstream-Provider

Der Self-Service-Flow ist auf Miro ausgerichtet:

- Miro kann aus dem Workspace verbunden werden.
- Refresh und Probe sind fuer Miro implementiert.
- Das Datenmodell unterstuetzt weitere Provider-Apps und Service-Szenarien.
