# Blueprint: EAG-Förderungen auf Weltklasse-Niveau

Stand 01.10.2026. Grundlage sind der Code dieses Repos und des Messtools (`lukif96-source/Messtool`), keine
Annahmen auf der grünen Wiese.

---

## 0. Zuerst die unbequeme Wahrheit

**Der Ticket-Tag ist am 08.10.2026 um 17:00 – in 7 Tagen. Laut SOLPRO ist es der letzte Call, 2027 gibt es keinen.**

Daraus folgt alles andere:

1. **Kein Rewrite. Nicht auf Next.js, nicht auf Prisma, nicht jetzt.** Ein Rewrite eine Woche vor dem einzigen Tag,
   an dem es auf die Sekunde ankommt, ist kein Ehrgeiz, sondern Fahrlässigkeit. Bis 22.10. gilt: Feature-Freeze
   bis auf Fehlerbehebungen und den Status-Tracker (klein, getestet, siehe Abschnitt 4).
2. **Das Tool ist besser, als der Prompt glaubt.** Es hat bereits, was 99 % der Behörden-Tools nicht haben:
   - Regeln an **einer** Stelle (`js/ablauf.js`), rein, ohne DOM, ohne DB, mit `node --test` in CI.
   - Status wird **berechnet, nie gespeichert** – es kann keinen Status geben, der den Daten widerspricht.
   - Fristen werden berechnet, unbekannte Fristen stehen **rot ganz oben** mit dem frühestmöglichen Datum.
   - RLS in Postgres statt Rechteprüfung im Browser, Verlauf per Trigger.
3. **Nach dem Call ändert sich die Aufgabe.** Ab 23.10. gibt es keine Ticket-Jagd mehr, sondern ~18 Monate
   Abwicklung: Verträge, Inbetriebnahme-Fristen (6/12 Monate), Endabrechnung. Das Tool muss vom
   „Sprint-Werkzeug“ zum **Fristen- und Beleg-Werkzeug** werden. Genau dort zahlt sich Revisionssicherheit aus.

Die Reihenfolge ist deshalb: **jetzt** Tracker (erledigt) → **nach dem Call** Revisions-Protokoll und Belege →
**danach** Messtool-Brücke → **erst beim zweiten echten Förderprogramm** die Modul-Engine.

---

## 1. UI/UX: dicht, ruhig, tastaturtauglich

### 1.1 Die Designregel, die schon im Haus existiert

Das Messtool hat sie bereits formuliert (`css/pro.css`):

> Neutrale Grautöne, feine 1px-Linien, eine Schrift (Inter), keine Verläufe, kein Leuchten.
> **Farbe trägt nur Bedeutung**: Grün = fertig, Orange = offen, Rot = Fehler.

Das Förder-Tool verstößt dagegen: Jede Phase hat eine eigene Farbe (`--blau`, `--violett`, `--tuerkis`, `--amber`,
`--braun`). Das ist Dekoration – der Nutzer muss lernen, dass Türkis „Zusage“ heißt, und Amber kollidiert mit
„Achtung“. **Das ist der eigentliche „Kindergarten“-Anteil.** Konsequenz:

| Heute | Ziel |
|---|---|
| 5 Phasenfarben | Phase = **Position + Beschriftung**, nie Farbe |
| Amber für Abrechnung *und* für Warnungen | Amber **nur** für „bald fällig“ |
| Grün als Markenfarbe und als „erledigt“ | Marke nur im Logo, Grün nur für „erledigt“ |
| Eigene Token-Namen (`--gruen`, `--linie`) | Token aus Messtool übernehmen (`--ink`, `--line`, `--ok`, `--warn`, `--krit`) |

Der neue Status-Tracker hält sich bereits an diese Regel.

### 1.2 Informationsarchitektur: drei Ebenen, nicht mehr

