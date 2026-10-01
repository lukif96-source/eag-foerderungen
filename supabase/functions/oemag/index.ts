// OeMAG-Mails automatisch auslesen.
//
// Zwei Wege hinein – derselbe Ablauf danach (lesen → zuordnen → übernehmen, js/oemag.js):
//   1. Abholen (Cron alle 10 Minuten, Body {"abholen": true}): neue Mails aus dem Postfach über Microsoft Graph.
//      Nur Leserecht (Mail.Read), es wird nichts verschoben oder als gelesen markiert.
//      Secrets: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, OEMAG_POSTFACH (z. B. oemag@solpro.at)
//   2. Eingang (POST mit einer Mail): für Weiterleitungsdienste (Postmark Inbound) oder Power Automate.
//      Header x-oemag-schluessel bzw. ?schluessel= muss OEMAG_SCHLUESSEL entsprechen.
//      Body: { betreff, text | html, von, datum, message_id }  oder Postmark-Format (Subject, TextBody, …)
// Optional: OEMAG_ABSENDER = Absender-Domains, mit Komma (Standard: oemag.at,eag-abwicklungsstelle.at)
//
// Jede Mail wird genau einmal verarbeitet (message_id eindeutig). Kennungen und geprüfte Mail-Arten werden
// sofort übernommen (foerder_oemag_anwenden, im Verlauf „OeMAG-Mail“), der Rest steht als Vorschlag im Posteingang.
// Bereitstellen: verify_jwt = false (Cron ohne Login; Eingang mit eigenem Schlüssel).
// ablauf.js und oemag.js sind Kopien aus js/ – ein Test prüft, dass sie gleich sind.
import { createClient } from 'npm:@supabase/supabase-js@2';
import './ablauf.js';
import './oemag.js';

// deno-lint-ignore no-explicit-any
const O = (globalThis as any).EAG_OEMAG;
type Mail = { message_id: string; betreff: string; text: string; html?: string; von: string; datum: string; quelle: 'postfach' | 'eingang' };

const json = (daten: unknown, status = 200) =>
  new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });
const env = (k: string) => (Deno.env.get(k) || '').trim();

async function sha256(text: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const absenderOk = (von: string) => {
  const erlaubt = (env('OEMAG_ABSENDER') || 'oemag.at,eag-abwicklungsstelle.at').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const v = von.toLowerCase();
  return erlaubt.some((d) => v.endsWith('@' + d) || v.endsWith('.' + d));
};

// ---------------------------------------------------------------
// Microsoft Graph: Mails der letzten Tage aus dem Posteingang
// ---------------------------------------------------------------
async function graphMails(seit: string): Promise<Mail[]> {
  const tenant = env('MS_TENANT_ID'), client = env('MS_CLIENT_ID'), geheim = env('MS_CLIENT_SECRET'), postfach = env('OEMAG_POSTFACH');
  if (!tenant || !client || !geheim || !postfach) throw new Error('Microsoft-Zugang nicht eingerichtet (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, OEMAG_POSTFACH)');
  const tok = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client, client_secret: geheim, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' }),
  });
  if (!tok.ok) throw new Error('Microsoft-Anmeldung fehlgeschlagen: ' + (await tok.text()).slice(0, 300));
  const { access_token } = await tok.json();
  const felder = 'id,internetMessageId,subject,receivedDateTime,from,body';
  let url: string | null = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(postfach)}/mailFolders/inbox/messages` +
    `?$select=${felder}&$filter=receivedDateTime ge ${seit}&$orderby=receivedDateTime asc&$top=50`;
  const aus: Mail[] = [];
  for (let seite = 0; url && seite < 20; seite++) {
    const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${access_token}`, Prefer: 'outlook.body-content-type="text"' } });
    if (!r.ok) throw new Error('Postfach lesen fehlgeschlagen: ' + (await r.text()).slice(0, 300));
    const d = await r.json();
    // deno-lint-ignore no-explicit-any
    for (const m of d.value as any[]) {
      aus.push({
        message_id: m.internetMessageId || m.id, betreff: m.subject || '', text: m.body?.content || '',
        von: m.from?.emailAddress?.address || '', datum: m.receivedDateTime, quelle: 'postfach',
      });
    }
    url = d['@odata.nextLink'] || null;
  }
  return aus;
}

