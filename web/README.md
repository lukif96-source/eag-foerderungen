# EAG-Timeline-Dashboard (`web/`)

Das neue Dashboard für alle Förderungen: oben die **Fristen-Zeitachse** (was wird wann eng – über alle
Förderungen, in Spuren nach Art der Frist), darunter die **Liste nach Zustand** in Ablauf-Reihenfolge, rechts die
**Akte** als Seitenschublade. Es liest das Datenmodell v2 (Schema `eag`) – die bestehende App bleibt, wie sie ist.

**Ansehen ohne Datenbank:** `…/?demo` – rund 35 erfundene Förderungen in allen Zuständen, relativ zu heute.

| Taste | |
|---|---|
| `J` / `K` | nächste / vorige Förderung |
| `↵` | Akte öffnen (`J`/`K` wechseln dann in der Akte weiter) |
| `E` | nächsten Schritt heute erledigen – mit **Rückgängig** (`⌘Z`, 8 Sekunden) |
| `X` | auswählen → Leiste unten: mehrere erledigen, CSV |
| `/` | filtern · `⌘K` Suche und Befehle · `Esc` schließen / Auswahl aufheben |

Was die Datenbank ablehnen würde, bietet das Dashboard gar nicht erst an (z. B. „Ticket gezogen“ vor dem Calltag –
der Knopf ist gesperrt und sagt warum). Die Regeln kommen aus derselben Datei wie in der App:
`lib/regeln/ablauf.js` ist eine Kopie von `js/ablauf.js`; ein Test prüft, dass beide gleich sind.

## Voraussetzungen in Supabase
`sql/v2/eag.sql` eingespielt, `select * from eag.migrieren();` gelaufen, Schema `eag` unter
*Project Settings → API → Exposed schemas* eingetragen – siehe [docs/EINSPIELEN.md](../docs/EINSPIELEN.md), Teil C.
Anmelden wie in der App (dasselbe Konto, dieselben Rollen; „vertrieb“ sieht nur eigene Kunden).

## Entwickeln
```bash
cd web
npm ci
npm run dev          # http://localhost:3000/?demo
npm run build        # statischer Export nach web/out
```

## Veröffentlichen
Der Build ist rein statisch (`out/`), läuft also überall:
- **Vercel / Netlify:** Projekt aus diesem Repo anlegen, *Root Directory* = `web`, Build `npm run build`,
  Ausgabe `out`.
- **Unterordner, z. B. GitHub Pages** `…/eag-foerderungen/dashboard/`:
  `NEXT_BASE_PATH=/eag-foerderungen/dashboard npm run build` und `out/` nach `dashboard/` legen.

Verbindung: `lib/config.ts` (Projekt-URL und *publishable* Key – dürfen öffentlich sein, geschützt wird über
Login + Row Level Security). Nie das Datenbank-Passwort oder einen `secret`/`service_role`-Schlüssel eintragen.

## Aufbau
| Datei | |
|---|---|
| `components/app.tsx` | Arbeitsfläche: Kennzahlen, Ansichten, Tastatur, Erledigen mit Rückgängig |
| `components/radar.tsx` | Fristen-Zeitachse (30/90/180 Tage, Klick filtert die Liste) |
| `components/pipeline.tsx` | Liste nach Zustand; vor dem Ticket der Zählpunkt ohne „AT“ zum Kopieren |
| `components/akte.tsx` | Seitenschublade: Tracker, nächster Schritt, Fristen, Kennungen, Protokoll |
| `components/befehle.tsx` · `aktionsleiste.tsx` · `toast.tsx` · `fehlergrenze.tsx` | ⌘K, Massenaktionen, Meldungen, Fehlergrenzen je Bereich |
| `lib/daten.ts` | Supabase (Sichten `eag.antrag_stand`, `eag.frist_offen`, RPC `eag.schritt_setzen`) und Demo |
| `lib/hooks.ts` | TanStack Query: Laden, optimistisches Erledigen mit Zurückrollen bei Fehler |
| `lib/meta.ts` | Beschriftungen der Zustände, Sperrgründe (`sperre`) |