```
┌ Eingang ───────────────────────────────────────────────────────────────┐
│  Zu tun (nach Frist sortiert) · Warten · Fertig · Beendet              │  ← existiert (Reiter)
│  Eine Zeile = Kunde · Ort · kWp · Frist · EIN Knopf für den nächsten   │
│  Schritt. Keine Diagramme. Zahlen nur, wo man danach filtert.          │
├ Akte (Drawer von rechts, Liste bleibt sichtbar) ───────────────────────┤
│  [Status-Tracker: 5 Phasen, 12 Striche]                                │  ← NEU
│  Als Nächstes · Schritt 3 von 12 · Wir sind dran      [✓ Ticket gez.]  │
│  Frist: 08.10.2026 · noch 7 Tage                                       │
│  ─────────────────────────────────────────────────────────────────────  │
│  Ablauf (links, sticky)   │  Kunde · Anlage · Förderung · Belege       │
│                           │  Verlauf (Revisionsprotokoll)              │
├ Ticket-Tag-Modus (nur am Calltag) ─────────────────────────────────────┤
│  Je Zieher eine Spalte. Je Ticket eine Karte mit Kopier-Knöpfen.       │  ← nächster Schritt
└────────────────────────────────────────────────────────────────────────┘
```

**Kein Dashboard mit Kacheln.** Ein Bento-Grid aus KPIs ist für Leute, die nichts tun müssen. Wer hier arbeitet,
braucht die Frage „Was ist als Nächstes dran, und bis wann?“ – das ist eine sortierte Liste, keine Grafik.

### 1.3 Pattern-Entscheidungen

| Pattern | Entscheidung | Warum |
|---|---|---|
| **Side-Drawer statt Modal** | Ja – existiert schon (`.panel` von rechts) | Kontext bleibt sichtbar; nächste Akte mit `j`/`k` ohne Schließen |
| **Inline-Editing** | Ja für Schritt-Daten (existiert), Nein für Stammdaten in der Liste | Stammdaten haben Prüfungen (Zählpunkt, kWp → Kategorie); die gehören in die Akte |
| **Optimistisch + Rückgängig** | Statt „Wirklich?“-Dialogen: sofort speichern, 8 s „Rückgängig“ im Toast | Ein Klick pro Schritt; Fehler kosten nichts. Ausnahme: Löschen, Ablehnen |
| **Command-K** | Ja – aber als Suche + Aktion, nicht als Spielerei | „Huber“ → Akte; „Huber vertrag“ → Datum setzen; „> export“ → Excel |
| **Skeleton-Loader** | Nur für die Liste beim ersten Laden; danach Cache + stilles Nachladen | Die Daten sind < 1 MB – Laden sollte man gar nicht sehen |
| **Realtime-Präsenz** | Am Ticket-Tag: „Verena bearbeitet gerade“ | Supabase Realtime ist schon im Stack; verhindert Doppel-Einreichungen |
| **Kopier-Knöpfe** | **Höchste Priorität nach dem Tracker** | Siehe 1.4 |

### 1.4 Der echte Engpass ist nicht unser UI – es ist das EAG-Portal

Am Ticket-Tag tippt niemand in *unser* Tool. Die Zieher kopieren Daten in das Portal der Förderstelle, und dort
zählt die Sekunde. Der größte UX-Gewinn ist deshalb **eine Karte je Ticket mit Kopier-Knöpfen in Portal-Reihenfolge** (Reihenfolge vorher mit den Ziehern am echten Portal abgleichen):

```
┌ Muster Max · 9,9 kWp · Kat. A ─────────────────────── Zieher: Verena ┐
│ Zählpunkt   AT0030000000000000000000000000123        [Kopieren ⌘1] │
│ Adresse     Weg 1, 4810 Gmunden                       [Kopieren ⌘2] │
│ kWp         9,90                                       [Kopieren ⌘3] │
│ Speicher    18 kWh  ✓ förderfähig                     [Kopieren ⌘4] │
│ Projekt     FPJ-12345                                 [Kopieren ⌘5] │
│                                        [✓ Ticket gezogen  17:00:04] │
└──────────────────────────────────────────────────────────────────────┘
```

