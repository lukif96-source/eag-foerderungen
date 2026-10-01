// Tests für js/ablauf.js – ausführen mit:  node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/ablauf.js');

const basis = (schritte, extra) => Object.assign({
  kunde: 'Muster Max', strasse: 'Weg 1', plz: '4810', ort: 'Gmunden', zaehlpunkt: 'AT0030000000000000000000000000123', mail: 'm@x.at',
  kwp: 9.9, speicher: '18 kWh', zieher: 'Verena', foerdercall: '2026-10-08', schritte: schritte || {}
}, extra || {});

// ── Datum ─────────────────────────────────────────────────────────
test('Monate addieren bleibt im Monat (31.08. + 6 = Ende Februar)', () => {
  assert.equal(A.plusMonate('2026-08-31', 6), '2027-02-28');
  assert.equal(A.plusMonate('2027-08-31', 6), '2028-02-29');   // Schaltjahr
  assert.equal(A.plusMonate('2026-11-15', 6), '2027-05-15');
  assert.equal(A.plusMonate('2026-12-01', 12), '2027-12-01');
});

test('Callende aus der Liste, sonst 14 Tage', () => {
  assert.equal(A.callEnde('2026-10-08'), '2026-10-22');
  assert.equal(A.callEnde('2026-04-23'), '2026-05-11');
  assert.equal(A.callEnde('2025-10-08'), '2025-10-22');
});

// ── Status ────────────────────────────────────────────────────────
test('Reihenfolge: Projekt im Portal kommt vor dem Ticket', () => {
  assert.ok(A.IDX.projekt < A.IDX.ticket);
  assert.ok(A.IDX.ticket < A.IDX.eingereicht);
  assert.ok(A.IDX.vertrag_erhalten < A.IDX.inbetriebnahme);
  assert.ok(A.IDX.inbetriebnahme < A.IDX.abgeschlossen);
});

test('Nächster Schritt nach angelegtem Projekt ist das Ticket', () => {
  const st = A.status(basis({ projekt: '2026-09-01' }));
  assert.equal(A.SCHRITTE[st.naechster].key, 'ticket');
  assert.equal(st.fertig, false);
});

test('Neue Schritte (Inbetriebnahme, E-Control) sind bei alten Datensätzen keine Lücke', () => {
  const st = A.status(basis({ projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '✓', vertrag_versendet: '✓', rechnung: '✓' }));
  assert.deepEqual(st.luecken, []);
  assert.equal(A.SCHRITTE[st.naechster].key, 'zahlung');
});

test('Echte Lücke wird gemeldet', () => {
  const st = A.status(basis({ projekt: '✓', eingereicht: '✓' }));   // Ticket fehlt
  assert.deepEqual(st.luecken.map(i => A.SCHRITTE[i].key), ['ticket']);
});

test('Ausgezahlt = fertig, abgelehnt = beendet ohne nächsten Schritt', () => {
  const alle = Object.fromEntries(A.SCHRITTE.filter(s => !s.auto).map(s => [s.key, '✓']));
  assert.equal(A.status(basis(alle)).fertig, true);
  const ab = A.status(basis({ projekt: '✓', abgelehnt: '2026-07-10' }));
  assert.equal(ab.ende.key, 'abgelehnt');
  assert.equal(ab.naechster, -1);
  assert.equal(ab.fertig, false);
});

test('Offene Nachforderung geht vor dem Warten auf den Vertrag', () => {
  const f = basis({ projekt: '✓', ticket: '✓', eingereicht: '2026-10-09', nachforderung: '2026-11-02' });
  const st = A.status(f);
  assert.equal(st.nachforderungOffen, true);
  assert.equal(A.aufgabe(f, st).todo, 'Unterlagen nachreichen');
  f.schritte.nachgereicht = '2026-11-10';
  assert.equal(A.aufgabe(f).key, 'vertrag_erhalten');
});

// ── Fristen ───────────────────────────────────────────────────────
test('Vor dem Call: Ticket am 08.10., danach Antrag bis 22.10.', () => {
  const f = basis({ projekt: '✓' });
  const [t] = A.fristen(f, '2026-10-01');
  assert.equal(t.art, 'ticket'); assert.equal(t.datum, '2026-10-08'); assert.equal(t.tage, 7); assert.equal(t.stufe, 'dringend');
  f.schritte.ticket = '2026-10-08';
  const [a] = A.fristen(f, '2026-10-10');
  assert.equal(a.art, 'antrag'); assert.equal(a.datum, '2026-10-22'); assert.equal(a.stufe, 'bald');
});

test('Ticket verpasst: Call ist vorbei → überfällig', () => {
  const [t] = A.fristen(basis({ projekt: '✓' }, { foerdercall: '2026-06-16' }), '2026-10-01');
  assert.equal(t.art, 'ticket'); assert.equal(t.stufe, 'ueberfaellig');
});

