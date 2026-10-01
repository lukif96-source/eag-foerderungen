# OeMAG-Mails automatisch auslesen

Die OeMAG schickt zu jedem Schritt eine Mail an `oemag@solpro.at`. Die App liest sie und trägt ein, was drinsteht.

| Mail | Erkannt an | Übernommen |
|---|---|---|
| **Ticket gezogen** | „Ihr Ticket mit der Nummer …“ | Ticketnummer, Schritt *Ticket gezogen* mit Tag **und Uhrzeit** – automatisch |
| **Ablehnung** | „… kann diese leider nicht berücksichtigt werden“ | EAG-Nr., Schritt *Abgelehnt* mit Datum, Grund in der Info – automatisch |
| **Nachforderung zur Endabrechnung** | „Zu Ihrer Endabrechnung … benötigen wir noch weitere Unterlagen“ | EAG-Nr., Nachforderung mit der Frist aus der Mail („bis spätestens …“), geforderte Unterlagen als offene Punkte – automatisch |
| Fördervertrag, Eingangsbestätigung, Nachforderung zum Antrag, Auszahlung, Projekt angelegt | Schlüsselwörter | **Vorschlag** – ein Klick im Posteingang, bis ein echtes Beispiel geprüft ist |

**Zuordnung** zur Förderung: zuerst über die **EAG-Nr.** (EAG00052982), dann FPJ-Nr., dann **Zählpunkt**
(auch mit Leerzeichen geschrieben, mit oder ohne „AT“). Passt nichts oder mehreres, bleibt die Mail im
Posteingang zur Auswahl.

**Sicherheitsregeln:**
- Es wird **nie überschrieben**: Felder nur, wenn leer; Schritte nur, wenn offen. Steht in der App etwas anderes
  als in der Mail (z. B. andere Ticketnummer, anderes Datum), kommt die Mail mit ⚠ in „Zu prüfen“.
- Jede Mail wird genau einmal verarbeitet und bleibt unveränderlich gespeichert (Beleg).
- Im Verlauf der Förderung steht „OeMAG-Mail“ (bzw. „Name (OeMAG-Mail)“, wenn jemand bestätigt hat).

In der App: ☰ → **OeMAG-Posteingang** (oder oben der Hinweis „OeMAG-Mails prüfen“). Dort kann man jede Mail
auch **von Hand einfügen** – das funktioniert sofort, ohne die Einrichtung unten.

---

## Einrichtung

### 1. Datenbank (Supabase → SQL Editor)

Inhalt von [`sql/oemag.sql`](../sql/oemag.sql) ausführen. Danach gibt es das Feld „EAG-Nr.“ in der Akte und
den Posteingang. Ab hier funktioniert **„Mail einfügen“**.

### 2. Funktion bereitstellen (Supabase → Edge Functions)

*Deploy a new function* → *Via Editor*, Name **`oemag`**, vier Dateien aus
[`supabase/functions/oemag/`](../supabase/functions/oemag/): `index.ts`, `webhook.ts`, `ablauf.js`, `oemag.js`.
Danach **„Verify JWT“ ausschalten** (Resend und der Zeitplan rufen ohne Supabase-Login auf; die Funktion prüft
selbst die Signatur bzw. den Schlüssel).

### 3. Weiterleiten über Resend (empfohlen – das Konto gibt es schon für die Registrierungs-Mail)

1. **Resend** → *Receiving* (Empfangen): Die Empfangsadresse des Teams notieren, z. B.
   `oemag@<id>.resend.app` (der Teil vor dem @ ist frei wählbar).
2. **Resend** → *Webhooks* → *Add Webhook*
   - URL: `https://iuxklqcpexoziqxrohwa.supabase.co/functions/v1/oemag`
   - Ereignis: **`email.received`**
   - Danach das **Signing Secret** (`whsec_…`) kopieren.
3. **Supabase** → *Edge Functions* → *Secrets*:
   - `RESEND_WEBHOOK_SECRET` = das Signing Secret
   - `RESEND_API_KEY` ist schon da. Er muss **„Full access“** haben (ein reiner Sende-Schlüssel darf empfangene
     Mails nicht lesen). Meldet die Funktion „braucht Full access“: in Resend einen neuen Schlüssel mit
     Vollzugriff anlegen und hier ersetzen.