Ziffern-Kürzel kopieren in Portal-Reihenfolge, der Knopf „Ticket gezogen“ speichert **Datum und Uhrzeit** (die
Sekunde ist bei Kat. A/B der Beweis). Das ist ein halber Tag Arbeit und spart am 08.10. pro Ticket Sekunden –
dort, wo sie Geld wert sind.

### 1.5 Tastatur

| Taste | Wirkung | Wo |
|---|---|---|
| `⌘K` / `Strg K` | Befehlspalette | überall |
| `/` | Suche fokussieren | Liste |
| `j` / `k` | nächste / vorige Förderung | Liste und offene Akte |
| `Enter` | Akte öffnen | Liste |
| `e` | nächsten Schritt mit heutigem Datum erledigen (mit Rückgängig) | Liste, Akte |
| `Esc` | Akte schließen | Akte |
| `1`–`5` | Feld kopieren | Ticket-Tag-Karte |
| `?` | Übersicht der Tasten | überall |

Regel: Jede Taste hat einen sichtbaren Knopf daneben. Tastatur ist Beschleuniger, nie der einzige Weg.

### 1.6 Micro-Interactions mit Zweck

- Der „jetzt dran“-Strich im Tracker pulsiert leise (aus bei `prefers-reduced-motion`).
- Beim Erledigen rückt der Strich nach rechts, bevor die Zeile in die nächste Gruppe wandert – der Nutzer sieht,
  *wohin* sein Klick die Förderung bewegt hat.
- Keine Konfetti, keine Hüpfer, keine Glow-Effekte. Bewegung erklärt Zustandswechsel, sonst nichts.

---

## 2. Architektur der Wahrheit

### 2.1 Die Zustandsmaschine existiert schon – als Ableitung, nicht als Spalte

```mermaid
stateDiagram-v2
  [*] --> Daten
  Daten --> Projekt: Pflichtfelder vollständig (auto)
  Projekt --> Ticket: Projekt im Portal angelegt
  Ticket --> Eingereicht: am Calltag ab 17:00
  Eingereicht --> Nachforderung: Förderstelle fordert nach
  Nachforderung --> Eingereicht: binnen 4 Wochen nachgereicht
  Eingereicht --> Vertrag: Fördervertrag (MIT Datum)
  Vertrag --> Versendet
  Versendet --> InBetrieb: ≤ 6 Monate ab Vertrag (> 100 kWp: 12)
  InBetrieb --> EControl
  EControl --> Rechnung --> Zahlung --> Endabrechnung: ≤ 6 Monate nach IBN-Frist
  Endabrechnung --> Ausgezahlt
  Ausgezahlt --> [*]
  Eingereicht --> Abgelehnt
  Abgelehnt --> Ticket: Neu ansuchen (solange ein Call offen ist)
  Vertrag --> Erloschen: Frist verpasst
```

`status()` in `js/ablauf.js` leitet den Zustand aus den Schritt-Daten ab. **Das ist richtig und soll so bleiben.**
Eine `status`-Spalte wäre eine zweite Wahrheit, die irgendwann der ersten widerspricht.

Was fehlt, ist nicht die Maschine, sondern:

1. **Serverseitiger Beweis**, wer wann welchen Schritt gesetzt hat – unveränderbar.
2. **Belege** zu Schritten (Vertrag, Rechnung, Zahlungsnachweis, Fertigstellungsmeldung) mit Fingerabdruck.
3. **Verpasste Fristen** als Ereignis, nicht nur als rote Zeile, die verschwindet, sobald jemand ein Datum einträgt.

### 2.2 Warum nicht Prisma

