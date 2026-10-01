# Datenbank einspielen (Supabase-Projekt `iuxklqcpexoziqxrohwa`)

Zwei Wege – beide führen zum selben Ergebnis.

## Weg 1: Claude macht es (Connector)

1. https://claude.ai/customize/connectors → **Supabase** trennen und neu verbinden.
2. Auf der Supabase-Freigabeseite die Organisation wählen, in der das Projekt „Auslastungstool“ liegt.
3. Neue Claude-Session starten und schreiben: *„Spiel docs/EINSPIELEN.md auf Branch claude/festive-meitner-cibd76 ein.“*

## Weg 2: selbst im Dashboard (ca. 5 Minuten)

Dashboard: https://supabase.com/dashboard/project/iuxklqcpexoziqxrohwa

### A. Tägliche Sicherung (zuerst – unabhängig von allem anderen)

1. **Cron einschalten:** *Integrations* → **Cron** → *Enable* (falls noch nicht an).
2. **SQL:** *SQL Editor* → *New query* → Inhalt von [`sql/archiv.sql`](../sql/archiv.sql) einfügen → **Run**.
   Am Ende erscheint das heutige Datum: Die erste Sicherung ist angelegt.
3. **Edge Function:** *Edge Functions* → *Deploy a new function* → *Via Editor*
   - Name: `foerder-taeglich`
   - Datei `index.ts`: Inhalt von [`supabase/functions/foerder-taeglich/index.ts`](../supabase/functions/foerder-taeglich/index.ts)
   - zweite Datei anlegen, Name `ablauf.js`: Inhalt von [`js/ablauf.js`](../js/ablauf.js)
   - **Deploy**, danach in den Function-Einstellungen **„Verify JWT“ ausschalten** (die Funktion nimmt keine Daten an,
     jeder Aufruf ist wiederholbar – wie bei `foerder-registrierung`).
4. **Secrets** (*Edge Functions* → *Secrets*): `RESEND_API_KEY` ist schon da (Registrierungs-Mail). Optional:
   - `ARCHIV_MAIL` – Empfänger statt der Admins, mit Komma, z. B. ein Archiv-Postfach
   - `ARCHIV_ANHANG=nein` – Mail nur mit Prüfsumme, ohne Kundendaten im Anhang
5. **Testen:** In der App ☰ → **Sicherungen** – die heutige Sicherung steht dort. Die Funktion einmal von Hand
   starten: *Edge Functions* → `foerder-taeglich` → *Test* (leerer Body). Danach stehen bei der heutigen Sicherung
   „Datei ✓ · Mail ✓“ und die Mail ist im Postfach.

Ab dann läuft alles jede Nacht um 02:15 (Sommerzeit 03:15).

> **Hinweis zur Mail:** Mit dem Absender `onboarding@resend.dev` stellt Resend nur an die E-Mail-Adresse des
> Resend-Kontos zu. Für andere Empfänger in Resend die Domain `solpro.at` bestätigen und `MAIL_ABSENDER` setzen,
> z. B. `EAG-Förderungen <foerderungen@solpro.at>`.

### A2. OeMAG-Mails (sofort sinnvoll – „Mail einfügen“ geht ohne weitere Einrichtung)

*SQL Editor* → Inhalt von [`sql/oemag.sql`](../sql/oemag.sql) → **Run**. Abholen aus dem Postfach:
[`docs/OEMAG-MAILS.md`](OEMAG-MAILS.md) (einmalig M365-Admin).

### B. Revisionssicheres Protokoll (nach dem Call, ab 23.10.)

*SQL Editor* → Inhalt von [`sql/vorschlag-revision.sql`](../sql/vorschlag-revision.sql) → **Run**.
Danach protokolliert die nächtliche Funktion auch überfällige Fristen.

### C. Datenmodell v2 (Schema `eag`) – läuft neben der App, ändert nichts an ihr

1. *SQL Editor* → Inhalt von [`sql/v2/eag.sql`](../sql/v2/eag.sql) → **Run**.
2. Einmal übernehmen: `select * from eag.migrieren();` → „übernommen“ = Anzahl der Förderungen, „fehler“ = 0.
   Ab dann spiegelt ein Trigger jede Änderung sofort. Fehler beim Spiegeln stehen in `eag.sync_fehler` und
   **brechen das Speichern in der App nie ab**.
3. Für das neue Dashboard ([`web/`](../web/README.md)): *Project Settings* → *API* → **Exposed schemas** → `eag` hinzufügen.
4. Neue Rolle **„vertrieb“** (Nutzer & Rollen): sieht nur Kunden, bei denen er als Mitarbeiter eingetragen ist.

Was v2 abbildet: Kunde → Projekt (Anlage, Brücke zum Messtool über die Projektnummer) → Antrag (je Call ein
Versuch; Neu ansuchen = neuer Antrag mit Vorgänger) → Schritte aus unveränderlichen Ereignissen (SHA-256-Kette),
Belege, Fristen. Der Status wird berechnet (Enum `eag.status`), nie gespeichert; Schreiben über
`eag.schritt_setzen` prüft die Reihenfolge (Ticket nur am Calltag, Einreichen nur im Call, keine Lücken …).
Die Fristen in SQL sind dieselben wie in `js/ablauf.js` – `tests/sql/paritaet.js` vergleicht beide bei jedem Push.

### Prüfen

```sql
select tag, anzahl, left(sha256, 12), datei, versendet_am from public.foerder_archiv order by tag desc;
select jobname, schedule, active from cron.job;
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
select * from eag.sync_fehler order by id desc limit 10;               -- v2: sollte leer sein
select status, count(*) from eag.antrag_stand group by 1 order by 2 desc;
```
