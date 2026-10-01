// Täglicher Lauf der Förderliste (pg_cron ruft ihn jede Nacht auf, siehe sql/archiv.sql):
//   1. Sicherung des Tages in foerder_archiv anlegen (falls der Cron-Teil davor ausgefallen ist)
//   2. Sicherung als JSON-Datei in den privaten Bucket "foerder-archiv" legen
//   3. Überfällige Fristen als Ereignis protokollieren (nur wenn sql/vorschlag-revision.sql eingespielt ist)
//   4. Einmal am Tag Mail an die Admins: CSV für Excel + JSON zum Wiederherstellen + Hash als Anker
// Jeder Schritt ist wiederholbar: mehrfache Aufrufe verschicken nichts doppelt und legen nichts doppelt an.
// Die Funktion nimmt keine Daten vom Aufrufer an – deshalb verify_jwt = false (wie foerder-registrierung).
// Secrets: RESEND_API_KEY (für die Mail), optional MAIL_ABSENDER, ARCHIV_MAIL (Empfänger statt der Admins,
// mit Komma), ARCHIV_ANHANG=nein (Mail nur mit Hash, ohne Kundendaten im Anhang).
// ablauf.js ist eine Kopie von js/ablauf.js – ein Test (tests/ablauf.test.js) prüft, dass beide gleich sind.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import './ablauf.js';

// deno-lint-ignore no-explicit-any
const A = (globalThis as any).EAG_ABLAUF;
const APP_URL = 'https://lukif96-source.github.io/eag-foerderungen/';
const BUCKET = 'foerder-archiv';

const json = (daten: unknown, status = 200) =>
  new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const b64 = (text: string) => encodeBase64(new TextEncoder().encode(text));