Prisma verbindet sich mit einem Datenbank-Benutzer, der **Row Level Security umgeht**. Heute schützt RLS jede
Zeile direkt in Postgres – egal, ob der Zugriff aus dem Browser, einer Edge Function oder einem Excel-Import kommt.
Mit Prisma läge die Rechteprüfung wieder in Anwendungscode, den man vergessen kann. Für dieses Tool ist Prisma
ein Rückschritt. Wenn je ein Server dazukommt: Supabase-Client mit dem JWT des Nutzers, nicht mit dem Service-Key.

### 2.3 Revisionssicher: `sql/vorschlag-revision.sql`

Fertig, lokal gegen Postgres 16 getestet, **noch nicht** in Supabase eingespielt (bitte erst nach dem 22.10.):

| Baustein | Umsetzung |
|---|---|
| Nur anhängen | `foerder_ereignisse`: Trigger lehnt `UPDATE`, `DELETE`, `TRUNCATE` ab – auch für Superuser; `authenticated` hat nur `SELECT` |
| Einzelne Schritte | Trigger zerlegt den `schritte`-Diff: `schritt_gesetzt ticket "2026-10-08"`, `schritt_entfernt projekt` |
| Manipulationsnachweis | SHA-256-Kette je Förderung (`vorher_hash` → `hash`), `foerder_kette_pruefen(id)` liefert das erste falsche Ereignis |
| Serverzeit | `clock_timestamp()` im Trigger – die Uhr des Browsers zählt nicht |
| Löschen | Ereignisse ohne Fremdschlüssel: endgültiges Löschen einer Förderung hinterlässt `endgueltig_geloescht` |
| Belege | `foerder_dateien` mit `sha256`, `groesse`, `ersetzt` (neue Version statt Überschreiben), Storage-Bucket privat |
| Verpasste Fristen | eindeutiger Index `(foerderung_id, frist, datum)` – ein täglicher Lauf darf beliebig oft laufen |

Getestete Fälle: Ereignisse werden je Feld/Schritt verkettet geschrieben; `UPDATE`/`DELETE` als Nutzer →
`permission denied`; als Superuser → Trigger blockt; Trigger absichtlich ausgeschaltet und ein Ticket-Datum
verfälscht → `foerder_kette_pruefen` meldet genau dieses Ereignis.

**Drei Dinge, die die Kette allein nicht leistet:**

1. **Externer Anker.** Wer Superuser ist, kann die ganze Kette neu rechnen. Abhilfe: täglich den letzten Hash je
   Förderung (oder einen Hash über alle) aus dem Haus schreiben – z. B. per Mail an ein Archivpostfach oder als
   Commit in ein privates Repo. Erst dann ist „unverändert seit Tag X“ beweisbar.
2. **Verpasste Fristen brauchen einen Lauf.** Die Fristregeln stehen in `js/ablauf.js` und sollen dort bleiben.
   Daher: eine Edge Function, die genau diese Datei lädt (sie läuft ohne DOM), `fristen()` für alle Förderungen
   rechnet und `frist_verpasst` einträgt; ausgelöst täglich per `pg_cron` + `pg_net` (beides gibt es in Supabase).
   **Keine** zweite Kopie der Regeln in SQL.
3. **DSGVO gegen Aufbewahrungspflicht.** Ein unlöschbares Protokoll enthält Kundendaten (Name, Adresse,
   Zählpunkt in den Feld-Diffs). Das ist vertretbar, solange eine gesetzliche Aufbewahrungspflicht besteht (BAO,
   Förderrichtlinien) – aber das muss **SOLPRO entscheiden**, nicht der Code. Vorschlag zur Klärung: Aufbewahrung
   bis Ende der Prüfpflicht der Förderstelle, danach Ereignisse pseudonymisieren (Hash bleibt, Klartext geht).

**Hinweis:** „Rechtssicher“ heißt hier: lückenloser, manipulationserkennbarer Nachweis. Ob das für ein konkretes
Verfahren genügt, beurteilt nicht die Software.

---

## 3. Messtool-Integration

### 3.1 Was die Repos tatsächlich sagen

