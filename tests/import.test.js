// Tests für den Abgleich beim Excel-Import (js/import.js) – ohne Browser
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = { EAG: require('../js/ablauf.js') };
require('../js/import.js');
const I = window.EAG_IMPORT;

// So hat der alte Import einen im Juni abgelehnten Kunden gespeichert:
// Portal-Nummer → "Projekt", und weil Ticket früher VOR Projekt kam, auch "Ticket ✓"
const alt = () => ({
  id: 'x1', jahr: 2026, kunde: 'Mitterlehner Sonja', projekt_nr: 'P250310', fpj: 'FPJ00108110', foerdercall: '2026-06-16',
  zaehlpunkt: '0030000000000000000000000000123', ticket: '', schritte: { ticket: '✓', projekt: '✓' }, info: '', offene_punkte: ''
});
// So liest der neue Import dieselbe, orange markierte Zeile
const ausExcel = () => Object.assign(alt(), { id: undefined, _abgelehntIm: '2026-06-16', foerdercall: '2026-10-08', schritte: { projekt: '✓', frueher_abgelehnt: '2026-06-16' } });

test('Orange in der Liste, in der App noch im Juni-Call: in den Oktober-Call, Ticket weg', () => {
  const { ergaenzen } = I.abgleich([ausExcel()], [alt()], '2026-10-01');
  assert.equal(ergaenzen.length, 1);
  const { patch, neuAngesucht } = ergaenzen[0];
  assert.equal(neuAngesucht, true);
  assert.equal(patch.foerdercall, '2026-10-08');
  assert.equal(patch.schritte.ticket, undefined);
  assert.equal(patch.schritte.projekt, '✓');
  assert.equal(patch.schritte.frueher_abgelehnt, '2026-06-16');
  assert.equal('_neuAngesucht' in patch, false);   // nichts, was die Datenbank nicht kennt
});

test('Schon neu angesucht: ein zweiter Import setzt nichts mehr zurück', () => {
  const schonNeu = Object.assign(alt(), { foerdercall: '2026-10-08', schritte: { projekt: '✓', ticket: '2026-10-08', frueher_abgelehnt: '2026-06-16' } });
  const { ergaenzen, gleich } = I.abgleich([ausExcel()], [schonNeu], '2026-10-09');
  assert.equal(ergaenzen.filter(e => e.neuAngesucht).length, 0);
  assert.equal((ergaenzen[0] ? ergaenzen[0].patch.schritte || {} : {}).ticket, undefined);
  assert.equal(ergaenzen.length + gleich.length, 1);
});

test('Nach dem letzten Call: abgelehnt statt neu angesucht', () => {
  const { ergaenzen } = I.abgleich([ausExcel()], [alt()], '2026-11-01');
  const { patch } = ergaenzen[0];
  assert.equal(patch.foerdercall, undefined);
  assert.equal(patch.schritte.abgelehnt, '✓');
});

test('Nachhaken erfindet nie neue Schritte und kein Ticket aus der Portal-Nummer', () => {
  const s = { projekt: '✓', rechnung: '2026-08-01' };
  I.vorherigeAbhaken(s);
  assert.equal(s.inbetriebnahme, undefined);
  assert.equal(s.herkunftsnachweis, undefined);
  assert.equal(s.ticket, '✓');          // Rechnung setzt Ticket/Einreichung/Vertrag voraus
  const nurProjekt = { projekt: '✓' };
  I.vorherigeAbhaken(nurProjekt);
  assert.deepEqual(nurProjekt, { projekt: '✓' });
});

// ── Orange in der Excel = nochmal ansuchen ────────────────────────
test('Orange-Erkennung über den Farbton: alle Orangetöne ja, Gelb/Grün/Rot/Grau nein', () => {
  ['FF572F', 'FFC000', 'ED7D31', 'F4B084', 'F8CBAD', 'FFA500', 'FF9900', 'C65911', 'FBE2D5'].forEach(h => assert.equal(I.istOrange(h), true, h));
  ['92D050', 'FFFF00', 'FF0000', 'C00000', 'D9D9D9', 'FFFFFF', '000000', '4472C4', 'FFF2CC', 'FFE699', 'FFD966'].forEach(h => assert.equal(I.istOrange(h), false, h));
  assert.equal(I.fuellfarbe({ s: { fgColor: { rgb: 'FFFF572F' } } }), 'FF572F');      // ARGB
  assert.equal(I.istOrange(I.fuellfarbe({ s: { fgColor: { theme: 5 } } })), true);    // Designfarbe Akzent 2
});

test('Orange ohne Call-Datum: trotzdem nochmal ansuchen im offenen Call', () => {
  const p = I.nochmalAnsuchen({ jahr: 2025, foerdercall: null, schritte: { projekt: '✓', ticket: '✓', eingereicht: '✓' } }, '2026-10-01');
  assert.equal(p.foerdercall, '2026-10-08');
  assert.equal(p.jahr, 2026);
  assert.equal(p.schritte.nochmal_ansuchen, '✓');
  assert.equal(p.schritte.ticket, undefined);
  assert.equal(p.schritte.projekt, '✓');
  assert.equal(window.EAG.nochmal({ schritte: p.schritte }), true);
});

test('Orange, in der App schon importiert ohne Vermerk: beim erneuten Import nachgeholt', () => {
  const bestand = Object.assign(alt(), { foerdercall: null, schritte: { projekt: '✓' } });
  const ausListe = Object.assign(alt(), { id: undefined, _orange: true, foerdercall: '2026-10-08', schritte: { projekt: '✓', nochmal_ansuchen: '✓' } });
  const { ergaenzen } = I.abgleich([ausListe], [bestand], '2026-10-01');
  assert.equal(ergaenzen[0].neuAngesucht, true);
  assert.equal(ergaenzen[0].patch.schritte.nochmal_ansuchen, '✓');
  assert.equal(ergaenzen[0].patch.foerdercall, '2026-10-08');
});

test('Zählpunkt fürs Ticket ohne AT', () => {
  assert.equal(window.EAG.zpFuersTicket('AT0030000000000000000000000000123'), '0030000000000000000000000000123');
  assert.equal(window.EAG.zpFuersTicket('at 00300 00000000000000000000000123'), '0030000000000000000000000000123');
  assert.equal(window.EAG.zpFuersTicket('0030000000000000000000000000123'), '0030000000000000000000000000123');
});
