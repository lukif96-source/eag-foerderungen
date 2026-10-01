// deno test supabase/functions/oemag/webhook.pruefung.ts  (kein *_test-Name: sonst greift node --test zu)
import { webhookEcht } from './webhook.ts';

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
