# EAG-Förderungen · SOLPRO

Übersicht aller Förderanträge (EAG-Investitionszuschuss u. a.): was beantragt werden muss,
wo der Fördervertrag steht, was abgerechnet ist.

**Live:** https://lukif96-source.github.io/eag-foerderungen/

## Aufbau
- Statische Web-App ohne Build (`index.html`, `css/`, `js/`), gehostet über GitHub Pages.
- Daten liegen in Supabase (Projekt `iuxklqcpexoziqxrohwa`), geschützt durch Login + Row Level Security.
- **In diesem Repo stehen keine Kundendaten.** Excel-Dateien sind per `.gitignore` ausgeschlossen.

## Einrichtung
Bereits erledigt (2026-09-28): Tabellen aus `sql/setup.sql` angelegt, Admin = l.fischereder@solpro.at.
Offen im Supabase-Dashboard:
- Authentication → URL Configuration → **Site URL** = `https://lukif96-source.github.io/eag-foerderungen/`
  (für Bestätigungs- und Passwort-Mails).

Danach: anmelden → **Excel-Import** → bisherige Liste auswählen.

## Ablauf: 12 Schritte in 5 Phasen

| Phase | Schritte | Frist |
|---|---|---|
| Vorbereitung | Name und Zählpunkt erfasst · Projekt im EAG-Portal angelegt | – |
| Call | Ticket gezogen · Antrag eingereicht | Ticket nur am 1. Calltag ab 17:00 · Antrag bis Callende |
| Zusage | Fördervertrag erhalten (**mit Datum**) · Vertrag an Kunden versendet | Nachforderung: 4 Wochen |
| Umsetzung | In Betrieb genommen (Fertigstellungsmeldung) · Bei der E-Control registriert | 6 Monate ab Vertrag, über 100 kWp 12 |
| Abrechnung | Rechnung · Zahlung · Endabrechnung eingereicht · Ausgezahlt | Endabrechnung 6 Monate nach der Inbetriebnahme-Frist |

Nebenschritte: Nachforderung / nachgereicht, Frist verlängert bis. Ende ohne Auszahlung: abgelehnt,
zurückgezogen, Zusage erloschen. **Abgelehnt → „Neu ansuchen“** setzt Ticket und Einreichung zurück,
behält das Portal-Projekt und merkt sich den alten Call – solange noch ein Call offen ist.
Laut SOLPRO ist der Call vom 8.–22.10.2026 der letzte; 2027 gibt es keinen.
Abgelehnte sind sichtbar, solange noch angesucht werden kann: oben der Alarm „abgelehnt – neu ansuchen bis …“
(führt zur Ansicht Beendet), auch aus Vorjahren in der aktuellen Jahresansicht. „Neu ansuchen“ zieht das Jahr auf den
neuen Call und merkt sich Call **und** Ablehnungsdatum; die Zeile zeigt „2. Versuch · zuvor abgelehnt …“, die Akte oben
im Ablauf alle Ansuchen.

**Pflichtfelder:** Für das Ticket nur **Name und Einspeisezählpunkt**. Straße, PLZ, Ort, Mail und kWp braucht erst der
Antrag im Portal – fehlen sie, steht beim Schritt „Antrag einreichen“ ein Hinweis (keine Sperre).

**Status-Tracker** oben in jeder Akte: je Phase ein Abschnitt, je Schritt ein Strich (grün = erledigt,
Rahmen = jetzt dran, schraffiert = Förderstelle ist dran, rot = übersprungen), darunter der nächste Schritt,
wer dran ist und die dringendste Frist. Berechnet von `tracker()` in `js/ablauf.js`.

Weiterentwicklung (UI, Revisionssicherheit, Messtool, weitere Programme): `docs/BLUEPRINT.md`.
Vorschlag für ein unveränderbares Protokoll: `sql/vorschlag-revision.sql` (noch nicht eingespielt).

