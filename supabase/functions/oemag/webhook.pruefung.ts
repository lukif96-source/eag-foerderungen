// deno test supabase/functions/oemag/webhook.pruefung.ts  (kein *_test-Name: sonst greift node --test zu)
import { secretBefund, secretGueltig, webhookEcht } from './webhook.ts';

const geheim = 'whsec_' + btoa('ein-test-geheimnis-32-zeichen-lang!!');
async function signiere(id: string, ts: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('ein-test-geheimnis-32-zeichen-lang!!'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  return 'v1,' + btoa(String.fromCharCode(...mac));
}
const body = JSON.stringify({ type: 'email.received', data: { email_id: 'abc' } });
const ts = String(Math.floor(Date.now() / 1000));

Deno.test('echte Signatur wird angenommen (svix- und webhook-Header)', async () => {
  const sig = await signiere('msg_1', ts, body);
  for (const p of ['svix-', 'webhook-']) {
    const h = new Headers({ [p + 'id']: 'msg_1', [p + 'timestamp']: ts, [p + 'signature']: 'v1,falsch ' + sig });
    if (!(await webhookEcht(geheim, h, body))) throw new Error('abgelehnt: ' + p);
  }
});
Deno.test('veränderter Inhalt, falsches Geheimnis, alter Zeitstempel → abgelehnt', async () => {
  const sig = await signiere('msg_1', ts, body);
  const h = new Headers({ 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': sig });
  if (await webhookEcht(geheim, h, body.replace('abc', 'xyz'))) throw new Error('veränderter Inhalt angenommen');
  if (await webhookEcht('whsec_' + btoa('anderes-geheimnis'), h, body)) throw new Error('falsches Geheimnis angenommen');
  const alt = String(Math.floor(Date.now() / 1000) - 3600);
  const h2 = new Headers({ 'svix-id': 'msg_1', 'svix-timestamp': alt, 'svix-signature': await signiere('msg_1', alt, body) });
  if (await webhookEcht(geheim, h2, body)) throw new Error('alter Zeitstempel angenommen');
  if (await webhookEcht(geheim, new Headers(), body)) throw new Error('ohne Header angenommen');
});
Deno.test('falsch eingetragenes Secret: kein Absturz, sondern abgelehnt und erkannt', async () => {
  const sig = await signiere('msg_1', ts, body);
  const h = new Headers({ 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': sig });
  for (const falsch of ['re_AbC123_xyz', 'whsec_nicht base64!', 'whsec_ab$c']) {
    if (await webhookEcht(falsch, h, body)) throw new Error('angenommen: ' + falsch);
    if (secretGueltig(falsch)) throw new Error('als gültig erkannt: ' + falsch);
  }
  if (!secretGueltig(geheim) || !secretGueltig(' ' + geheim + '\n')) throw new Error('echtes Secret nicht erkannt');
});
Deno.test('Kopierfehler im Secret werden ausgeglichen', async () => {
  const sig = await signiere('msg_1', ts, body);
  const h = new Headers({ 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': sig });
  const b64 = geheim.slice(6);
  const urlForm = 'whsec_' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  for (const v of ['"' + geheim + '"', 'RESEND_WEBHOOK_SECRET=' + geheim, geheim.slice(0, 12) + ' \n' + geheim.slice(12), urlForm, ' ' + geheim + ' ']) {
    if (!secretGueltig(v)) throw new Error('nicht erkannt: ' + JSON.stringify(v));
    if (!(await webhookEcht(v, h, body))) throw new Error('abgelehnt: ' + JSON.stringify(v));
  }
  const befund = secretBefund('re_123abc');
  if (!befund.includes('API-Schlüssel') || befund.includes('123abc')) throw new Error('Befund: ' + befund);
});
