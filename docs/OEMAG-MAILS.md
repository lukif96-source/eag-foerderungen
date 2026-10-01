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

### 2. Microsoft 365: Zugriff auf das Postfach (einmalig, M365-Admin)

Die Funktion holt die Mails **selbst** ab – nichts weiterleiten (M365 sperrt automatisches Weiterleiten nach
außen ohnehin meist). Sie bekommt **nur Leserecht** und **nur auf dieses eine Postfach**.

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
   (`oemag@solpro.at` muss dafür ein Postfach oder eine E-Mail-aktivierte Sicherheitsgruppe sein.)
5. Notieren: **Verzeichnis-ID** (Tenant), **Anwendungs-ID** (Client), **Geheimnis**.

### 3. Supabase: Secrets und Funktion

*Edge Functions* → *Secrets*:

| Name | Wert |
|---|---|
| `MS_TENANT_ID` | Verzeichnis-ID |
| `MS_CLIENT_ID` | Anwendungs-ID |
| `MS_CLIENT_SECRET` | Geheimnis |
| `OEMAG_POSTFACH` | `oemag@solpro.at` |
| `OEMAG_ABSENDER` | optional: Absender-Domains, mit Komma. Standard `oemag.at,eag-abwicklungsstelle.at` – **bitte an einer echten Mail prüfen** (Absender im Mailkopf), sonst werden die Mails übersprungen |

*Edge Functions* → *Deploy a new function* → *Via Editor*, Name **`oemag`**, drei Dateien:
`index.ts` aus [`supabase/functions/oemag/index.ts`](../supabase/functions/oemag/index.ts),
`ablauf.js` und `oemag.js` aus [`js/`](../js/). Danach **„Verify JWT“ ausschalten** (der Cron ruft ohne Login).

Der Zeitplan (alle 10 Minuten) kommt aus `sql/oemag.sql`. Testen: *Edge Functions* → `oemag` → *Test* mit Body
`{"abholen": true}` – die Antwort zählt gelesene, übernommene und zu prüfende Mails.

### Alternative: automatisch weiterleiten

Geht auch – ist bei Microsoft 365 aber **nicht einfacher**:
1. M365 sperrt automatisches Weiterleiten nach außen standardmäßig. Der Admin muss es für `oemag@solpro.at`
   erlauben (*Microsoft Defender* → *Richtlinien* → *Antispam* → *Richtlinie für ausgehenden Spam* →
   eigene Richtlinie nur für dieses Postfach, „Automatische Weiterleitung: Ein“).
2. Es braucht einen Eingangsdienst, der aus der Mail einen Webhook macht (z. B. Postmark Inbound). Dort laufen
   dann Kundendaten durch → Vertrag zur Auftragsverarbeitung; am Ticket-Tag können es über 100 Mails sein.
3. Outlook-Regel auf `oemag@solpro.at`: alles von der OeMAG an die Eingangsadresse des Dienstes weiterleiten.

Beim Dienst als Webhook eintragen:
Secret `OEMAG_SCHLUESSEL` (beliebiges langes Passwort) setzen und als Webhook-Adresse
`https://iuxklqcpexoziqxrohwa.supabase.co/functions/v1/oemag?schluessel=<OEMAG_SCHLUESSEL>` eintragen.

---

## Neue Mail-Art beibringen

Kommt eine Mail, die nicht erkannt wird („Nicht erkannt“ im Posteingang), oder ist eine Vorschlags-Art an echten
Mails geprüft: Text (Nummern gern verändert) in `tests/oemag.test.js` als Beispiel aufnehmen, die Regel in
`js/oemag.js` (`ARTEN`, Feld `sicher`) anpassen, Tests laufen lassen, `js/oemag.js` nach
`supabase/functions/oemag/` kopieren.