Die Regeln stehen an **einer** Stelle: `js/ablauf.js` (ohne Seite, ohne Datenbank), getestet mit
`node --test` (läuft auch bei jedem Push auf GitHub). Fristen werden berechnet, nie gespeichert.
Nachtragen ist nie Pflicht: Ohne Vertragsdatum gilt die frühestmögliche Frist (ab Callende) als Schätzung,
solange sie noch vor uns liegt; bei alten Förderungen bleibt die Frist leise „unbekannt“.
**Ausgezahlt = fertig**, egal was davor fehlt. Fehlende Kundendaten zählen nur bis zum Ticket und nur,
solange der Call nicht vorbei ist.

**Ticket-Tag** (8.10.2026, ab 17:00): Bis einschließlich dem Tag danach (9.10.) steht oben unter „Zu tun“ eine Karte.
Vorher: Namen der Ticket-Zieher eintragen (mit Komma) und Enter → wer noch keinen Zieher hat, wird zufällig und
gleichmäßig zugewürfelt; fällt ein Name weg, werden seine Tickets neu verteilt. Am Calltag und am Tag danach zeigt die
Karte jedes Ticket mit Kopier-Knöpfen in Portal-Reihenfolge (Tasten 1–7: Zählpunkt, Kunde, Straße, PLZ, Ort, kWp, FPJ)
und „Gezogen“: gespeichert werden Datum, Uhrzeit (am Calltag) und **wer wirklich gezogen hat**. Zieht jemand anderer,
vorher den Namen umstellen – der Zieher wird zu dieser Person, die gewürfelte Zuteilung bleibt als „gewürfelt war …“
in der Akte. Am 9.10. heißt die Karte „heute eintragen, wer gezogen hat“; ab 10.10. ist sie weg.

Excel-Import: orange-rot markierte Zeilen (abgelehnt) kommen direkt in den offenen Call;
schon importierte Einträge werden beim erneuten Import einmalig umgestellt.

## Bedienung
Design wie im Messtool (`pro.css`): neutrale Grautöne, Farbe nur für Bedeutung (Grün erledigt, Bernstein bald,
Rot dringend), Hell/Dunkel automatisch oder im Menü umschaltbar.
Tastatur: **⌘K / Strg+K** Suchen und Befehle (Kunde finden, nächsten Schritt erledigen, Ansicht wechseln) ·
**/** Liste filtern · **J / K** nächste/vorige Förderung (auch in der offenen Akte) · **E** nächsten Schritt heute
erledigen · **N** neuer Kunde · **⌘S** speichern · **⌘Z** letztes Erledigen rückgängig · **?** Übersicht.
Jedes Schnell-Erledigen zeigt 8 Sekunden „Rückgängig“.

## Tägliche Sicherung
Jede Nacht (02:15) wird die ganze Förderliste gesichert: unveränderbar in der Datenbank (`foerder_archiv`, mit
SHA-256, verkettet mit dem Vortag), als Datei im privaten Storage und per Mail an die Admins (CSV für Excel + JSON).
Dabei werden überfällige Fristen protokolliert. Aufbewahrung: 90 Tage täglich, danach jeder Monatserste.
In der App: ☰ → **Sicherungen** (Admins) – Excel je Tag, „Mit heute vergleichen“, einzelne Förderungen zurückholen.
Einrichtung: `docs/EINSPIELEN.md` (`sql/archiv.sql` + Edge Function `foerder-taeglich`).
Die Edge Function enthält eine Kopie von `js/ablauf.js` – nach jeder Regeländerung mitkopieren (ein Test prüft das).

## Rollen
| Rolle | darf |
|---|---|
| Admin | alles, Nutzer freischalten, Import, endgültig löschen |
| Bearbeiten | Förderungen anlegen, ändern, in den Papierkorb legen |
| Nur lesen | ansehen und Excel-Export |

Neue Kolleg:innen registrieren sich selbst auf der Login-Seite und sehen erst etwas, wenn ein Admin
sie unter ☰ → **Nutzer & Rollen** → „Warten auf Freischaltung“ freischaltet.

## Lokal testen
`python -m http.server 8093` im Ordner starten und `http://localhost:8093/?demo` öffnen
(Demo-Modus mit Beispieldaten, ohne Datenbank).