// Eingang: allgemeines Format oder Postmark Inbound
// deno-lint-ignore no-explicit-any
function eingangMail(b: any): Mail {
  return {
    message_id: String(b.message_id || b.MessageID || b['Message-Id'] || ''),
    betreff: String(b.betreff || b.Subject || ''),
    text: String(b.text || b.TextBody || ''),
    html: String(b.html || b.HtmlBody || ''),
    von: String(b.von || b.FromFull?.Email || b.From || ''),
    datum: String(b.datum || b.Date || new Date().toISOString()),
    quelle: 'eingang',
  };
}

Deno.serve(async (req) => {
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* leer */ }

  let mails: Mail[];
  if (body.abholen) {
    if (!env('MS_CLIENT_ID')) return json({ abgeholt: 0, hinweis: 'Microsoft-Zugang noch nicht eingerichtet – siehe docs/OEMAG-MAILS.md' });
    // ab der letzten verarbeiteten Mail (1 Tag Überlappung), höchstens 30 Tage zurück
    const { data: letzte } = await sb.from('foerder_posteingang').select('empfangen_am').eq('quelle', 'postfach')
      .order('empfangen_am', { ascending: false }).limit(1);
    const ab = letzte?.[0] ? Date.parse(letzte[0].empfangen_am) - 864e5 : Date.now() - 30 * 864e5;
    try { mails = await graphMails(new Date(ab).toISOString().replace(/\.\d{3}Z$/, 'Z')); }
    catch (e) { return json({ fehler: (e as Error).message }, 502); }
  } else {
    const schluessel = req.headers.get('x-oemag-schluessel') || new URL(req.url).searchParams.get('schluessel') || '';
    if (!env('OEMAG_SCHLUESSEL') || schluessel !== env('OEMAG_SCHLUESSEL')) return json({ fehler: 'Schlüssel fehlt oder falsch' }, 401);
    mails = [eingangMail(body)];
  }

  // Alle Förderungen einmal laden (für die Zuordnung)
  const liste: unknown[] = [];
  for (let von = 0; ; von += 1000) {
    const { data, error } = await sb.from('foerderungen').select('id, kunde, zaehlpunkt, fpj, eag_nr, ticket, foerdercall, schritte, offene_punkte, info, geloescht_am').range(von, von + 999);
    if (error) return json({ fehler: error.message }, 500);
    liste.push(...data);
    if (data.length < 1000) break;
  }

  const bericht = { gelesen: 0, uebersprungen: 0, schon_da: 0, angewendet: 0, vorschlag: 0, offen: 0, fehler: [] as string[] };
  for (const m of mails) {
    if (m.quelle === 'postfach' && m.von && !absenderOk(m.von)) { bericht.uebersprungen++; continue; }
    const text = m.text || O.textAusHtml(m.html || '');
    const hash = await sha256(m.betreff + '\n' + text);
    const mid = m.message_id || 'ohne-id:' + hash;
    const { data: da } = await sb.from('foerder_posteingang').select('id').eq('message_id', mid).limit(1);
    if (da?.length) { bericht.schon_da++; continue; }
    bericht.gelesen++;

    const r = O.verarbeiten({ betreff: m.betreff, text, datum: m.datum }, liste);
    const { data: neu, error } = await sb.from('foerder_posteingang').insert({
      message_id: mid, quelle: m.quelle, empfangen_am: m.datum, absender: m.von, betreff: m.betreff, text, sha256: hash,
      art: r.erkannt.art, sicher: r.erkannt.sicher, erkannt: r.erkannt, foerderung_id: r.foerderung?.id || null,
      zuordnung: r.zuordnung, kandidaten: r.kandidaten, automatisch: r.automatisch, vorschlag: r.vorschlag,
      notizen: r.notizen, status: r.status === 'angewendet' ? 'offen' : r.status,
    }).select('id').single();
    if (error) { bericht.fehler.push(`${m.betreff}: ${error.message}`); continue; }

    if (r.foerderung && Object.keys(r.automatisch).length) {
      const { error: e2 } = await sb.rpc('foerder_oemag_anwenden', { p_id: neu.id, p_aenderung: r.automatisch });
      if (e2) { bericht.fehler.push(`${m.betreff}: ${e2.message}`); continue; }
      // Liste mitziehen, damit eine zweite Mail zur selben Förderung den neuen Stand sieht
      Object.assign(r.foerderung, O.anwenden(r.foerderung, r.automatisch));
    }
    bericht[r.status === 'angewendet' || r.status === 'erledigt' ? 'angewendet' : r.status === 'vorschlag' ? 'vorschlag' : 'offen']++;
  }
  return json(bericht);
});
