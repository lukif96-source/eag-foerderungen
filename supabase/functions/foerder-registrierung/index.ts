// Meldet neue Registrierungen per Mail an alle Admins der Förderliste.
// Wird von einem Trigger auf auth.users aufgerufen. Der Aufruf selbst ist ohne Login möglich,
// die Funktion vertraut aber keinen mitgeschickten Daten: Sie sucht selbst nach Konten, die
// weder freigeschaltet noch schon gemeldet sind – mehrfache Aufrufe verschicken also nichts doppelt.
// Bereitstellen: verify_jwt = false. Secrets: RESEND_API_KEY (Pflicht), MAIL_ABSENDER (optional).
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_URL = 'https://lukif96-source.github.io/eag-foerderungen/';

const json = (daten: unknown, status = 200) =>
  new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

Deno.serve(async () => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const [{ data: liste, error: e1 }, { data: nutzer, error: e2 }, { data: gemeldet, error: e3 }] = await Promise.all([
    sb.auth.admin.listUsers({ perPage: 1000 }),
    sb.from('foerder_nutzer').select('email, rolle'),
    sb.from('foerder_meldungen').select('email'),
  ]);
  if (e1 || e2 || e3) return json({ fehler: (e1 || e2 || e3)!.message }, 500);

  const bekannt = new Set([...(nutzer ?? []).map((n) => n.email), ...(gemeldet ?? []).map((g) => g.email)]);
  const grenze = Date.now() - 7 * 24 * 3600 * 1000;
  const neu = (liste?.users ?? []).filter(
    (u) => u.email && !bekannt.has(u.email.toLowerCase()) && Date.parse(u.created_at) > grenze,
  );
  if (!neu.length) return json({ gemeldet: 0 });

  const admins = (nutzer ?? []).filter((n) => n.rolle === 'admin').map((n) => n.email);
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return json({ fehler: 'RESEND_API_KEY fehlt' }, 500);
  if (!admins.length) return json({ fehler: 'kein Admin eingetragen' }, 500);

  const zeilen = neu.map((u) => {
    const zeit = new Date(u.created_at).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'short', timeStyle: 'short' });
    return `<li><b>${esc(u.email!)}</b> <span style="color:#5b6660">– registriert ${esc(zeit)}</span></li>`;
  }).join('');
  const anzahl = neu.length === 1 ? 'Eine neue Registrierung wartet' : `${neu.length} neue Registrierungen warten`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1d2521;max-width:520px">
    <p style="margin:0 0 4px;color:#6c8c0c;font-weight:600">SOLPRO · EAG-Förderungen</p>
    <h2 style="margin:0 0 12px;font-size:20px">${anzahl} auf deine Freischaltung</h2>
    <ul style="padding-left:18px;margin:0 0 16px">${zeilen}</ul>
    <p style="margin:0 0 18px">Ohne Freischaltung sieht die Person keine Daten. Bitte nur Personen freischalten, die du kennst.</p>
    <a href="${APP_URL}#nutzer" style="display:inline-block;background:#93BD14;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Jetzt prüfen und freischalten</a>
  </div>`;

  const antwort = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('MAIL_ABSENDER') || 'EAG-Förderungen <onboarding@resend.dev>',
      to: admins,
      subject: `${anzahl} auf Freischaltung – EAG-Förderungen`,
      html,
    }),
  });
  if (!antwort.ok) return json({ fehler: 'Mailversand fehlgeschlagen', details: await antwort.text() }, 502);

  await sb.from('foerder_meldungen').upsert(neu.map((u) => ({ email: u.email!.toLowerCase() })));
  return json({ gemeldet: neu.length });
});
