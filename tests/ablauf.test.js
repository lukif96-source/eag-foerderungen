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
  assert.equal(A.naechsterTicketTag('2026-10-09'), '2026-10-08');   // Tag danach: nachtragen
  assert.equal(A.naechsterTicketTag('2026-10-10'), null);
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

// ── Status-Tracker ────────────────────────────────────────────────
test('Tracker eine Woche vor dem Ticket-Tag: Call-Phase aktiv, Alarm, wir sind dran', () => {
  const t = A.tracker(basis({ projekt: '2026-09-20' }), '2026-10-01');
  assert.equal(t.zustand, 'aktiv');
  assert.equal(t.ton, 'alarm');                     // 7 Tage = dringend
  assert.equal(t.nummer, A.IDX.ticket + 1);
  assert.equal(t.aktion.key, 'ticket');
  assert.equal(t.aktion.wer, 'wir');
  assert.equal(t.frist.art, 'ticket');
  assert.deepEqual(t.phasen.map(p => p.zustand), ['fertig', 'aktiv', 'offen', 'offen', 'offen']);
  assert.equal(t.phasen.reduce((s, p) => s + p.gesamt, 0), A.SCHRITTE.length);
  assert.equal(t.phasen[1].schritte[0].zustand, 'jetzt');
});

test('Tracker beim Warten auf den Vertrag: Förderstelle ist dran, ruhig', () => {
  const t = A.tracker(basis({ projekt: '✓', ticket: '2026-10-08', eingereicht: '2026-10-09' }), '2026-10-12');
  assert.equal(t.zustand, 'wartet');
  assert.equal(t.aktion.wer, 'foerderstelle');
  assert.equal(t.phasen[2].zustand, 'aktiv');
  assert.equal(t.phasen[2].schritte[0].zustand, 'wartet');
  assert.equal(t.ton, 'ruhig');
});

test('Tracker: Vertrag ohne Datum → Schätzung oder leise „unbekannt“, nie Alarm', () => {
  const f = basis({ projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '✓' });
  const t = A.tracker(f, '2026-12-01');                     // frühestens 22.04.2027 – Schätzung
  assert.equal(t.frist.geschaetzt, true);
  assert.equal(t.ton, 'ruhig');
  const spaet = A.tracker(f, '2028-01-01');                  // Schätzung vorbei → unbekannt, leise
  assert.equal(spaet.frist.stufe, 'unbekannt');
  assert.equal(spaet.ton, 'ruhig');
});

test('Tracker: Lücke färbt die Phase und macht aufmerksam', () => {
  const t = A.tracker(basis({ projekt: '✓', eingereicht: '✓' }, { foerdercall: '' }), '2026-10-01');
  assert.deepEqual(t.luecken, ['Ticket gezogen']);
  assert.equal(t.phasen[1].zustand, 'luecke');
  assert.equal(t.ton, 'achtung');
});

test('Tracker: abgelehnt und ausgezahlt haben keine Aktion', () => {
  const ab = A.tracker(basis({ projekt: '✓', abgelehnt: '2026-07-10' }), '2026-10-01');
  assert.equal(ab.zustand, 'beendet');
  assert.equal(ab.aktion, null);
  assert.equal(ab.ende.datum, '2026-07-10');
  assert.equal(ab.phasen[0].zustand, 'fertig');
  assert.equal(ab.phasen[1].zustand, 'gestoppt');
  const alle = Object.fromEntries(A.SCHRITTE.filter(s => !s.auto).map(s => [s.key, '✓']));
  const fertig = A.tracker(basis(alle), '2026-10-01');
  assert.equal(fertig.zustand, 'fertig');
  assert.equal(fertig.erledigt, A.SCHRITTE.length);
  assert.ok(fertig.phasen.every(p => p.zustand === 'fertig'));
});

// ── Ticket gezogen ────────────────────────────────────────────────
test('Ticket-Tag-Phasen: vorher, heute, Nachtrag am Tag danach, dann vorbei', () => {
  assert.equal(A.ticketTagPhase('2026-10-08', '2026-10-01'), 'vorher');
  assert.equal(A.ticketTagPhase('2026-10-08', '2026-10-08'), 'heute');
  assert.equal(A.ticketTagPhase('2026-10-08', '2026-10-09'), 'nachtrag');
  assert.equal(A.ticketTagPhase('2026-10-08', '2026-10-10'), null);
});

