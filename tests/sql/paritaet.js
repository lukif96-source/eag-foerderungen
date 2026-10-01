// Paritätstest: Regeln in SQL (eag.stand / eag.fristen) gegen js/ablauf.js – an Zufallsdaten.
// Erzeugt Förderungen in public.foerderungen (der Spiegel legt eag.* an) und vergleicht für
// mehrere Stichtage Status, erledigte Schritte, nächsten Schritt, Lücken und alle Fristen.
// Aufruf (Datenbank vorher mit tests/sql/aufsetzen.sh aufbauen):  node tests/sql/paritaet.js [Anzahl]
'use strict';
const { spawnSync } = require('node:child_process');
const A = require('../../js/ablauf.js');

const ANZAHL = +(process.argv[2] || 400);
// Grenzen bewusst dabei: 7/8 und 30/31 Tage vor dem Ticket-Tag 08.10., Callende 22./23.10.
const STICHTAGE = ['2026-06-16', '2026-07-01', '2026-09-07', '2026-09-08', '2026-09-30', '2026-10-01', '2026-10-08',
  '2026-10-22', '2026-10-23', '2027-03-01', '2027-09-15', '2028-06-01'];

// Zufall mit festem Startwert → jeder Lauf prüft dieselben Fälle
let saat = 20261008;
const zufall = () => ((saat = (saat * 1103515245 + 12345) % 2147483648) / 2147483648);
const eins = a => a[Math.floor(zufall() * a.length)];
const tage = (d, n) => A.plusTage(d, n);