| | Förder-Tool | Messtool |
|---|---|---|
| Stack | statisch, Vanilla JS, GitHub Pages | statisch, Vanilla JS, GitHub Pages, PWA |
| Supabase-Projekt | `iuxklqcpexoziqxrohwa` | `rcuimtfmjkpxkazbsggj` (**anderes Projekt**) |
| Regeln | `js/ablauf.js`, `node --test` | `js/logik.js`, `node --test` |
| Design | eigene Farben je Phase | `pro.css`: Linear/Stripe-Stil, Token, Hell/Dunkel |
| Projektschlüssel | `foerderungen.projekt_nr` | `pv_projects.config._stamm.nr` (z. B. `P260188`) |
| Inbetriebnahme | Schritt `inbetriebnahme` (Datum) | DC-Strangmessung, Abnahme mit Unterschrift, `locked_at` |

Die Architekturen sind schon Geschwister. Das ist ein Vorteil: **Integration heißt hier Absprachen und eine
schmale Brücke, keine Plattform.**

### 3.2 Was fachlich fließen soll

**Messtool → Förder-Tool** (das ist der Wert):

- **Abnahme unterschrieben** (`locked_at`, Abnahme-Signatur) → Vorschlag für Schritt *In Betrieb genommen* mit
  Datum und Link zum Protokoll. Vorschlag, kein Automatismus: Förderrechtlich zählt die Fertigstellungsmeldung an
  den Netzbetreiber, nicht unsere Messung.
- **Gemessene kWp** (Module × Wp) gegen **beantragte kWp**. Weicht die gebaute Leistung ab, kann sich der
  Zuschuss bei der Endabrechnung ändern (genaue Regel in den Förderbedingungen des Calls prüfen). Das gehört als Warnung in die Akte, **bevor** die Endabrechnung rausgeht.
- **Messprotokoll-PDF** als Beleg (`foerder_dateien.art = 'messprotokoll'`).

**Förder-Tool → Messtool:**

- Inbetriebnahme-Frist im Projektkopf des Messtools („IBN-Frist 14.04.2027 · noch 195 Tage“). Der Monteur auf
  der Baustelle sieht so, ob es eilt.

### 3.3 Technisch

1. **Schlüssel festziehen:** Projektnummer in beiden Tools gleich schreiben (Format `P` + 6 Ziffern) und im
   Förder-Tool prüfen wie den Zählpunkt. Ohne sauberen Schlüssel ist jede Integration Rätselraten.
2. **Keine gemeinsame Datenbank, keine Secrets im Browser.** Im Messtool-Projekt eine Edge Function
   `messtool-stand` (liest mit Service-Key, gibt nur `nr`, `abnahme_am`, `kwp_gemessen`, `protokoll_pfad` zurück).
   Das Förder-Tool ruft sie aus *seiner* Edge Function auf (Secret liegt in den Supabase-Secrets), nie direkt
   aus dem Browser.
3. **Kein Live-Kopplungszwang:** Fällt das Messtool aus, zeigt die Akte „Messtool nicht erreichbar“ – sonst nichts.
4. **Optisch eins:** `pro.css`-Token (Farben, Radien, Schrift, Hell/Dunkel) in eine gemeinsame Datei
   `solpro-tokens.css` ziehen, beide Tools binden sie ein. Dazu ein gleicher Kopf mit App-Umschalter
   (Messtool ⇄ Förderungen) und Deep-Links: `…/eag-foerderungen/?projekt=P260188` öffnet die Akte,
   `…/Messtool/?projekt=P260188` das Messprojekt.

### 3.4 Weitere Förderungen (AWS, FFG, EU, Land Salzburg)

Die Spalte `programm` gibt es schon (`EAG`, `Land Salzburg`). Der Weg zur Engine ist kurz, weil `ablauf.js` schon
fast datengetrieben ist. Zielbild:

