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
