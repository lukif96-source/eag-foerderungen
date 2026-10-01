// Signatur eines Resend-Webhooks prüfen (Standard Webhooks / Svix):
// signiert wird "<id>.<timestamp>.<body>" mit HMAC-SHA256; der Schlüssel ist der Base64-Teil nach „whsec_“.
// Header: svix-id / svix-timestamp / svix-signature (oder webhook-*); Signaturen „v1,<base64>“, mit Leerzeichen getrennt.
export async function webhookEcht(secret: string, headers: Headers, body: string, jetzt = Date.now()): Promise<boolean> {
  const h = (n: string) => headers.get('svix-' + n) || headers.get('webhook-' + n) || '';
  const id = h('id'), ts = h('timestamp'), sig = h('signature');
  if (!secret || !id || !ts || !sig) return false;
  if (!/^\d+$/.test(ts) || Math.abs(jetzt / 1000 - Number(ts)) > 5 * 60) return false;   // Schutz gegen Wiederholung
  let roh: Uint8Array<ArrayBuffer>;
  try { roh = Uint8Array.from(atob(secretNormal(secret).replace(/^whsec_/, '')), (c) => c.charCodeAt(0)); }
  catch { return false; }                                                       // kein gültiges Signing Secret
  const key = await crypto.subtle.importKey('raw', roh, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const erwartet = btoa(String.fromCharCode(...mac));
  return sig.split(' ').some((s) => {
    const [ver, wert] = s.split(',');
    if (ver !== 'v1' || !wert || wert.length !== erwartet.length) return false;
    let diff = 0;
    for (let i = 0; i < wert.length; i++) diff |= wert.charCodeAt(i) ^ erwartet.charCodeAt(i);   // zeitkonstant
    return diff === 0;
  });
}

// Häufige Kopierfehler ausgleichen: „NAME=“ davor, Anführungszeichen, Leerzeichen/Zeilenumbrüche mittendrin,
// Base64 in URL-Schreibweise (- und _ statt + und /), fehlendes „=“ am Ende
export function secretNormal(secret: string): string {
  let s = secret.trim().replace(/^[A-Z_]+\s*=\s*/, '').replace(/\s+/g, '').replace(/^["'`„“]+|["'`“”]+$/g, '');
  const i = s.indexOf('whsec_');
  if (i > 0) s = s.slice(i);
  if (!s.startsWith('whsec_')) return s;
  let b = s.slice(6).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  while (b.length % 4) b += '=';
  return 'whsec_' + b;
}

// Sieht der Wert wie ein Signing Secret aus? (whsec_ + Base64) – sonst ist in Supabase etwas anderes eingetragen
export const secretGueltig = (secret: string) => /^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secretNormal(secret));

// Was stimmt nicht? Nur die Art des Fehlers – nie der Wert selbst (fürs Protokoll)
export function secretBefund(secret: string): string {
  const s = secret.trim(), n = secretNormal(secret);
  const teile = [`Länge ${s.length}`, s.startsWith('whsec_') ? 'beginnt mit whsec_' : s.includes('whsec_') ? 'whsec_ nicht am Anfang' : 'ohne whsec_'];
  if (/\s/.test(s)) teile.push('enthält Leerzeichen/Zeilenumbruch');
  if (/["'`„“”]/.test(s)) teile.push('enthält Anführungszeichen');
  if (/^re_/.test(s)) teile.push('sieht aus wie ein API-Schlüssel (re_…)');
  const fremd = n.replace(/^whsec_/, '').replace(/[A-Za-z0-9+/=]/g, '');
  if (fremd) teile.push(`${fremd.length} Zeichen außerhalb von Base64`);
  return teile.join(', ');
}