test('Nachforderung: 4 Wochen', () => {
  const f = basis({ projekt: '✓', ticket: '✓', eingereicht: '✓', nachforderung: '2026-11-02' });
  const n = A.fristen(f, '2026-11-20').find(x => x.art === 'nachforderung');
  assert.equal(n.datum, '2026-11-30'); assert.equal(n.tage, 10);
});

test('Inbetriebnahme 6 Monate ab Vertrag, Endabrechnung 6 Monate danach', () => {
  const f = basis({ projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '2026-11-20' });
  const fr = A.fristen(f, '2026-12-01');
  assert.deepEqual(fr.map(x => [x.art, x.datum]), [['inbetriebnahme', '2027-05-20'], ['endabrechnung', '2027-11-20']]);
});

test('Über 100 kWp: 12 Monate; Verlängerung ersetzt die Frist', () => {
  const gross = basis({ projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '2026-11-20' }, { kwp: 150 });
  assert.equal(A.inbetriebnahmeFrist(gross), '2027-11-20');
  gross.schritte.verlaengert_bis = '2028-08-20';
  assert.equal(A.inbetriebnahmeFrist(gross), '2028-08-20');
  assert.equal(A.fristen(gross, '2027-01-01').find(x => x.art === 'endabrechnung').datum, '2029-02-20');
});

test('Vertrag ohne Datum: frühestmögliche Frist als Schätzung, nichts muss nachgetragen werden', () => {
  const fr = A.fristen(basis({ projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '✓' }), '2026-12-01');
  assert.equal(fr[0].datum, '2027-04-22');              // Callende 22.10.2026 + 6 Monate
  assert.equal(fr[0].geschaetzt, true);
  assert.equal(fr[0].stufe, 'ruhig');
});

test('Alte Förderung ohne Vertragsdatum: Frist leise „unbekannt“, nicht rot', () => {
  const f = basis({ projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '✓' }, { foerdercall: '2025-06-16' });
  const fr = A.fristen(f, '2026-10-01');
  assert.ok(fr.length > 0);
  fr.forEach(x => { assert.equal(x.stufe, 'unbekannt'); assert.equal(x.datum, null); });
});

test('In Betrieb: nur noch die Endabrechnungs-Frist', () => {
  const f = basis({ projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '2026-11-20', inbetriebnahme: '2027-03-01' });
  assert.deepEqual(A.fristen(f, '2027-03-02').map(x => x.art), ['endabrechnung']);
});

test('Fertig oder abgelehnt: keine Fristen', () => {
  const alle = Object.fromEntries(A.SCHRITTE.filter(s => !s.auto).map(s => [s.key, '✓']));
  assert.deepEqual(A.fristen(basis(alle), '2027-01-01'), []);
  assert.deepEqual(A.fristen(basis({ abgelehnt: '2026-07-01' }, { foerdercall: '2026-06-16' }), '2026-10-01'), []);
});

// ── Neu ansuchen ──────────────────────────────────────────────────
test('Abgelehnt im Juni → Oktober-Call, Ticket weg, Projekt bleibt, Herkunft gemerkt', () => {
  const f = basis({ projekt: '2026-06-01', ticket: '✓', abgelehnt: '2026-07-10' }, { foerdercall: '2026-06-16', ticket: 'a1b2' });
  const p = A.neuAnsuchen(f, '2026-10-01');
  assert.equal(p.foerdercall, '2026-10-08');
  assert.equal(p.ticket, '');
  assert.equal(p.schritte.projekt, '2026-06-01');
  assert.equal(p.schritte.ticket, undefined);
  assert.equal(p.schritte.abgelehnt, undefined);
  assert.equal(p.schritte.frueher_abgelehnt, '2026-06-16');
  const neu = Object.assign({}, f, p);
  assert.equal(A.SCHRITTE[A.status(neu).naechster].key, 'ticket');
});

test('Nach dem letzten Call ist kein Neu-Ansuchen mehr möglich', () => {
  assert.equal(A.offenerCall('2026-10-22'), '2026-10-08');
  assert.equal(A.offenerCall('2026-10-23'), null);
  assert.throws(() => A.neuAnsuchen(basis({}), '2026-11-01'), /2027/);
});

// ── Prüfungen ─────────────────────────────────────────────────────
test('Zählpunkt: 33 Zeichen mit AT, 31 ohne AT wird erkannt', () => {
  assert.equal(A.zpPruefung('AT0030000000000000000000000000123'), 'ok');
  assert.equal(A.zpPruefung('AT 003000 00000 00000000000000000123'), 'ok');
  assert.equal(A.zpPruefung('0030000000000000000000000000123'), 'ohneAT');
  assert.equal(A.zpPruefung('AT00300000000EWERKWELSAG000000123'), 'ok');   // Buchstaben im hinteren Teil sind erlaubt
  assert.equal(A.zpPruefung('AT123'), 'ungueltig');
  assert.equal(A.zpPruefung(''), 'fehlt');
});