```ts
// Eine Datei je Programm: programme/eag.js, programme/aws.js …
interface Programm {
  key: string;                        // 'EAG'
  phasen: { key: string; label: string }[];
  schritte: { key: string; phase: string; label: string; todo: string; knopf: string;
              auto?: boolean; warten?: boolean; hilfe?: string }[];
  ende: { key: string; label: string }[];
  pflicht: [feld: string, label: string][];
  // Fristen bleiben Code – sie sind zu unterschiedlich für eine Konfig-Sprache
  fristen(f: Foerderung, heute: string): Frist[];
  zuschuss?(f: Foerderung): Schaetzung | null;
}
```

`status()`, `aufgabe()`, `tracker()` werden generisch und bekommen das Programm übergeben; die Oberfläche kennt
nur noch `tracker()`. Programmspezifische Felder kommen in eine `daten jsonb`-Spalte mit Schema je Programm.

**Aber:** Diese Engine erst bauen, wenn das **zweite** Programm wirklich ansteht. Eine Abstraktion aus einem
einzigen Beispiel rät die Form des zweiten – und rät falsch. Bis dahin ist die beste Vorbereitung, dass
`tracker()` schon heute die einzige Schnittstelle zwischen Regeln und Oberfläche ist.

---

## 4. Schonungslose Kritik

### 4.1 Wo 99 % der Behörden-Tools scheitern

1. **Sie bauen das Formular der Behörde nach, statt die Arbeit des Nutzers.** Die Arbeit ist: „Was muss ich heute
   tun, für wen, bis wann?“ Das Formular ist nur ein Schritt davon.
2. **Sie speichern den Status als Spalte.** Nach drei Monaten steht „Genehmigt“ neben einem fehlenden Vertragsdatum.
3. **Sie modellieren den Happy Path.** Nachforderung, Ablehnung, Neu ansuchen, Fristverlängerung, Zusage erloschen
   – genau dort entsteht der Schaden. (Dieses Tool hat sie. Weiter so.)
4. **Fristen ohne Datum werden still.** Ein fehlendes Vertragsdatum ist der gefährlichste Zustand, weil keine
   Frist läuft, die warnen könnte. (Hier: rot ganz oben. Richtig.)
5. **Rechte im Frontend.** Ein ausgeblendeter Knopf ist keine Berechtigung. (Hier: RLS. Richtig.)
6. **Design als Lackierung.** Glow, Verläufe, Bento-Kacheln – und dann dauert „Ticket gezogen“ drei Klicks und
   einen Bestätigungsdialog.
7. **Rewrite statt Ausbau.** Das Framework wird gewechselt, die Regeln gehen dabei verloren, die Tests auch.
8. **Kein Test gegen echte Daten.** Der Excel-Import mit orange-roten Zeilen ist die Realität, nicht der Demo-Datensatz.

### 4.2 Was an *diesem* Tool noch schwach ist

- **Phasenfarben** (siehe 1.1) – Dekoration statt Bedeutung.
- **Keine Belege.** Für die Endabrechnung muss man Rechnung und Zahlungsnachweis haben; das Tool weiß nur „✓“.
- **„✓“ ohne Datum** ist erlaubt. Für alte Daten nötig, für neue sollte das Datum Pflicht sein – vor allem beim
  Fördervertrag, an dem alle Fristen hängen.
- **Ticket mit Uhrzeit fehlt.** Bei Kategorie A/B entscheidet die Sekunde; gespeichert wird nur der Tag.
- **`app.js` hat 1.500 Zeilen.** Noch handhabbar, aber Detail-Ansicht, Liste und Dialoge sollten nach dem Call in
  eigene Dateien.

### 4.3 Der Code: Status-Tracker

**Umgesetzt im echten Tool** (nicht als Beispiel daneben):

- `js/ablauf.js` → `tracker(f, heute)`: ein reines Objekt mit Phasen, Strichen je Schritt, nächster Aktion,
  wer dran ist (`wir` / `foerderstelle`), dringendster Frist und Ton (`ruhig` / `achtung` / `alarm`).
  5 neue Tests in `tests/ablauf.test.js`.
