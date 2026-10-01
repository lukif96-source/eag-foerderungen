// Signatur eines Resend-Webhooks prüfen (Standard Webhooks / Svix):
// signiert wird "<id>.<timestamp>.<body>" mit HMAC-SHA256; der Schlüssel ist der Base64-Teil nach „whsec_“.
// Header: svix-id / svix-timestamp / svix-signature (oder webhook-*); Signaturen „v1,<base64>“, mit Leerzeichen getrennt.
export async function webhookEcht(secret: string, headers: Headers, body: string, jetzt = Date.now()): Promise<boolean> {
  const h = (n: string) => headers.get('svix-' + n) || headers.get('webhook-' + n) || '';
  const id = h('id'), ts = h('timestamp'), sig = h('signature');
  if (!secret || !id || !ts || !sig) return false;
  if (!/^\d+$/.test(ts) || Math.abs(jetzt / 1000 - Number(ts)) > 5 * 60) return false;   // Schutz gegen Wiederholung
  const roh = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
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