4. **Outlook** (Postfach `oemag@solpro.at`) → *Regeln* → neue Regel:
   „Wenn Nachricht eingeht von … OeMAG/EAG-Abwicklungsstelle“ (oder einfach alle Nachrichten) →
   **„Umleiten an“** die Resend-Adresse. *Umleiten* behält Absender und Datum der Originalmail; *Weiterleiten*
   geht auch – das Originaldatum wird dann aus dem Kopf der weitergeleiteten Mail gelesen.
5. **Testen:** eine OeMAG-Mail an die Resend-Adresse weiterleiten → in der App ☰ → *OeMAG-Posteingang*.
   Kommt eine Unzustellbarkeitsmeldung **„550 5.7.520 … does not allow external forwarding“**: Microsoft 365
   sperrt Weiterleiten nach außen. Der Admin erlaubt es nur für dieses Postfach:
   *Microsoft Defender* → *Richtlinien und Regeln* → *Bedrohungsrichtlinien* → *Antispam* →
   *Richtlinie für ausgehenden Spam erstellen* → gilt für `oemag@solpro.at` → *Regeln für automatische
   Weiterleitung*: **Ein**.

Datenschutz: Die Mails laufen dann über Resend (wie heute schon die Registrierungs-Mails). Kosten und Grenzen
für empfangene Mails: im Resend-Tarif prüfen – am Ticket-Tag können es über 100 Mails sein.

### Alternative A: direkt aus dem Postfach lesen (ohne Weiterleitung, einmalig M365-Admin)

Die Funktion holt die Mails selbst ab (alle 10 Minuten, Zeitplan aus `sql/oemag.sql`) – kein Dritter dazwischen,
keine Weiterleitungs-Freigabe nötig. Sie bekommt **nur Leserecht** und **nur auf dieses eine Postfach**.

1. **Entra ID** (portal.azure.com) → *App-Registrierungen* → *Neue Registrierung*
   Name: `EAG-Förderungen OeMAG`, nur dieses Verzeichnis, keine Umleitungs-URI.
2. *API-Berechtigungen* → *Microsoft Graph* → **Anwendungsberechtigungen** → `Mail.Read` → hinzufügen →
   **Administratorzustimmung erteilen**.
3. *Zertifikate & Geheimnisse* → *Neuer geheimer Clientschlüssel* (z. B. 24 Monate) → **Wert** kopieren.
4. **Nur dieses Postfach erlauben** (sonst dürfte die App alle Postfächer lesen) – Exchange Online PowerShell:
   ```powershell
   Connect-ExchangeOnline
   New-ApplicationAccessPolicy -AppId <Anwendungs-ID> -PolicyScopeGroupId oemag@solpro.at `
     -AccessRight RestrictAccess -Description "EAG-Förderungen: nur OeMAG-Postfach"
   Test-ApplicationAccessPolicy -Identity oemag@solpro.at -AppId <Anwendungs-ID>   # → Granted
   Test-ApplicationAccessPolicy -Identity irgendwer@solpro.at -AppId <Anwendungs-ID> # → Denied
   ```
5. Secrets in Supabase: `MS_TENANT_ID` (Verzeichnis-ID), `MS_CLIENT_ID` (Anwendungs-ID),
   `MS_CLIENT_SECRET`, `OEMAG_POSTFACH` = `oemag@solpro.at`, optional `OEMAG_ABSENDER` (Absender-Domains, mit Komma;
   Standard `oemag.at,eag-abwicklungsstelle.at` – **an einer echten Mail prüfen**, sonst wird übersprungen).
6. Testen: *Edge Functions* → `oemag` → *Test* mit Body `{"abholen": true}`.

### Alternative B: anderer Weiterleitungsdienst (z. B. Postmark Inbound)

Secret `OEMAG_SCHLUESSEL` (langes Zufallspasswort) setzen und beim Dienst als Webhook eintragen:
`https://iuxklqcpexoziqxrohwa.supabase.co/functions/v1/oemag?schluessel=<OEMAG_SCHLUESSEL>`
(Postmark verarbeitet eingehende Mails laut Preisliste erst in den bezahlten Tarifen.)

---

## Neue Mail-Art beibringen

Kommt eine Mail, die nicht erkannt wird („Nicht erkannt“ im Posteingang), oder ist eine Vorschlags-Art an echten
Mails geprüft: Text (Nummern gern verändert) in `tests/oemag.test.js` als Beispiel aufnehmen, die Regel in
`js/oemag.js` (`ARTEN`, Feld `sicher`) anpassen, Tests laufen lassen, `js/oemag.js` nach
`supabase/functions/oemag/` kopieren.
