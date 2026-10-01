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
    { key: 'daten', phase: 'vor', label: 'Name und Zählpunkt erfasst', todo: 'Name und Zählpunkt eintragen', knopf: 'Ergänzen', kurz: 'Daten', auto: true,
      hilfe: 'Für das Ticket reichen Name und Einspeisezählpunkt – alles andere erst beim Antrag.' },
    { key: 'projekt', phase: 'vor', label: 'Projekt im EAG-Portal angelegt', todo: 'Projekt im EAG-Portal anlegen', knopf: 'Projekt angelegt', kurz: 'Projekt',
      hilfe: 'Geht schon vor dem Call und spart am Ticket-Tag Zeit.' },
    { key: 'ticket', phase: 'call', label: 'Ticket gezogen', todo: 'Ticket ziehen', knopf: 'Ticket gezogen', kurz: 'Ticket',
      hilfe: 'Nur am ersten Calltag ab 17:00 Uhr. Bei Kategorie A und B zählt die Sekunde.' },
    { key: 'eingereicht', phase: 'call', label: 'Antrag eingereicht', todo: 'Antrag im Portal einreichen', knopf: 'Eingereicht', kurz: 'Eingereicht',
      hilfe: 'Jetzt im Portal alle Daten eintragen. Bis zum letzten Calltag, sonst verfällt das Ticket.' },
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
    frueher_abgelehnt: 'Früher abgelehnt im Call',
    frueher_abgelehnt_am: 'Früher abgelehnt am',
    nochmal_ansuchen: 'Nochmal ansuchen (in der Excel orange)',
    nachforderung_abrechnung: 'Nachforderung zur Endabrechnung',
    nachgereicht_abrechnung: 'Endabrechnung: Unterlagen nachgereicht',
    ticket_uhrzeit: 'Ticket gezogen um',
    zieher_geplant: 'Ticket-Zieher laut Würfel'
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
  // Für das Ticket sind nur Name und Einspeisezählpunkt Pflicht.
  // Alles andere braucht erst der Antrag im Portal (Schritt „Antrag eingereicht“).
  const PFLICHT = [['kunde', 'Kunde'], ['zaehlpunkt', 'Zählpunkt']];
  const ANTRAG = [['strasse', 'Straße'], ['plz', 'PLZ'], ['ort', 'Ort'], ['mail', 'Mail']];
  const FELDER = [
    'jahr', 'programm', 'art', 'foerdercall', 'mitarbeiter', 'zieher', 'kunde', 'geburtsdatum', 'vollmacht',
    'strasse', 'plz', 'ort', 'kg_gst', 'zaehlpunkt', 'mail', 'projekt_nr', 'kwp', 'modulflaeche', 'einspeisung',
    'wr_leistung', 'speicher', 'anbringung', 'zeitplan', 'ticket', 'fpj', 'eag_nr', 'schritte', 'offene_punkte', 'info'
  ];

  function leer(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }

  function fehlendeDaten(f) {
    return PFLICHT.filter(([k]) => leer(f[k])).map(([, l]) => l);
  }

  // Was für den Antrag im Portal noch fehlt – ein Hinweis, keine Sperre.
  // Nur solange der Antrag noch nicht eingereicht und die Förderung nicht beendet ist.
  function antragDatenFehlen(f) {
    const s = f.schritte || {};
    if (!leer(s.eingereicht) || !leer(s.ausgezahlt) || ENDE.some(e => !leer(s[e.key]))) return [];
    const fehlt = ANTRAG.filter(([k]) => leer(f[k])).map(([, l]) => l);
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
      return { erledigt: SCHRITTE.map(() => true), hoechster: SCHRITTE.length - 1, naechster: -1, luecken: [], ende: null, nachforderungOffen: false, nachforderungAbrechnungOffen: false, fertig: true };
    }
    const ende = ENDE.find(e => !leer(s[e.key])) || null;
    const erledigt = SCHRITTE.map(x => !!schrittWert(f, x.key, heute));
    const hoechster = erledigt.lastIndexOf(true);
    let naechster = -1;
    if (!ende) for (let i = hoechster + 1; i < SCHRITTE.length; i++) if (!erledigt[i]) { naechster = i; break; }
    const luecken = [];
    for (let i = 0; i < hoechster; i++) if (!erledigt[i] && !SCHRITTE[i].auto && !SCHRITTE[i].neu) luecken.push(i);
    const nachforderungOffen = !ende && !leer(s.nachforderung) && leer(s.nachgereicht) && !erledigt[IDX.vertrag_erhalten];
    // Nachforderung der OeMAG zur Endabrechnung (eigene 4-Wochen-Frist, nur übers Portal)
    const nachforderungAbrechnungOffen = !ende && !leer(s.nachforderung_abrechnung) && leer(s.nachgereicht_abrechnung);
    return { erledigt, hoechster, naechster, luecken, ende, nachforderungOffen, nachforderungAbrechnungOffen, fertig: !ende && naechster === -1 };
  }

  // Was ist jetzt konkret zu tun? (Nachforderung geht vor dem Warten auf den Vertrag)
  function aufgabe(f, st) {
    st = st || status(f);
    if (st.ende || st.fertig) return null;
    if (st.nachforderungOffen) {
      return { key: 'nachgereicht', todo: 'Unterlagen nachreichen', knopf: 'Nachgereicht', kurz: 'Nachreichen', phase: 'call', neben: true };
    }
    if (st.nachforderungAbrechnungOffen) {
      return { key: 'nachgereicht_abrechnung', todo: 'Unterlagen zur Endabrechnung nachreichen', knopf: 'Nachgereicht', kurz: 'Nachreichen (Abrechnung)',
        phase: 'abrechnung', neben: true, hilfe: 'Nur über das EAG-Portal – per Mail oder Post zählt es nicht.' };
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
    if (st.nachforderungAbrechnungOffen && istDatum(s.nachforderung_abrechnung)) {
      dazu('nachforderung_abrechnung', 'Unterlagen zur Endabrechnung nachreichen', plusTage(s.nachforderung_abrechnung, 28), '4 Wochen ab Nachforderung, nur übers Portal');
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
  // Status-Tracker: alles, was die Kopfzeile einer Förderung braucht – in einem Objekt.
  // Wo steht sie (je Phase), was ist jetzt zu tun, wer ist dran, wie laut muss es sein.
  // Ohne HTML: dieselbe Antwort für die Seite, Tests und später andere Oberflächen.
  // ---------------------------------------------------------------
  // ton: alarm = Frist überfällig oder ≤ 7 Tage · achtung = Lücke oder ≤ 30 Tage · ruhig („unbekannt“ ist leise)
  function tracker(f, heute) {
    heute = heute || heuteText();
    const st = status(f, heute);
    const aufg = aufgabe(f, st);
    const frist = fristen(f, heute)[0] || null;
    const s = f.schritte || {};
    const schritte = SCHRITTE.map((x, i) => ({
      key: x.key, kurz: x.kurz, label: x.label,
      wert: schrittWert(f, x.key, heute),
      zustand: st.erledigt[i] ? 'fertig' : st.luecken.includes(i) ? 'luecke' : i === st.naechster ? (x.warten ? 'wartet' : 'jetzt') : 'offen'
    }));
    const phasen = PHASEN.map(p => {
      const eigene = schritte.filter((x, i) => SCHRITTE[i].phase === p.key);
      const fertig = eigene.filter(x => x.zustand === 'fertig').length;
      const zustand = st.ende ? (fertig === eigene.length ? 'fertig' : 'gestoppt')
        : eigene.some(x => x.zustand === 'luecke') ? 'luecke'
        : (aufg && aufg.phase === p.key) ? 'aktiv'
        : fertig === eigene.length ? 'fertig' : 'offen';
      return { key: p.key, label: p.label, fertig, gesamt: eigene.length, zustand, schritte: eigene };
    });
    const ton = frist && RANG[frist.stufe] <= RANG.dringend ? 'alarm'
      : (st.luecken.length || (frist && frist.stufe === 'bald')) ? 'achtung' : 'ruhig';
    const zustand = st.fertig ? 'fertig' : st.ende ? 'beendet' : aufg.warten ? 'wartet' : 'aktiv';
    return {
      zustand, ton,
      // Hauptschritt-Nummer (1-basiert); bei Nebenschritt die Stelle davor
      nummer: st.naechster >= 0 ? st.naechster + 1 : null,
      gesamt: SCHRITTE.length,
      erledigt: st.erledigt.filter(Boolean).length,
      phasen,
      aktion: aufg ? {
        key: aufg.key, todo: aufg.todo, knopf: aufg.knopf, phase: aufg.phase,
        wer: aufg.warten ? 'foerderstelle' : 'wir',
        auto: !!aufg.auto, neben: !!aufg.neben, hilfe: aufg.hilfe || ''
      } : null,
      frist,
      ende: st.ende ? { key: st.ende.key, label: st.ende.label, datum: istDatum(s[st.ende.key]) ? s[st.ende.key] : null } : null,
      luecken: st.luecken.map(i => SCHRITTE[i].label)
    };
  }

  // ---------------------------------------------------------------
  // Abgelehnt → im nächsten offenen Call neu ansuchen
  // ---------------------------------------------------------------
  function offenerCall(heute) {
    heute = heute || heuteText();
    return Object.keys(CALLS).sort().find(c => CALLS[c] >= heute) || null;
  }

  // Ticket-Tag, der noch bevorsteht – die Würfel-Matrix bleibt bis einschließlich zum Tag danach
  // (09.10. beim Call am 08.10.), damit eingetragen werden kann, wer wirklich gezogen hat.
  function naechsterTicketTag(heute) {
    heute = heute || heuteText();
    return Object.keys(CALLS).sort().find(c => plusTage(c, 1) >= heute) || null;
  }
  // 'vorher' (verteilen), 'heute' (ziehen), 'nachtrag' (Tag danach: nachtragen, wer gezogen hat), sonst null
  function ticketTagPhase(call, heute) {
    heute = heute || heuteText();
    if (!istDatum(call)) return null;
    return heute < call ? 'vorher' : heute === call ? 'heute' : heute === plusTage(call, 1) ? 'nachtrag' : null;
  }

  // Ticket gezogen: Datum, Uhrzeit (nur am Calltag sinnvoll) und wer wirklich gezogen hat.
  // Der Zieher wird zur Person, die gezogen hat; die gewürfelte Zuteilung bleibt in schritte.zieher_geplant.
  function ticketGezogen(f, von, datum, uhrzeit) {
    const s = Object.assign({}, f.schritte || {});
    const geplant = String(f.zieher || '').trim();
    von = String(von || '').trim() || geplant;
    // Tickets gibt es nur am Calltag: Wer später nachträgt (z. B. am 09.10.), trägt trotzdem den Calltag ein
    s.ticket = istDatum(s.ticket) ? s.ticket : (istDatum(f.foerdercall) && datum >= f.foerdercall ? f.foerdercall : datum);
    if (uhrzeit && /^\d{2}:\d{2}(:\d{2})?$/.test(uhrzeit)) s.ticket_uhrzeit = uhrzeit;
    if (geplant && von !== geplant && !s.zieher_geplant) s.zieher_geplant = geplant;
    if (s.zieher_geplant === von) delete s.zieher_geplant;
    return { zieher: von, schritte: s };
  }
  // Nur „wer hat gezogen“ ändern (Ticket bleibt, wie es ist)
  function gezogenVon(f, von) {
    const s = Object.assign({}, f.schritte || {});
    const geplant = s.zieher_geplant || String(f.zieher || '').trim();
    von = String(von || '').trim();
    if (geplant && von !== geplant) s.zieher_geplant = geplant; else delete s.zieher_geplant;
    return { zieher: von, schritte: s };
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

  // Liefert die Änderung (patch) oder wirft, wenn kein Call mehr offen ist.
  // Merkt sich Call UND Ablehnungsdatum (frueher_abgelehnt / frueher_abgelehnt_am, gleiche Reihenfolge)
  // und zieht das Jahr auf den neuen Call – sonst verschwindet die Förderung aus der Jahresansicht.
  function neuAnsuchen(f, heute) {
    const call = offenerCall(heute);
    if (!call) throw new Error('Kein Fördercall mehr offen – 2027 gibt es keinen.');
    const s = Object.assign({}, f.schritte || {});
    const liste = k => (s[k] || '').split(',').map(x => x.trim());
    const calls = liste('frueher_abgelehnt').filter(Boolean);
    const am = liste('frueher_abgelehnt_am').slice(0, calls.length);
    while (am.length < calls.length) am.push('');
    if (istDatum(f.foerdercall) && f.foerdercall !== call && !calls.includes(f.foerdercall)) {
      calls.push(f.foerdercall);
      am.push(istDatum(s.abgelehnt) ? s.abgelehnt : '');
    }
    ['ticket', 'ticket_uhrzeit', 'zieher_geplant', 'eingereicht', 'abgelehnt', 'nachforderung', 'nachgereicht'].forEach(k => { delete s[k]; });
    if (calls.length) {
      s.frueher_abgelehnt = calls.join(', ');
      if (am.some(Boolean)) s.frueher_abgelehnt_am = am.join(', '); else delete s.frueher_abgelehnt_am;
    }
    return { foerdercall: call, jahr: +call.slice(0, 4), ticket: '', schritte: s };
  }

  // Alle Ansuchen einer Förderung, ältestes zuerst: frühere (abgelehnt) und das aktuelle
  function ansuchen(f, heute) {
    const s = f.schritte || {};
    const calls = (s.frueher_abgelehnt || '').split(',').map(x => x.trim()).filter(Boolean);
    const am = (s.frueher_abgelehnt_am || '').split(',').map(x => x.trim());
    const aus = calls.map((c, i) => ({ call: c, ergebnis: 'abgelehnt', datum: istDatum(am[i]) ? am[i] : null, aktuell: false }));
    // In der Excel orange, früherer Call unbekannt
    if (!calls.length && !leer(s.nochmal_ansuchen)) aus.push({ call: null, ergebnis: 'abgelehnt', datum: null, aktuell: false });
    const st = status(f, heute);
    const ergebnis = st.fertig ? 'ausgezahlt' : st.ende ? st.ende.key : 'laufend';
    const datum = st.fertig ? s.ausgezahlt : st.ende ? s[st.ende.key] : null;
    aus.push({ call: istDatum(f.foerdercall) ? f.foerdercall : null, ergebnis, datum: istDatum(datum) ? datum : null, aktuell: true });
    return aus;
  }

  // Gehört die Förderung in die Jahresansicht? Eigenes Jahr, Call in diesem Jahr – und abgelehnte
  // aus früheren Jahren, solange im laufenden Jahr noch neu angesucht werden kann.
  function imJahr(f, jahr, heute) {
    jahr = String(jahr || '');
    if (!jahr) return true;
    if (String(f.jahr) === jahr || String(f.foerdercall || '').startsWith(jahr)) return true;
    heute = heute || heuteText();
    const s = f.schritte || {};
    return !leer(s.abgelehnt) && leer(s.ausgezahlt) && heute.startsWith(jahr) && !!offenerCall(heute);
  }

  // ---------------------------------------------------------------
  // Prüfungen und Schätzungen
  // ---------------------------------------------------------------
  // Fürs Ticket ohne „AT“ (31 Zeichen), im Antrag darf es davor stehen
  function zpFuersTicket(zp) { return String(zp || '').replace(/\s/g, '').toUpperCase().replace(/^AT(?=\d{11}[0-9A-Z]{20}$)/, ''); }
  // Wird „nochmal angesucht“? (früher abgelehnt oder in der Excel orange)
  function nochmal(f) { const s = f.schritte || {}; return !leer(s.frueher_abgelehnt) || !leer(s.nochmal_ansuchen); }

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

  // ---------------------------------------------------------------
  // Export: eine Zeile je Förderung mit lesbaren Spalten – für Excel in der App,
  // den Sicherungs-Download und die tägliche Archiv-Mail (CSV). Eine Stelle, gleiche Spalten.
  // ---------------------------------------------------------------
  const datumDE = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : (v || ''); };
  const listeDE = v => String(v || '').split(',').map(x => datumDE(x.trim())).filter(Boolean).join(', ');
  function exportZeile(d, heute) {
    heute = heute || heuteText();
    const s = d.schritte || {};
    const st = status(d, heute);
    const z = {
      'Jahr': d.jahr, 'Programm': d.programm, 'Fördercall': datumDE(d.foerdercall), 'Mitarbeiter': d.mitarbeiter, 'Ticket-Zieher': d.zieher,
      'Kunde': d.kunde, 'Geb. Dat': datumDE(d.geburtsdatum), 'Vollmacht': d.vollmacht, 'Straße': d.strasse, 'PLZ': d.plz, 'Ort': d.ort,
      'KG Grundstücksnummer': d.kg_gst, 'Einspeisezählpunkt': d.zaehlpunkt, 'Mail': d.mail, 'Projekt': d.projekt_nr,
      'Größe kWp': d.kwp, 'Modulfläche m²': d.modulflaeche, 'Einspeisung': d.einspeisung, 'WR Nennleistung': d.wr_leistung,
      'Speicher': d.speicher, 'Anbringung': d.anbringung, 'Zeitplan': d.zeitplan, 'Art': d.art, 'Ticket': d.ticket, 'FPJ': d.fpj,
      'EAG-Nr.': d.eag_nr || ''
    };
    SCHRITTE.filter(x => !x.auto).forEach(x => { const w = s[x.key]; z[x.label] = w ? (w === '✓' ? '✓' : datumDE(w)) : ''; });
    Object.keys(NEBEN).forEach(k => { const w = s[k]; z[NEBEN[k]] = w ? (istDatum(w) ? datumDE(w) : listeDE(w)) : ''; });
    const ew = st.ende ? s[st.ende.key] : '';
    const fr = fristen(d, heute)[0];
    z['Ergebnis'] = st.ende ? st.ende.label + (istDatum(ew) ? ' ' + datumDE(ew) : '') : '';
    z['Nächster Schritt'] = st.fertig ? 'fertig' : st.ende ? '' : aufgabe(d, st).todo;
    z['Nächste Frist'] = fr ? `${fr.label}: ${fr.datum ? datumDE(fr.datum) + (fr.geschaetzt ? ' (frühestens)' : '') : 'unbekannt'}` : '';
    z['Offene Punkte'] = d.offene_punkte; z['Info'] = d.info;
    return z;
  }
  // CSV für Excel (Österreich): Strichpunkt, UTF-8 mit BOM, Werte in Anführungszeichen, Zahlen mit Komma
  function csv(zeilen) {
    const spalten = Object.keys(zeilen[0] || {});
    const zelle = v => {
      if (v === null || v === undefined) return '';
      const t = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
      return /[";\r\n]/.test(t) || /^[=+\-@]/.test(t) ? '"' + t.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"' : t;
    };
    return String.fromCharCode(0xFEFF) + [spalten.map(zelle).join(';')].concat(zeilen.map(z => spalten.map(k => zelle(z[k])).join(';'))).join('\r\n') + '\r\n';
  }

  // Überfällige Fristen (für den täglichen Lauf): je Förderung alle Fristen mit Datum in der Vergangenheit
  function verpassteFristen(liste, heute) {
    heute = heute || heuteText();
    const aus = [];
    liste.forEach(f => {
      if (f.geloescht_am) return;
      fristen(f, heute).forEach(fr => { if (fr.datum && fr.tage < 0) aus.push({ f, frist: fr }); });
    });
    return aus;
  }

  const API = {
    PHASEN, SCHRITTE, IDX, ENDE, NEBEN, CALLS, LETZTER_CALL, PFLICHT, FELDER, SAETZE_2026,
    leer, istDatum, zpFuersTicket, nochmal, plusTage, plusMonate, heuteText, callEnde, fehlendeDaten, datenFehlen, antragDatenFehlen, ansuchen, imJahr, ANTRAG, schrittWert, status, aufgabe,
    inbetriebnahmeFrist, fristen, tracker, offenerCall, naechsterTicketTag, ticketTagPhase, ticketGezogen, gezogenVon, zieherVerteilen, neuAnsuchen, zpPruefung, kategorie, zuschuss,
    nameTokens, zpNorm, gleicherKunde, datumDE, exportZeile, csv, verpassteFristen
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else wurzel.EAG_ABLAUF = API;
})(typeof window !== 'undefined' ? window : globalThis);