test('Kategorie und Zuschuss 2026', () => {
  assert.equal(A.kategorie(10), 'A');
  assert.equal(A.kategorie(10.01), 'B');
  assert.equal(A.kategorie(20), 'B');
  assert.equal(A.kategorie(22.08), 'C');
  assert.equal(A.kategorie(1000.5), null);
  assert.deepEqual(A.zuschuss({ kwp: 9.9, speicher: '18 kWh' }), { kat: 'A', pv: 1485, speicher: 2700, gesamt: 4185, speicherOk: true });
  assert.equal(A.zuschuss({ kwp: 20, speicher: '5 kWh' }).speicherOk, false);   // unter 0,5 kWh je kWp
  assert.equal(A.zuschuss({ kwp: 20, speicher: '5 kWh' }).speicher, 0);
});

test('Frist nur, solange kein späterer Schritt erledigt ist (alte Datensätze ohne Inbetriebnahme)', () => {
  const f = basis({ projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '✓', vertrag_versendet: '✓', rechnung: '✓', zahlung: '✓', abgeschlossen: '✓' });
  assert.deepEqual(A.fristen(f, '2026-10-01'), []);   // wartet nur noch auf Auszahlung
});

test('Ohne Vertragsdatum: Schätzung ab Callende wird rechtzeitig dringend', () => {
  const f = basis({ projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '✓' }, { foerdercall: '2026-04-23' });
  const [ibn, abr] = A.fristen(f, '2026-10-01');
  assert.equal(ibn.datum, '2026-11-11');
  assert.equal(ibn.stufe, 'ruhig');
  assert.match(ibn.hinweis, /frühestens/);
  assert.equal(abr.datum, '2027-05-11');
  assert.equal(A.fristen(f, '2026-11-05')[0].stufe, 'dringend');
});

// ── Alte und ausgezahlte Förderungen ──────────────────────────────
test('Ausgezahlt ist fertig – auch mit Lücken, fehlenden Daten oder einem Ende-Haken', () => {
  const nurAus = basis({ ausgezahlt: '2026-02-11' }, { zaehlpunkt: '', mail: '' });
  const st = A.status(nurAus);
  assert.equal(st.fertig, true);
  assert.deepEqual(st.luecken, []);
  assert.equal(st.ende, null);
  assert.deepEqual(A.fristen(nurAus, '2026-10-01'), []);
  assert.deepEqual(A.datenFehlen(nurAus, '2026-10-01'), []);
  assert.equal(A.status(basis({ projekt: '✓', abgelehnt: '2026-07-10', ausgezahlt: '2026-12-01' })).fertig, true);
});

test('Fehlende Daten zählen nur bis zum Ticket und nur, solange der Call nicht vorbei ist', () => {
  const neu = basis({}, { zaehlpunkt: '' });
  assert.ok(A.datenFehlen(neu, '2026-10-01').length > 0);
  assert.equal(A.SCHRITTE[A.status(neu, '2026-10-01').naechster].key, 'daten');
  const mitTicket = basis({ projekt: '✓', ticket: '2026-10-08' }, { zaehlpunkt: '' });
  assert.deepEqual(A.datenFehlen(mitTicket, '2026-10-09'), []);
  const alt = basis({}, { zaehlpunkt: '', foerdercall: '2025-06-16' });
  assert.deepEqual(A.datenFehlen(alt, '2026-10-01'), []);
  assert.notEqual(A.SCHRITTE[A.status(alt, '2026-10-01').naechster].key, 'daten');
});

// ── Ticket-Zieher ─────────────────────────────────────────────────
test('Ticket-Zieher braucht es nur bis zum Ticket-Tag', () => {
  assert.equal(A.naechsterTicketTag('2026-10-01'), '2026-10-08');
  assert.equal(A.naechsterTicketTag('2026-10-08'), '2026-10-08');
  assert.equal(A.naechsterTicketTag('2026-10-09'), null);
  assert.equal(A.IDX.aufgeteilt, undefined);   // kein eigener Schritt mehr
});

test('Verteilen: gleichmäßig, bestehende Zuteilung bleibt, weggefallene Namen werden neu verteilt', () => {
  const fest = n => 0;   // keine Zufälligkeit im Test
  const k = [{ zieher: 'Verena' }, { zieher: 'Alt' }, { zieher: '' }, { zieher: '' }, { zieher: '' }, {}];
  const neu = A.zieherVerteilen(k, ['Verena', 'Bianca', 'Thomas'], fest);
  assert.equal(neu.length, 5);                               // alle außer der bestehenden Verena-Zuteilung
  assert.ok(neu.every(x => ['Verena', 'Bianca', 'Thomas'].includes(x.zieher)));
  const zaehl = {}; [{ zieher: 'Verena' }].concat(neu.map(x => ({ zieher: x.zieher }))).forEach(x => { zaehl[x.zieher] = (zaehl[x.zieher] || 0) + 1; });
  assert.deepEqual(Object.values(zaehl).sort(), [2, 2, 2]);  // 6 Tickets auf 3 Personen
});