function psql(sql) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}
const q = v => v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`;

// Eine Förderung mit plausiblem Ablauf: ein zufälliger Anteil der Schritte erledigt, mit steigenden
// Daten oder „✓“; manchmal Lücken, Nebenschritte, ein Ende oder fehlende Pflichtdaten.
function erzeuge(i) {
  const call = eins(['2026-04-23', '2026-06-16', '2026-10-08', '2025-10-08', null]);
  const haupt = A.SCHRITTE.filter(x => !x.auto).map(x => x.key);
  const bis = Math.floor(zufall() * (haupt.length + 1));
  const s = {};
  let d = call || '2026-01-10';
  haupt.slice(0, bis).forEach(k => {
    d = tage(d, 1 + Math.floor(zufall() * 40));
    if (zufall() < 0.08) return;                          // Lücke
    s[k] = zufall() < 0.15 ? '✓' : (k === 'ticket' && call ? call : d);
  });
  if (s.eingereicht && !s.vertrag_erhalten && zufall() < 0.3) {
    s.nachforderung = tage(s.eingereicht === '✓' ? (call || '2026-01-10') : s.eingereicht, 5 + Math.floor(zufall() * 20));
    if (zufall() < 0.4) s.nachgereicht = tage(s.nachforderung, 10);
  }
  if (s.vertrag_erhalten && zufall() < 0.15) s.verlaengert_bis = zufall() < 0.2 ? '✓' : tage(d, 200);
  if (zufall() < 0.12) s[eins(['abgelehnt', 'zurueckgezogen', 'erloschen'])] = zufall() < 0.3 ? '✓' : tage(d, 3);
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    kunde: zufall() < 0.05 ? '' : 'Kunde ' + i,
    zaehlpunkt: zufall() < 0.1 ? '' : 'AT0030000000000000000' + String(100000000000 + i).slice(0, 12),
    kwp: eins([5.5, 9.9, 15, 99, 101, 250, null]),
    foerdercall: call, art: eins(['PV', 'PV + Speicher', 'Speicher', '']),
    strasse: zufall() < 0.3 ? '' : 'Weg ' + i, plz: '4810', ort: 'Gmunden', mail: zufall() < 0.3 ? '' : 'k' + i + '@x.at',
    speicher: eins(['', '10 kWh']), schritte: s
  };
}

const STATUS = {
  daten: 'daten_fehlen', projekt: 'projekt_anlegen', ticket: 'ticket_ziehen', eingereicht: 'antrag_einreichen',
  vertrag_erhalten: 'warten_vertrag', vertrag_versendet: 'vertrag_versenden', inbetriebnahme: 'in_betrieb_nehmen',
  herkunftsnachweis: 'econtrol_registrieren', rechnung: 'rechnung_hochladen', zahlung: 'zahlung_hochladen',
  abgeschlossen: 'endabrechnung_einreichen', ausgezahlt: 'warten_auszahlung'
};
function erwartet(f, heute) {
  const st = A.status(f, heute);
  const status = st.fertig ? 'ausgezahlt' : st.ende ? st.ende.key : st.nachforderungOffen ? 'nachreichen' : STATUS[A.SCHRITTE[st.naechster].key];
  return {
    status, erledigt: st.erledigt, naechster: st.naechster, hoechster: st.hoechster, luecken: st.luecken,
    fristen: A.fristen(f, heute).map(x => [x.art, x.datum, x.stufe, x.geschaetzt])
  };
}

const faelle = Array.from({ length: ANZAHL }, (_, i) => erzeuge(i + 1));
psql('truncate public.foerderungen cascade');
const werte = faelle.map(f => `(${q(f.id)}, ${q(f.kunde)}, ${q(f.zaehlpunkt)}, ${f.kwp === null ? 'null' : f.kwp}, ${q(f.foerdercall)}, ${q(f.art)}, ${q(f.strasse)}, ${q(f.plz)}, ${q(f.ort)}, ${q(f.mail)}, ${q(f.speicher)}, ${q(JSON.stringify(f.schritte))}::jsonb)`);
for (let i = 0; i < werte.length; i += 200) {
  psql(`insert into public.foerderungen (id, kunde, zaehlpunkt, kwp, foerdercall, art, strasse, plz, ort, mail, speicher, schritte) values ${werte.slice(i, i + 200).join(',')}`);
}
const fehler = psql('select count(*) from eag.sync_fehler').trim();
if (fehler !== '0') throw new Error('Spiegel-Fehler: ' + psql('select fehler from eag.sync_fehler limit 5'));

let geprueft = 0, abweichungen = 0;
for (const heute of STICHTAGE) {
  const zeilen = psql(`select json_agg(json_build_object('id', p.legacy_id, 'st', to_jsonb(st), 'fr',
      (select coalesce(json_agg(json_build_array(x.art, x.datum, x.stufe, x.geschaetzt)), '[]') from eag.fristen(a.id, ${q(heute)}) x)))
    from eag.antrag a join eag.projekt p on p.id = a.projekt_id
    cross join lateral eag.stand(a.id, ${q(heute)}) st
    where a.versuch = (select max(versuch) from eag.antrag b where b.projekt_id = a.projekt_id)`);
  const sql = new Map(JSON.parse(zeilen).map(r => [r.id, r]));
  for (const f of faelle) {
    const e = erwartet(f, heute), r = sql.get(f.id);
    const ist = { status: r.st.status, erledigt: r.st.erledigt, naechster: r.st.naechster, hoechster: r.st.hoechster, luecken: r.st.luecken, fristen: r.fr };
    geprueft++;
    if (JSON.stringify(ist) !== JSON.stringify(e)) {
      abweichungen++;
      if (abweichungen <= 5) console.log(`ABWEICHUNG ${f.kunde || '(ohne Name)'} am ${heute}\n  Schritte: ${JSON.stringify(f.schritte)} Call ${f.foerdercall}\n  JS : ${JSON.stringify(e)}\n  SQL: ${JSON.stringify(ist)}`);
    }
  }
}
console.log(`${geprueft} Vergleiche (${ANZAHL} Förderungen × ${STICHTAGE.length} Stichtage): ${abweichungen} Abweichungen`);
process.exit(abweichungen ? 1 : 0);
