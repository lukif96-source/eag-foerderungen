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
| Vorbereitung | Daten erfasst · Projekt im EAG-Portal angelegt | – |
| Call | Ticket gezogen · Antrag eingereicht | Ticket nur am 1. Calltag ab 17:00 · Antrag bis Callende |
| Zusage | Fördervertrag erhalten (**mit Datum**) · Vertrag an Kunden versendet | Nachforderung: 4 Wochen |
| Umsetzung | In Betrieb genommen (Fertigstellungsmeldung) · Bei der E-Control registriert | 6 Monate ab Vertrag, über 100 kWp 12 |
| Abrechnung | Rechnung · Zahlung · Endabrechnung eingereicht · Ausgezahlt | Endabrechnung 6 Monate nach der Inbetriebnahme-Frist |

Nebenschritte: Nachforderung / nachgereicht, Frist verlängert bis. Ende ohne Auszahlung: abgelehnt,
zurückgezogen, Zusage erloschen. **Abgelehnt → „Neu ansuchen“** setzt Ticket und Einreichung zurück,
behält das Portal-Projekt und merkt sich den alten Call – solange noch ein Call offen ist.
Laut SOLPRO ist der Call vom 8.–22.10.2026 der letzte; 2027 gibt es keinen.

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

**Ticket-Tag** (8.10.2026, ab 17:00): Bis einschließlich dem Calltag steht oben unter „Zu tun“ eine Karte.
Namen der Ticket-Zieher eintragen (mit Komma) und Enter → wer noch keinen Zieher hat, wird zufällig und
gleichmäßig zugewürfelt; fällt ein Name weg, werden seine Tickets neu verteilt. Klick auf einen Namen zeigt
nur seine Tickets, „Excel je Zieher“ macht eine Liste pro Person. Ab dem Tag danach ist die Karte weg –
die Zuteilung ist kein eigener Schritt mehr.

Excel-Import: orange-rot markierte Zeilen (abgelehnt) kommen direkt in den offenen Call;
schon importierte Einträge werden beim erneuten Import einmalig umgestellt.

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
