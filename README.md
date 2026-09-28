# EAG-Förderungen · SOLPRO

Übersicht aller Förderanträge (EAG-Investitionszuschuss u. a.): was beantragt werden muss,
wo der Fördervertrag steht, was abgerechnet ist.

**Live:** https://lukif96-source.github.io/eag-foerderungen/

## Aufbau
- Statische Web-App ohne Build (`index.html`, `css/`, `js/`), gehostet über GitHub Pages.
- Daten liegen in Supabase (Projekt `iuxklqcpexoziqxrohwa`), geschützt durch Login + Row Level Security.
- **In diesem Repo stehen keine Kundendaten.** Excel-Dateien sind per `.gitignore` ausgeschlossen.

## Einrichtung (einmalig)
1. Supabase → SQL Editor → Inhalt von `sql/setup.sql` einfügen, in der letzten Zeile die eigene
   E-Mail eintragen, ausführen.
2. Supabase → Authentication → URL Configuration → **Site URL** auf
   `https://lukif96-source.github.io/eag-foerderungen/` setzen (für Bestätigungs- und Passwort-Mails).
3. In der App mit derselben E-Mail registrieren → man ist Admin.
4. Oben rechts **Import** → bisherige Excel-Liste auswählen.

## Rollen
| Rolle | darf |
|---|---|
| Admin | alles, Nutzer freischalten, Import, endgültig löschen |
| Bearbeiten | Förderungen anlegen, ändern, in den Papierkorb legen |
| Nur lesen | ansehen und Excel-Export |

Neue Kolleg:innen registrieren sich selbst; sehen aber erst etwas, wenn ein Admin sie unter
**Nutzer** freischaltet.

## Lokal testen
`python -m http.server 8093` im Ordner starten und `http://localhost:8093/?demo` öffnen
(Demo-Modus mit Beispieldaten, ohne Datenbank).
