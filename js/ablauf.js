// Ablauf einer Förderung: Schritte, Status, Fristen, Prüfungen.
// Rein – ohne Seite, ohne Datenbank. Läuft im Browser (window.EAG_ABLAUF)
// und in Node für die automatischen Tests (node --test).
(function (wurzel) {
  'use strict';

  // ---------------------------------------------------------------
  // Phasen und Schritte
  // ---------------------------------------------------------------
  const PHASEN = [
    { key: 'vor', label: 'Vorbereitung' },
    { key: 'call', label: 'Call' },
    { key: 'zusage', label: 'Zusage' },
    { key: 'bau', label: 'Umsetzung' },
    { key: 'abrechnung', label: 'Abrechnung' }
  ];

  // Hauptschritte in der Reihenfolge, in der sie passieren müssen.
  // auto   = ergibt sich aus den Daten, wird nicht abgehakt
  // warten = die Förderstelle ist dran
  // neu    = gab es in alten Datensätzen nicht – fehlt er, ist das keine Lücke
  const SCHRITTE = [
    { key: 'daten', phase: 'vor', label: 'Daten erfasst', todo: 'Daten erfassen', knopf: 'Ergänzen', kurz: 'Daten', auto: true },
    { key: 'projekt', phase: 'vor', label: 'Projekt im EAG-Portal angelegt', todo: 'Projekt im EAG-Portal anlegen', knopf: 'Projekt angelegt', kurz: 'Projekt',
      hilfe: 'Geht schon vor dem Call und spart am Ticket-Tag Zeit.' },
    { key: 'ticket', phase: 'call', label: 'Ticket gezogen', todo: 'Ticket ziehen', knopf: 'Ticket gezogen', kurz: 'Ticket',
      hilfe: 'Nur am ersten Calltag ab 17:00 Uhr. Bei Kategorie A und B zählt die Sekunde.' },
    { key: 'eingereicht', phase: 'call', label: 'Antrag eingereicht', todo: 'Antrag im Portal einreichen', knopf: 'Eingereicht', kurz: 'Eingereicht',
      hilfe: 'Bis zum letzten Calltag, sonst verfällt das Ticket.' },
    { key: 'vertrag_erhalten', phase: 'zusage', label: 'Fördervertrag erhalten', todo: 'Fördervertrag abwarten', knopf: 'Vertrag erhalten', kurz: 'Vertrag da',
      warten: 'Warten auf Fördervertrag', hilfe: 'Mit Datum eintragen – ab da laufen die Fristen.' },
    { key: 'vertrag_versendet', phase: 'zusage', label: 'Vertrag an Kunden versendet', todo: 'Vertrag an Kunden versenden', knopf: 'Versendet', kurz: 'Vertrag versendet' },
    { key: 'inbetriebnahme', phase: 'bau', label: 'In Betrieb genommen', todo: 'Anlage in Betrieb nehmen (Fertigstellungsmeldung)', knopf: 'In Betrieb', kurz: 'In Betrieb', neu: true,
      hilfe: 'Zählt mit der Fertigstellungsmeldung an den Netzbetreiber. Frist: 6 Monate ab Vertrag, über 100 kWp 12 Monate.' },
    { key: 'herkunftsnachweis', phase: 'bau', label: 'Bei der E-Control registriert', todo: 'Anlage bei der E-Control registrieren', knopf: 'Registriert', kurz: 'E-Control', neu: true,
      hilfe: 'Herkunftsnachweis-Datenbank – ohne Registrierung keine Auszahlung.' },
    { key: 'rechnung', phase: 'abrechnung', label: 'Rechnung hochgeladen', todo: 'Rechnung hochladen', knopf: 'Hochgeladen', kurz: 'Rechnung' },
    { key: 'zahlung', phase: 'abrechnung', label: 'Zahlung hochgeladen', todo: 'Zahlungsnachweis hochladen', knopf: 'Hochgeladen', kurz: 'Zahlung',
      hilfe: 'Zu jeder Rechnung ein Zahlungsbeleg, keine Barzahlung.' },
    { key: 'abgeschlossen', phase: 'abrechnung', label: 'Endabrechnung eingereicht', todo: 'Endabrechnung einreichen', knopf: 'Eingereicht', kurz: 'Endabrechnung',
      hilfe: 'Spätestens 6 Monate nach Ende der Inbetriebnahme-Frist, sonst erlischt die Zusage.' },
    { key: 'ausgezahlt', phase: 'abrechnung', label: 'Ausgezahlt', todo: 'Auszahlung abwarten', knopf: 'Ausgezahlt', kurz: 'Ausgezahlt', warten: 'Warten auf Auszahlung' }
  ];
  const IDX = Object.fromEntries(SCHRITTE.map((s, i) => [s.key, i]));

  // Ende ohne Auszahlung – je ein Datum in schritte[key]
  const ENDE = [
    { key: 'abgelehnt', label: 'Abgelehnt / nicht gereiht' },
    { key: 'zurueckgezogen', label: 'Zurückgezogen' },
    { key: 'erloschen', label: 'Zusage erloschen' }
  ];
  // Nebenschritte (Datum in schritte[key]), nicht Teil der Hauptkette
  const NEBEN = {
    nachforderung: 'Nachforderung erhalten',
    nachgereicht: 'Unterlagen nachgereicht',
    verlaengert_bis: 'Inbetriebnahme-Frist verlängert bis',
    frueher_abgelehnt: 'Früher abgelehnt im Call'
  };

  // ---------------------------------------------------------------
  // Fördercalls: Start (Ticket ab 17:00 Uhr) → letzter Tag für den Antrag
  // ---------------------------------------------------------------
  const CALLS = {
    '2026-04-23': '2026-05-11',
    '2026-06-16': '2026-06-30',
    '2026-10-08': '2026-10-22'
  };
  const LETZTER_CALL = '2026-10-08';   // laut SOLPRO: 2027 gibt es keinen Call mehr

  // ---------------------------------------------------------------
  // Datum: immer als Text JJJJ-MM-TT, gerechnet in UTC (keine Zeitzonen-Fehler)
  // ---------------------------------------------------------------
  const istDatum = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const tagNr = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
  const ausTagNr = n => new Date(n * 864e5).toISOString().slice(0, 10);
  const plusTage = (d, n) => ausTagNr(tagNr(d) + n);
  // 31.08. + 6 Monate = 28. bzw. 29.02. (Monatsende wird nicht übersprungen)
  function plusMonate(d, n) {
    const m0 = +d.slice(5, 7) - 1 + n;
    const jahr = +d.slice(0, 4) + Math.floor(m0 / 12), monat = ((m0 % 12) + 12) % 12;
    const letzter = new Date(Date.UTC(jahr, monat + 1, 0)).getUTCDate();
    return `${jahr}-${String(monat + 1).padStart(2, '0')}-${String(Math.min(+d.slice(8, 10), letzter)).padStart(2, '0')}`;
  }
  function heuteText(jetzt) {
    const d = jetzt || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const callEnde = start => CALLS[start] || (istDatum(start) ? plusTage(start, 14) : null);

  // ---------------------------------------------------------------
  // Pflichtdaten und Status
  // ---------------------------------------------------------------
  const PFLICHT = [
    ['kunde', 'Kunde'], ['strasse', 'Straße'], ['plz', 'PLZ'], ['ort', 'Ort'],
    ['zaehlpunkt', 'Zählpunkt'], ['mail', 'Mail']
  ];
  const FELDER = [
    'jahr', 'programm', 'art', 'foerdercall', 'mitarbeiter', 'zieher', 'kunde', 'geburtsdatum', 'vollmacht',
    'strasse', 'plz', 'ort', 'kg_gst', 'zaehlpunkt', 'mail', 'projekt_nr', 'kwp', 'modulflaeche', 'einspeisung',
    'wr_leistung', 'speicher', 'anbringung', 'zeitplan', 'ticket', 'fpj', 'schritte', 'offene_punkte', 'info'
  ];

  function leer(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }

  function fehlendeDaten(f) {
    const fehlt = PFLICHT.filter(([k]) => leer(f[k])).map(([, l]) => l);
    const nurSpeicher = /^speicher$/i.test((f.art || '').trim());
    if (nurSpeicher) { if (leer(f.speicher)) fehlt.push('Speicher'); }
    else if (leer(f.kwp)) fehlt.push('kWp');
    return fehlt;
  }

  // Fehlende Kundendaten zählen nur, solange sie noch gebraucht werden: bis zum Ticket und nur,
  // solange der Call nicht vorbei ist. Bei alten oder ausgezahlten Förderungen wird nichts nachgetragen.
  function datenFehlen(f, heute) {
    const s = f.schritte || {};
    if (ENDE.some(e => !leer(s[e.key]))) return [];
    if (SCHRITTE.some((x, i) => i >= IDX.ticket && !leer(s[x.key]))) return [];
    const ende = callEnde(f.foerdercall);
    if (ende && ende < (heute || heuteText())) return [];
    return fehlendeDaten(f);
  }

  function schrittWert(f, key, heute) {
    if (key === 'daten') return datenFehlen(f, heute).length === 0 ? '✓' : '';
    const v = (f.schritte || {})[key];
    return leer(v) ? '' : v;
  }

  // Wo steht die Förderung? höchster erledigter Schritt, nächster offener danach,
  // Lücken davor, und ob sie ohne Auszahlung beendet ist.
  function status(f, heute) {
    const s = f.schritte || {};
    // Ausgezahlt ist ausgezahlt: fertig, egal was davor fehlt oder sonst angehakt ist
    if (!leer(s.ausgezahlt)) {
      return { erledigt: SCHRITTE.map(() => true), hoechster: SCHRITTE.length - 1, naechster: -1, luecken: [], ende: null, nachforderungOffen: false, fertig: true };
    }
    const ende = ENDE.find(e => !leer(s[e.key])) || null;
    const erledigt = SCHRITTE.map(x => !!schrittWert(f, x.key, heute));
    const hoechster = erledigt.lastIndexOf(true);
    let naechster = -1;
    if (!ende) for (let i = hoechster + 1; i < SCHRITTE.length; i++) if (!erledigt[i]) { naechster = i; break; }
    const luecken = [];
    for (let i = 0; i < hoechster; i++) if (!erledigt[i] && !SCHRITTE[i].auto && !SCHRITTE[i].neu) luecken.push(i);
    const nachforderungOffen = !ende && !leer(s.nachforderung) && leer(s.nachgereicht) && !erledigt[IDX.vertrag_erhalten];
    return { erledigt, hoechster, naechster, luecken, ende, nachforderungOffen, fertig: !ende && naechster === -1 };
  }

  // Was ist jetzt konkret zu tun? (Nachforderung geht vor dem Warten auf den Vertrag)
  function aufgabe(f, st) {
    st = st || status(f);
    if (st.ende || st.fertig) return null;
    if (st.nachforderungOffen) {
      return { key: 'nachgereicht', todo: 'Unterlagen nachreichen', knopf: 'Nachgereicht', kurz: 'Nachreichen', phase: 'call', neben: true };
    }
    return SCHRITTE[st.naechster];
  }

  // ---------------------------------------------------------------
  // Fristen
  // ---------------------------------------------------------------
  function stufe(tage) {
    if (tage === null) return 'unbekannt';
    if (tage < 0) return 'ueberfaellig';
    if (tage <= 7) return 'dringend';
    if (tage <= 30) return 'bald';
    return 'ruhig';
  }
  // „unbekannt“ ist leise: fehlende Daten alter Förderungen sollen nicht drängeln
  const RANG = { ueberfaellig: 0, dringend: 1, bald: 2, ruhig: 3, unbekannt: 4 };

  // Inbetriebnahme-Frist: 6 Monate ab Fördervertrag, über 100 kWp 12 Monate; Verlängerung ersetzt sie
  function inbetriebnahmeFrist(f) {
    const s = f.schritte || {};
    if (istDatum(s.verlaengert_bis)) return s.verlaengert_bis;
    if (!istDatum(s.vertrag_erhalten)) return null;
    return plusMonate(s.vertrag_erhalten, Number(f.kwp) > 100 ? 12 : 6);
  }

  // Alle offenen Fristen, dringendste zuerst. heute = 'JJJJ-MM-TT'
  function fristen(f, heute) {
    heute = heute || heuteText();
    const s = f.schritte || {};
    const st = status(f, heute);
    if (st.ende || st.fertig) return [];
    const offen = k => leer(s[k]);
    const aus = [];
    const dazu = (art, label, datum, hinweis, geschaetzt) => {
      const tage = datum ? tagNr(datum) - tagNr(heute) : null;
      aus.push({ art, label, datum, tage, stufe: stufe(tage), hinweis: hinweis || '', geschaetzt: !!geschaetzt });
    };
    const call = f.foerdercall;
    // Eine Frist gilt nur, solange kein späterer Schritt erledigt ist
    const vor = key => st.hoechster < IDX[key];
    if (istDatum(call) && vor('eingereicht')) {
      if (vor('ticket')) dazu('ticket', 'Ticket ziehen', call, 'nur an diesem Tag ab 17:00 Uhr');
      else dazu('antrag', 'Antrag einreichen', callEnde(call), 'sonst verfällt das Ticket');
    }
    if (st.nachforderungOffen && istDatum(s.nachforderung)) {
      dazu('nachforderung', 'Unterlagen nachreichen', plusTage(s.nachforderung, 28), '4 Wochen ab Nachforderung');
    }
    if (!offen('vertrag_erhalten')) {
      const ibn = inbetriebnahmeFrist(f);
      // Ohne Vertragsdatum muss niemand nachtragen: Liegt die frühestmögliche Frist (ab Callende) noch vor uns,
      // gilt sie als Schätzung – sicher, weil die echte Frist nur später sein kann. Ist sie vorbei, bleibt
      // die Frist leise „unbekannt“.
      const monate = Number(f.kwp) > 100 ? 12 : 6;
      const fruehIbn = istDatum(call) ? plusMonate(callEnde(call), monate) : null;
      const schaetzung = frueh => frueh && frueh >= heute
        ? [frueh, 'frühestens – Vertragsdatum unbekannt', true]
        : [null, 'Vertragsdatum unbekannt – Frist nicht berechenbar (Eintrag optional)', false];
      if (offen('inbetriebnahme') && vor('inbetriebnahme')) {
        if (ibn) dazu('inbetriebnahme', 'In Betrieb nehmen', ibn, istDatum(s.verlaengert_bis) ? 'verlängert' : '');
        else dazu('inbetriebnahme', 'In Betrieb nehmen', ...schaetzung(fruehIbn));
      }
      if (vor('abgeschlossen')) {
        if (ibn) dazu('endabrechnung', 'Endabrechnung einreichen', plusMonate(ibn, 6), '6 Monate nach der Inbetriebnahme-Frist');
        else dazu('endabrechnung', 'Endabrechnung einreichen', ...schaetzung(fruehIbn && plusMonate(fruehIbn, 6)));
      }
    }
    return aus.sort((a, b) => (RANG[a.stufe] - RANG[b.stufe]) || String(a.datum).localeCompare(String(b.datum)));
  }

  // ---------------------------------------------------------------
  // Abgelehnt → im nächsten offenen Call neu ansuchen
  // ---------------------------------------------------------------
  function offenerCall(heute) {
    heute = heute || heuteText();
    return Object.keys(CALLS).sort().find(c => CALLS[c] >= heute) || null;
  }

  // Ticket-Tag, der noch bevorsteht (bis einschließlich Calltag) – nur bis dahin braucht es Ticket-Zieher
  function naechsterTicketTag(heute) {
    heute = heute || heuteText();
    return Object.keys(CALLS).sort().find(c => c >= heute) || null;
  }

  // Ticket-Zieher verteilen: wer noch keinen (gültigen) Zieher hat, kommt reihum zu dem mit den wenigsten.
  // zufall(n) liefert 0..n-1 (im Browser kryptografisch, in Tests fest). Ergebnis: [{ f, zieher }]
  function zieherVerteilen(kandidaten, namen, zufall) {
    zufall = zufall || (n => Math.floor(Math.random() * n));
    const mischen = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = zufall(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const z = f => String(f.zieher || '').trim();
    const anzahl = new Map(namen.map(n => [n, 0]));
    kandidaten.forEach(f => { if (anzahl.has(z(f))) anzahl.set(z(f), anzahl.get(z(f)) + 1); });
    const reihe = mischen(namen);
    return mischen(kandidaten.filter(f => !anzahl.has(z(f)))).map(f => {
      const min = Math.min(...reihe.map(n => anzahl.get(n)));
      const n = reihe.find(x => anzahl.get(x) === min);
      anzahl.set(n, anzahl.get(n) + 1);
      return { f, zieher: n };
    });
  }

  // Liefert die Änderung (patch) oder wirft, wenn kein Call mehr offen ist
  function neuAnsuchen(f, heute) {
    const call = offenerCall(heute);
    if (!call) throw new Error('Kein Fördercall mehr offen – 2027 gibt es keinen.');
    const s = Object.assign({}, f.schritte || {});
    const frueher = (s.frueher_abgelehnt || '').split(',').map(x => x.trim()).filter(Boolean);
    if (istDatum(f.foerdercall) && f.foerdercall !== call && !frueher.includes(f.foerdercall)) frueher.push(f.foerdercall);
    ['ticket', 'eingereicht', 'abgelehnt', 'nachforderung', 'nachgereicht'].forEach(k => { delete s[k]; });
    if (frueher.length) s.frueher_abgelehnt = frueher.join(', ');
    return { foerdercall: call, ticket: '', schritte: s };
  }

  // ---------------------------------------------------------------
  // Prüfungen und Schätzungen
  // ---------------------------------------------------------------
  // Zählpunkt: AT + 6 Ziffern Netzbetreiber + 5 Ziffern PLZ + 20 Zeichen
  function zpPruefung(zp) {
    const z = String(zp || '').replace(/\s/g, '').toUpperCase();
    if (!z) return 'fehlt';
    if (/^AT\d{11}[0-9A-Z]{20}$/.test(z)) return 'ok';
    if (/^\d{11}[0-9A-Z]{20}$/.test(z)) return 'ohneAT';
    return 'ungueltig';
  }

  const SAETZE_2026 = { A: 150, B: 140, C: 130, D: 120, speicher: 150 };
  function kategorie(kwp) {
    const k = Number(kwp);
    if (!(k > 0)) return null;
    return k <= 10 ? 'A' : k <= 20 ? 'B' : k <= 100 ? 'C' : k <= 1000 ? 'D' : null;
  }
  const speicherKwh = v => { const n = parseFloat(String(v || '').replace(',', '.')); return isFinite(n) ? n : null; };
  // Zuschuss-Schätzung nach den Sätzen 2026 (C/D: Höchstsatz, ohne Made-in-Europe-Bonus)
  function zuschuss(f) {
    const kat = kategorie(f.kwp);
    if (!kat) return null;
    const kwp = Number(f.kwp), sp = speicherKwh(f.speicher);
    const speicherOk = sp !== null && sp >= 0.5 * kwp && sp <= 50;
    const pv = Math.round(kwp * SAETZE_2026[kat]);
    const speicher = speicherOk ? Math.round(sp * SAETZE_2026.speicher) : 0;
    return { kat, pv, speicher, gesamt: pv + speicher, speicherOk: sp === null ? null : speicherOk };
  }

  // ---------------------------------------------------------------
  // Vergleichen (Import / Duplikate)
  // ---------------------------------------------------------------
  const TITEL = new Set(['dr', 'ing', 'mag', 'bsc', 'msc', 'dipl', 'med', 'univ', 'ma', 'mba', 'di', 'prof', 'und', 'erweiterung', 'weg', 'z.h']);
  function nameTokens(s) {
    return (s || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .split(/[^a-z]+/).filter(t => t.length >= 3 && !TITEL.has(t));
  }
  function zpNorm(s) { return (s || '').toString().replace(/[^0-9A-Za-z]/g, '').replace(/^AT/i, '').toUpperCase(); }

  function gleicherKunde(a, b) {
    const ta = nameTokens(a.kunde), tb = new Set(nameTokens(b.kunde));
    const gemeinsam = ta.filter(t => tb.has(t)).length;
    const za = zpNorm(a.zaehlpunkt), zb = zpNorm(b.zaehlpunkt);
    const erwA = /erweiterung/i.test(a.kunde || ''), erwB = /erweiterung/i.test(b.kunde || '');
    if (erwA !== erwB) return false;
    const gleicheNr = (a.fpj && a.fpj === b.fpj) || (a.projekt_nr && a.projekt_nr.replace(/\s/g, '') === (b.projekt_nr || '').replace(/\s/g, ''));
    if (gleicheNr && gemeinsam >= 1) return true;
    if (za.length >= 20 && zb.length >= 20) return za === zb && gemeinsam >= 1;
    if (!ta.length || !tb.size) return false;
    return gemeinsam >= Math.min(2, ta.length, tb.size);
  }

  const API = {
    PHASEN, SCHRITTE, IDX, ENDE, NEBEN, CALLS, LETZTER_CALL, PFLICHT, FELDER, SAETZE_2026,
    leer, istDatum, plusTage, plusMonate, heuteText, callEnde, fehlendeDaten, datenFehlen, schrittWert, status, aufgabe,
    inbetriebnahmeFrist, fristen, offenerCall, naechsterTicketTag, zieherVerteilen, neuAnsuchen, zpPruefung, kategorie, zuschuss,
    nameTokens, zpNorm, gleicherKunde
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else wurzel.EAG_ABLAUF = API;
})(typeof window !== 'undefined' ? window : globalThis);