- `js/app.js` → `trackerLeiste()` oben im Kasten „Als Nächstes“ der Akte.
- `css/app.css` → Regeln `.tr-*`: Grün = erledigt, Rahmen = jetzt dran, schraffiert = Förderstelle ist dran,
  Rot = übersprungen. Mobil: nur die aktive Phase beschriftet.

Weil die Regeln in `tracker()` stecken und nicht im HTML, ist dieselbe Komponente in React eine reine
Darstellungsfrage. Falls das Tool (oder ein Kundenportal) je auf React/Next.js geht, sieht sie so aus –
Tailwind, Framer Motion, ohne eigene Logik:

```tsx
// StatusTracker.tsx – Darstellung für tracker() aus js/ablauf.js. Keine eigene Fachlogik.
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Clock, Hourglass } from 'lucide-react';

type SchrittZustand = 'fertig' | 'jetzt' | 'wartet' | 'luecke' | 'offen';
type PhasenZustand = 'fertig' | 'aktiv' | 'offen' | 'luecke' | 'gestoppt';
type Frist = { label: string; datum: string | null; tage: number | null;
               stufe: 'unbekannt' | 'ueberfaellig' | 'dringend' | 'bald' | 'ruhig'; hinweis: string };
export type Tracker = {
  zustand: 'aktiv' | 'wartet' | 'fertig' | 'beendet';
  ton: 'ruhig' | 'achtung' | 'alarm';
  nummer: number | null; gesamt: number; erledigt: number;
  phasen: { key: string; label: string; fertig: number; gesamt: number; zustand: PhasenZustand;
            schritte: { key: string; label: string; wert: string; zustand: SchrittZustand }[] }[];
  aktion: { key: string; todo: string; knopf: string; wer: 'wir' | 'foerderstelle';
            auto: boolean; neben: boolean; hilfe: string } | null;
  frist: Frist | null;
  ende: { label: string; datum: string | null } | null;
};

const strich: Record<SchrittZustand, string> = {
  fertig: 'bg-emerald-600',
  jetzt: 'bg-white ring-[1.5px] ring-inset ring-zinc-900',
  wartet: 'bg-[repeating-linear-gradient(-45deg,theme(colors.zinc.400)_0_2px,transparent_2px_5px)]',
  luecke: 'bg-red-600',
  offen: 'bg-zinc-900/10',
};
const kasten = { ruhig: 'border-zinc-200 bg-white', achtung: 'border-amber-300 bg-amber-50/60',
                 alarm: 'border-red-300 bg-red-50/70' };
const datumDE = (d: string) => d.split('-').reverse().join('.');

function FristText({ f }: { f: Frist }) {
  const rest = f.tage === null ? f.hinweis
    : f.tage < 0 ? `${-f.tage} Tage überfällig` : f.tage === 0 ? 'heute' : `noch ${f.tage} Tage`;
  const farbe = f.stufe === 'ruhig' ? 'text-zinc-500' : f.stufe === 'bald' ? 'text-amber-700' : 'text-red-700';
  return (
    <p className={`mt-2 flex items-center gap-1.5 text-[13px] font-medium tabular-nums ${farbe}`}>
      <Clock className="size-3.5" aria-hidden />
      {f.label}: {f.datum ? datumDE(f.datum) : 'unbekannt'} · {rest}
    </p>
  );
}

export function StatusTracker({ t, onErledigt, nurLesen = false }:
  { t: Tracker; onErledigt?: (schritt: string) => void; nurLesen?: boolean }) {
  const ruhig = useReducedMotion();
  return (
    <section className={`rounded-xl border p-4 ${kasten[t.ton]}`}
             aria-label={`${t.erledigt} von ${t.gesamt} Schritten erledigt`}>
      <div className="flex gap-2.5 border-b border-zinc-900/[.08] pb-3">
        {t.phasen.map(p => (
          <div key={p.key} className="grid min-w-0 gap-1.5" style={{ flex: p.gesamt }}>
            <div className={`flex justify-between gap-1 text-[11px] font-semibold uppercase tracking-wider
              ${p.zustand === 'aktiv' || p.zustand === 'luecke' ? 'text-zinc-900'
                : p.zustand === 'fertig' ? 'text-emerald-700' : 'text-zinc-400'}`}>
              <span className="truncate">{p.label}</span>
              <span className="tabular-nums tracking-normal">{p.fertig}/{p.gesamt}</span>
            </div>
            <div className="flex gap-[3px]">
              {p.schritte.map(s => (
                <motion.i key={s.key} layout title={s.label}
                  className={`h-1.5 flex-1 rounded-full ${strich[s.zustand]}`}
                  animate={s.zustand === 'jetzt' && !ruhig ? { opacity: [1, 0.45, 1] } : { opacity: 1 }}
                  transition={s.zustand === 'jetzt' ? { duration: 1.6, repeat: Infinity } : { duration: 0.2 }} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          {t.aktion ? (
            <>
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-zinc-500">
                {t.aktion.wer === 'foerderstelle' && <Hourglass className="size-3.5" aria-hidden />}
                Als Nächstes · {t.aktion.neben ? 'Nebenschritt' : `Schritt ${t.nummer} von ${t.gesamt}`}
                {' · '}{t.aktion.wer === 'wir' ? 'Wir sind dran' : 'Förderstelle ist dran'}
              </p>
              <h3 className="mt-0.5 text-lg font-semibold tracking-tight text-zinc-900">{t.aktion.todo}</h3>
              {t.aktion.hilfe && <p className="text-[13px] text-zinc-500">{t.aktion.hilfe}</p>}
            </>
          ) : (
            <h3 className="text-lg font-semibold tracking-tight text-zinc-900">
              {t.ende ? `${t.ende.label}${t.ende.datum ? ` am ${datumDE(t.ende.datum)}` : ''}` : 'Ausgezahlt – fertig'}
            </h3>
          )}
          {t.frist && <FristText f={t.frist} />}
        </div>

        {t.aktion && !t.aktion.auto && !nurLesen && (
          <motion.button whileTap={{ scale: 0.97 }} onClick={() => onErledigt?.(t.aktion!.key)}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-semibold
                       text-white shadow-sm outline-none transition-colors hover:bg-zinc-800
                       focus-visible:ring-2 focus-visible:ring-zinc-900/30 focus-visible:ring-offset-2">
            <Check className="size-4" aria-hidden /> {t.aktion.knopf}
            <kbd className="ml-1 rounded border border-white/20 px-1.5 text-[11px] font-medium text-white/70">E</kbd>
          </motion.button>
        )}
      </div>
    </section>
  );
}
```

Aufruf: `<StatusTracker t={EAG_ABLAUF.tracker(foerderung)} onErledigt={key => speichern(key, heute())} />`.
Die Regeln bleiben in einer Datei, getestet; die Oberfläche ist austauschbar. Das ist der eigentliche Punkt.

---

## 5. Fahrplan

| Wann | Was |
|---|---|
| **bis 08.10.** | Tracker (fertig, in diesem Branch). Optional: Ticket-Karte mit Kopier-Knöpfen + Uhrzeit beim Ticket |
| **08.–22.10.** | Freeze. Nur Fehler beheben. |
| **ab 23.10.** | `sql/vorschlag-revision.sql` einspielen, Belege-Upload, täglicher Fristen-Lauf, externer Hash-Anker |
| **November** | Design-Token aus Messtool übernehmen, Phasenfarben raus, Command-K + `j`/`k`/`e` |
| **danach** | Messtool-Brücke (Projektnummer, Abnahme, gemessene kWp), gemeinsamer Kopf |
| **beim 2. Programm** | Programm-Engine (3.4) |