test('Ticket gezogen von jemand anderem: Zieher wird die Person, Würfel-Zuteilung bleibt gemerkt', () => {
  const f = basis({ projekt: '✓' });                            // gewürfelt: Verena
  const p = A.ticketGezogen(f, 'Bianca', '2026-10-08', '17:00:04');
  assert.equal(p.zieher, 'Bianca');
  assert.equal(p.schritte.ticket, '2026-10-08');
  assert.equal(p.schritte.ticket_uhrzeit, '17:00:04');
  assert.equal(p.schritte.zieher_geplant, 'Verena');
  assert.equal(f.schritte.ticket, undefined);                    // Original unverändert
  // Zurück auf die gewürfelte Person → kein Vermerk mehr
  const zurueck = A.gezogenVon(Object.assign({}, f, p), 'Verena');
  assert.equal(zurueck.zieher, 'Verena');
  assert.equal(zurueck.schritte.zieher_geplant, undefined);
});

test('Ticket gezogen ohne Namen = gewürfelte Person; vorhandenes Ticket-Datum bleibt', () => {
  const p = A.ticketGezogen(basis({ projekt: '✓', ticket: '2026-10-08' }), '', '2026-10-09', 'kaputt');
  assert.equal(p.zieher, 'Verena');
  assert.equal(p.schritte.ticket, '2026-10-08');
  assert.equal(p.schritte.ticket_uhrzeit, undefined);
  assert.equal(p.schritte.zieher_geplant, undefined);
});

test('Neu ansuchen löscht auch Uhrzeit und Würfel-Vermerk des alten Tickets', () => {
  const f = basis({ projekt: '✓', ticket: '2026-06-16', ticket_uhrzeit: '17:00:02', zieher_geplant: 'Thomas', abgelehnt: '2026-07-10' }, { foerdercall: '2026-06-16' });
  const p = A.neuAnsuchen(f, '2026-10-01');
  assert.equal(p.schritte.ticket_uhrzeit, undefined);
  assert.equal(p.schritte.zieher_geplant, undefined);
});

// ── Export und täglicher Lauf ─────────────────────────────────────
test('Edge Functions nutzen dieselben Regeln (Kopien aus js/ sind aktuell)', () => {
  const fs = require('node:fs'), path = require('node:path');
  [['supabase/functions/foerder-taeglich', 'ablauf.js'], ['supabase/functions/oemag', 'ablauf.js'], ['supabase/functions/oemag', 'oemag.js'],
   ['web/lib/regeln', 'ablauf.js']].forEach(([ort, datei]) => {
    const original = fs.readFileSync(path.join(__dirname, '../js', datei), 'utf8');
    const kopie = fs.readFileSync(path.join(__dirname, '..', ort, datei), 'utf8');
    assert.equal(kopie, original, `Bitte js/${datei} nach ${ort}/ kopieren`);
  });
});

test('Export-Zeile: Datum deutsch, Ticket-Uhrzeit, nächste Frist', () => {
  const z = A.exportZeile(basis({ projekt: '2026-09-20', ticket: '2026-10-08', ticket_uhrzeit: '17:00:04' }), '2026-10-09');
  assert.equal(z['Fördercall'], '08.10.2026');
  assert.equal(z['Ticket gezogen'], '08.10.2026');
  assert.equal(z['Ticket gezogen um'], '17:00:04');
  assert.equal(z['Nächster Schritt'], 'Antrag im Portal einreichen');
  assert.equal(z['Nächste Frist'], 'Antrag einreichen: 22.10.2026');
});

test('CSV für Excel: BOM, Strichpunkt, Komma-Zahlen, keine Formeln', () => {
  const t = A.csv([{ Kunde: 'Huber; "Sepp"', kWp: 9.9, Notiz: '=HYPERLINK("x")' }]);
  assert.ok(t.startsWith('﻿Kunde;kWp;Notiz\r\n'));
  assert.ok(t.includes('"Huber; ""Sepp"""'));
  assert.ok(t.includes(';9,9;'));
  assert.ok(t.includes(`"'=HYPERLINK(""x"")"`));
});

test('Überfällige Fristen für den Lauf: nur echte Daten in der Vergangenheit, nichts aus dem Papierkorb', () => {
  const vorbei = basis({ projekt: '✓' }, { foerdercall: '2026-06-16' });           // Ticket verpasst
  const geloescht = basis({ projekt: '✓' }, { foerdercall: '2026-06-16', geloescht_am: '2026-07-01' });
  const ok = basis({ projekt: '✓' });                                               // Ticket erst am 08.10.
  const v = A.verpassteFristen([vorbei, geloescht, ok], '2026-10-01');
  assert.equal(v.length, 1);
  assert.equal(v[0].frist.art, 'ticket');
  assert.ok(v[0].frist.tage < 0);
});