Deno.serve(async () => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const bericht: Record<string, unknown> = {};

  // 1. Sicherung des Tages
  const { data: tag, error: e1 } = await sb.rpc('foerder_archivieren');
  if (e1) return json({ fehler: 'Sicherung: ' + e1.message }, 500);
  const { data: archiv, error: e2 } = await sb.from('foerder_archiv').select('*').eq('tag', tag).single();
  if (e2 || !archiv) return json({ fehler: 'Sicherung lesen: ' + (e2?.message ?? 'fehlt') }, 500);
  bericht.tag = tag;
  bericht.anzahl = archiv.anzahl;
  bericht.sha256 = archiv.sha256;

  const inhalt = JSON.stringify({
    tag: archiv.tag, erstellt_am: archiv.erstellt_am, anzahl: archiv.anzahl,
    sha256: archiv.sha256, vorher_sha256: archiv.vorher_sha256, nutzer: archiv.nutzer, daten: archiv.daten,
  });

  // 2. Datei im Bucket
  if (!archiv.datei) {
    const pfad = `${String(tag).slice(0, 4)}/${tag}.json`;
    const { error } = await sb.storage.from(BUCKET).upload(pfad, new Blob([inhalt], { type: 'application/json' }), { upsert: true });
    if (error) bericht.datei_fehler = error.message;
    else {
      await sb.from('foerder_archiv').update({ datei: pfad }).eq('tag', tag);
      bericht.datei = pfad;
    }
  } else bericht.datei = archiv.datei;

  // 3. Überfällige Fristen protokollieren (Regeln aus ablauf.js, Stichtag = Sicherungstag)
  // deno-lint-ignore no-explicit-any
  const daten = archiv.daten as any[];
  const verpasst = A.verpassteFristen(daten, String(tag));
  let neuVerpasst = 0;
  for (const { f, frist } of verpasst) {
    const { error } = await sb.from('foerder_ereignisse').insert({
      foerderung_id: f.id, von: 'System', art: 'frist_verpasst', schluessel: frist.art,
      neu: { datum: frist.datum, label: frist.label, tage: frist.tage },
    });
    if (!error) { neuVerpasst++; continue; }
    if (error.code === '23505') continue;                                  // schon protokolliert
    if (error.code === '42P01' || error.code === 'PGRST205') { bericht.fristen = 'Protokoll nicht eingespielt'; break; }
    bericht.fristen_fehler = error.message; break;
  }
  bericht.ueberfaellig = verpasst.length;
  bericht.neu_protokolliert = neuVerpasst;

  // Anker der Revisions-Kette (falls vorhanden): Anzahl Ereignisse + Hash über alle letzten Hashes
  let kette = '';
  const { data: letzte, error: e3 } = await sb.from('foerder_ereignisse').select('id, hash').order('id', { ascending: false }).limit(1);
  if (!e3 && letzte && letzte.length) kette = `Protokoll bis Ereignis ${letzte[0].id}`;

  // 4. Mail – einmal am Tag
  if (archiv.versendet_am) return json({ ...bericht, mail: 'schon versendet' });
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return json({ ...bericht, mail: 'RESEND_API_KEY fehlt' });
  let empfaenger = (Deno.env.get('ARCHIV_MAIL') || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!empfaenger.length) {
    const { data: admins } = await sb.from('foerder_nutzer').select('email').eq('rolle', 'admin');
    empfaenger = (admins ?? []).map((a) => a.email);
  }
  if (!empfaenger.length) return json({ ...bericht, mail: 'kein Empfänger' });

  const aktiv = daten.filter((d) => !d.geloescht_am);
  const mitAnhang = (Deno.env.get('ARCHIV_ANHANG') || '').toLowerCase() !== 'nein';
  const tagDE = A.datumDE(String(tag));
  const fristZeilen = verpasst.slice(0, 25).map(({ f, frist }: { f: { kunde: string }; frist: { label: string; datum: string; tage: number } }) =>
    `<li><b>${esc(f.kunde)}</b> – ${esc(frist.label)} bis ${esc(A.datumDE(frist.datum))} <span style="color:#c23b30">(${-frist.tage} Tage überfällig)</span></li>`).join('');
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d2521;max-width:560px">
    <p style="margin:0 0 4px;color:#6c8c0c;font-weight:600">SOLPRO · EAG-Förderungen</p>
    <h2 style="margin:0 0 12px;font-size:19px">Tägliche Sicherung vom ${tagDE}</h2>
    <p style="margin:0 0 12px">${aktiv.length} Förderungen${daten.length > aktiv.length ? ` (+ ${daten.length - aktiv.length} im Papierkorb)` : ''} gesichert.
      ${mitAnhang ? 'Im Anhang: <b>CSV</b> (öffnet in Excel) und <b>JSON</b> (zum Wiederherstellen).' : 'Die Datei liegt im privaten Speicher von Supabase.'}</p>
    ${verpasst.length ? `<p style="margin:0 0 6px;color:#c23b30;font-weight:600">${verpasst.length} überfällige Frist${verpasst.length === 1 ? '' : 'en'}</p><ul style="padding-left:18px;margin:0 0 14px">${fristZeilen}</ul>` : '<p style="margin:0 0 14px;color:#5b6660">Keine überfälligen Fristen.</p>'}
    <table style="font-size:12px;color:#5b6660;border-collapse:collapse;margin:0 0 16px">
      <tr><td style="padding:2px 10px 2px 0">Prüfsumme (SHA-256)</td><td style="font-family:Consolas,monospace">${esc(archiv.sha256)}</td></tr>
      <tr><td style="padding:2px 10px 2px 0">Vortag</td><td style="font-family:Consolas,monospace">${esc(archiv.vorher_sha256 || '–')}</td></tr>
      ${kette ? `<tr><td style="padding:2px 10px 2px 0">Protokoll</td><td>${esc(kette)}</td></tr>` : ''}
    </table>
    <p style="margin:0 0 16px;font-size:12px;color:#5b6660">Diese Mail bitte nicht löschen: Die Prüfsumme belegt, dass die Sicherung seit heute unverändert ist.</p>
    <a href="${APP_URL}" style="display:inline-block;background:#93BD14;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">EAG-Förderungen öffnen</a>
  </div>`;

  const attachments = mitAnhang ? [
    { filename: `EAG-Foerderungen_${tag}.csv`, content: b64(A.csv(aktiv.map((d) => A.exportZeile(d, String(tag))))) },
    { filename: `EAG-Foerderungen_${tag}.json`, content: b64(inhalt) },
  ] : undefined;

  const antwort = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('MAIL_ABSENDER') || 'EAG-Förderungen <onboarding@resend.dev>',
      to: empfaenger,
      subject: `Sicherung ${tagDE}: ${aktiv.length} Förderungen${verpasst.length ? ` · ${verpasst.length} überfällig` : ''}`,
      html,
      attachments,
    }),
  });
  if (!antwort.ok) return json({ ...bericht, mail_fehler: await antwort.text() }, 502);
  await sb.from('foerder_archiv').update({ versendet_am: new Date().toISOString() }).eq('tag', tag);
  return json({ ...bericht, mail: empfaenger.length + ' Empfänger' });
});