// ── Pflichtfelder und abgelehnte Förderungen ──────────────────────
test('Für das Ticket reichen Name und Zählpunkt; der Rest ist Hinweis für den Antrag', () => {
  const knapp = { kunde: 'Huber Sepp', zaehlpunkt: 'AT0030000000000000000000000000123', foerdercall: '2026-10-08', schritte: { projekt: '✓' } };
  assert.deepEqual(A.fehlendeDaten(knapp), []);
  assert.deepEqual(A.datenFehlen(knapp, '2026-10-01'), []);
  assert.equal(A.aufgabe(knapp, A.status(knapp, '2026-10-01')).key, 'ticket');
  assert.deepEqual(A.antragDatenFehlen(knapp), ['Straße', 'PLZ', 'Ort', 'Mail', 'kWp']);
  assert.deepEqual(A.fehlendeDaten({ kunde: 'Huber Sepp', zaehlpunkt: '' }), ['Zählpunkt']);
  // nach dem Einreichen kein Hinweis mehr
  assert.deepEqual(A.antragDatenFehlen(Object.assign({}, knapp, { schritte: { eingereicht: '2026-10-09' } })), []);
  // reiner Speicher braucht Speicher statt kWp
  assert.ok(A.antragDatenFehlen({ art: 'Speicher', schritte: {} }).includes('Speicher'));
});

test('Neu ansuchen: Jahr folgt dem neuen Call, Ablehnungsdatum bleibt im Verlauf', () => {
  const f = basis({ projekt: '✓', ticket: '2025-10-08', eingereicht: '2025-10-09', abgelehnt: '2025-12-02' }, { jahr: 2025, foerdercall: '2025-10-08' });
  const p = A.neuAnsuchen(f, '2026-10-01');
  assert.equal(p.foerdercall, '2026-10-08');
  assert.equal(p.jahr, 2026);
  assert.equal(p.schritte.frueher_abgelehnt, '2025-10-08');
  assert.equal(p.schritte.frueher_abgelehnt_am, '2025-12-02');
  const neu = Object.assign({}, f, p);
  const v = A.ansuchen(neu, '2026-10-01');
  assert.deepEqual(v.map(x => [x.call, x.ergebnis, x.datum]), [['2025-10-08', 'abgelehnt', '2025-12-02'], ['2026-10-08', 'laufend', null]]);
});

test('Jahresansicht zeigt abgelehnte aus Vorjahren, solange noch angesucht werden kann', () => {
  const alt = basis({ projekt: '✓', abgelehnt: '2025-12-02' }, { jahr: 2025, foerdercall: '2025-10-08' });
  assert.equal(A.imJahr(alt, '2026', '2026-10-01'), true);      // Call 08.10. offen
  assert.equal(A.imJahr(alt, '2026', '2026-10-23'), false);     // kein Call mehr
  assert.equal(A.imJahr(alt, '2025', '2026-10-01'), true);
  const umgezogen = basis({ projekt: '✓' }, { jahr: 2025, foerdercall: '2026-10-08' });   // alter Datensatz ohne Jahr-Umzug
  assert.equal(A.imJahr(umgezogen, '2026', '2026-10-01'), true);
  assert.equal(A.imJahr(basis({}, { jahr: 2025, foerdercall: '2025-06-16' }), '2026', '2026-10-01'), false);
});

test('Ticket am Tag danach nachgetragen: Datum ist trotzdem der Calltag', () => {
  const p = A.ticketGezogen(basis({ projekt: '✓' }), 'Bianca', '2026-10-09', '');
  assert.equal(p.schritte.ticket, '2026-10-08');
  assert.equal(p.schritte.ticket_uhrzeit, undefined);
  // ohne bekannten Call: das übergebene Datum
  assert.equal(A.ticketGezogen(basis({ projekt: '✓' }, { foerdercall: '' }), 'Bianca', '2026-10-09', '').schritte.ticket, '2026-10-09');
});

test('Nachforderung zur Endabrechnung: eigene Aufgabe und 4-Wochen-Frist, nach dem Nachreichen weg', () => {
  const alle = Object.fromEntries(A.SCHRITTE.filter(s => !s.auto && s.key !== 'ausgezahlt').map(s => [s.key, '2026-07-01']));
  const f = basis(Object.assign({}, alle, { nachforderung_abrechnung: '2026-08-03' }));
  const st = A.status(f, '2026-08-10');
  assert.equal(st.nachforderungAbrechnungOffen, true);
  assert.equal(A.aufgabe(f, st).key, 'nachgereicht_abrechnung');
  const [fr] = A.fristen(f, '2026-08-10');
  assert.equal(fr.art, 'nachforderung_abrechnung');
  assert.equal(fr.datum, '2026-08-31');
  f.schritte.nachgereicht_abrechnung = '2026-08-20';
  assert.equal(A.aufgabe(f).key, 'ausgezahlt');           // wieder: Auszahlung abwarten
  assert.equal(A.fristen(f, '2026-08-21').some(x => x.art === 'nachforderung_abrechnung'), false);
});
