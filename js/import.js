// Import der bisherigen Excel-Förderliste. Läuft komplett im Browser –
// die Datei verlässt den Rechner nur als Datensätze in die eigene Datenbank.
(function () {
  'use strict';
  const { SCHRITTE, leer, gleicherKunde, zpNorm, neuAnsuchen, offenerCall, heuteText } = window.EAG;

  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]/g, '');
  }

  // Spaltenüberschrift → Feld
  function spalte(h) {
    const n = norm(h);
    const exakt = {
      mitarbeiter: 'mitarbeiter', kunde: 'kunde', vollmacht: 'vollmacht', strasse: 'strasse', plz: 'plz', ort: 'ort',
      mail: 'mail', projekt: 'projekt_nr', zeitplan: 'zeitplan', ticket: 'ticket', info: 'info',
      eingereichtimportal: 's:eingereicht', artderfoerderung: 'art', ticketgezogendatum: 's:ticket',
      projektangelegt: 'fpj', rghochgeladen: 's:rechnung', zahlunghochgeladen: 's:zahlung',
      genehmigt: 's:vertrag_erhalten', abgeschlossen: 's:abgeschlossen', ausgezahlt: 's:ausgezahlt',
      vertragversendet: 's:vertrag_versendet'
    };
    if (exakt[n]) return exakt[n];
    if (n.startsWith('gebdat')) return 'geburtsdatum';
    if (n.startsWith('kg')) return 'kg_gst';
    if (n.includes('zaehlpunkt')) return 'zaehlpunkt';
    if (n.startsWith('modulgroesse') || n.startsWith('modulflaeche')) return 'modulflaeche';
    if (n.startsWith('groesse')) return 'kwp';
    if (n.startsWith('ueberschuss')) return 'einspeisung';
    if (n.startsWith('wrnenn')) return 'wr_leistung';
    if (n.startsWith('speicher')) return 'speicher';
    if (n.startsWith('anbringung')) return 'anbringung';
    if (n.startsWith('offenepun')) return 'offene_punkte';
    return null;
  }

  const pad = n => String(n).padStart(2, '0');
  function serienDatum(n) {
    const d = window.XLSX.SSF.parse_date_code(n);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
  }
  // Datum aus Zahl (Excel), "dd.mm.yyyy" oder "dd.mm.yy" im Text
  function datum(v) {
    if (typeof v === 'number' && v > 1000 && v < 80000) return serienDatum(v);
    if (typeof v === 'string') {
      const m = v.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
      if (m) {
        let y = +m[3]; if (y < 100) y += 2000;
        return `${y}-${pad(m[2])}-${pad(m[1])}`;
      }
    }
    return null;
  }
  function text(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  }
  function zahl(v) {
    if (typeof v === 'number') return v;
    const t = text(v).replace(/[^0-9,.-]/g, '').replace(',', '.');
    const n = parseFloat(t);
    return isFinite(n) ? n : null;
  }
  function art(v) {
    const t = text(v).toLowerCase();
    if (!t) return '';
    const pv = /pv/.test(t), sp = /speicher/.test(t);
    if (pv && sp) return 'PV + Speicher';
    if (sp) return 'Speicher';
    if (pv) return 'PV';
    return null; // kein erkennbarer Wert → als Notiz
  }
  function einspeisung(v) {
    const t = text(v).toLowerCase();
    if (!t) return '';
    if (t.startsWith('ü') || t.startsWith('ue') || t.includes('überschuss')) return 'Überschuss';
    if (t.startsWith('v')) return 'Volleinspeisung';
    return text(v);
  }
  // Schritt-Zelle: Datum → Datum, Häkchen/JA → ✓, sonst Text (als Notiz)
  function schritt(v) {
    if (v === null || v === undefined || v === '') return { wert: '' };
    if (typeof v === 'number' && v > 0 && v < 1) return { wert: '✓' }; // nur Uhrzeit eingetragen
    const d = datum(v);
    if (d) return { wert: d };
    const t = text(v);
    if (/^(✓|✔|x\b|ja\b|erledigt|ok\b)/i.test(t)) return { wert: d2(t) || '✓' };
    if (/^(nein|-)$/i.test(t)) return { wert: '' };
    return { wert: '', notiz: t };
  }

  // Datum hinter einem Häkchen, z. B. "✓ 25.06.2025"
  function d2(t) { return /\d{1,2}\.\d{1,2}\.\d{2,4}/.test(t) ? datum(t) : null; }

  // Ist ein späterer Schritt erledigt, waren die davor es auch (in Excel oft nicht eingetragen).
  // Ausnahme: Schritte, die die Excel-Liste gar nicht kennt (Inbetriebnahme, E-Control) –
  // die werden nie erfunden. "Projekt angelegt" steht vor dem Ticket: eine Portal-Nummer
  // heißt also NICHT, dass ein Ticket gezogen wurde.
  function vorherigeAbhaken(s) {
    const keys = SCHRITTE.filter(x => !x.auto && !x.neu).map(x => x.key);
    let hoechster = -1;
    keys.forEach((k, i) => { if (s[k]) hoechster = i; });
    for (let i = 0; i < hoechster; i++) if (!s[keys[i]]) s[keys[i]] = '✓';
  }

  function istHexTicket(t) { return /^[0-9a-f]{4,12}$/i.test(t); }

  function kopfZeile(zeilen) {
    for (let i = 0; i < Math.min(zeilen.length, 12); i++) {
      const r = zeilen[i] || [];
      if (r.some(c => norm(c) === 'kunde') && r.some(c => norm(c) === 'mitarbeiter')) return i;
    }
    return -1;
  }

  // Liest eine Tabelle; liefert Datensätze + Hinweise
  function leseBlatt(ws, name, versteckt, standardJahr, heute) {
    const X = window.XLSX;
    const zeilen = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    const k = kopfZeile(zeilen);
    if (k < 0) return null;
    const titel = text((zeilen[0] || [])[0]);
    const zuteilung = k === 0; // Blätter ohne Titelzeile = Aufteilung an Ticket-Zieher
    const jm = (titel + ' ' + name).match(/20\d\d/);
    const jahr = jm ? +jm[0] : standardJahr;
    const programm = /salzburg/i.test(titel + name) ? 'Land Salzburg' : 'EAG';
    const vertragDa = /vertrag erhalten/i.test(titel + ' ' + name);
    // "1 Fördercall …" im Blattnamen = erster Call dieses Jahres (wenn keine Zwischenüberschrift ein Datum liefert)
    const callNr = (titel + ' ' + name).match(/(\d)\.?\s*F(?:ö|oe)rdercall/i);
    const callAusName = callNr ? (Object.keys(window.EAG.CALLS).sort().filter(c => c.startsWith(String(jahr))))[+callNr[1] - 1] || null : null;
    const map = (zeilen[k] || []).map(spalte);
    const spB = map.indexOf('kunde');
    const recs = [], hinweise = [];
    let call = callAusName, artVorgabe = /speicher/i.test(name) ? 'Speicher' : '';

    for (let zi = k + 1; zi < zeilen.length; zi++) {
      const r = zeilen[zi] || [];
      const gefuellt = r.map((c, i) => (text(c) !== '' ? i : -1)).filter(i => i >= 0);
      if (!gefuellt.length) continue;
      // Zwischenüberschrift (z. B. Datum des Fördercalls)
      if (gefuellt.length === 1 && gefuellt[0] === 0) {
        const d = datum(r[0]);
        if (d) call = d;
        else if (/speicher/i.test(text(r[0]))) artVorgabe = 'Speicher';
        continue;
      }
      const kunde = text(r[spB]);
      if (!kunde || kunde.includes('@')) continue;

      const f = {
        jahr, programm, art: artVorgabe, foerdercall: zuteilung ? null : call, mitarbeiter: '', zieher: zuteilung ? name.trim() : '',
        kunde, geburtsdatum: null, vollmacht: '', strasse: '', plz: '', ort: '', kg_gst: '', zaehlpunkt: '', mail: '',
        projekt_nr: '', kwp: null, modulflaeche: null, einspeisung: '', wr_leistung: '', speicher: '', anbringung: '',
        zeitplan: '', ticket: '', fpj: '', schritte: {}, offene_punkte: '', info: ''
      };
      const notizen = [], punkte = [];
      const zeilenName = `${name} Zeile ${zi + 1}`;
      map.forEach((feld, i) => {
        if (!feld || feld === 'kunde') return;
        const v = r[i];
        if (v === null || v === undefined || text(v) === '') return;
        if (feld.startsWith('s:')) {
          const key = feld.slice(2);
          const s = schritt(v);
          if (key === 'eingereicht' && s.notiz) return; // "nein" o. ä.
          if (s.wert) f.schritte[key] = s.wert;
          if (s.notiz) notizen.push(`${SCHRITTE.find(x => x.key === key).label}: ${s.notiz}`);
          return;
        }
        switch (feld) {
          case 'geburtsdatum': {
            const d = datum(v);
            if (d) f.geburtsdatum = d; else notizen.push('Geb.-Datum: ' + text(v));
            break;
          }
          case 'kwp': case 'modulflaeche': {
            const n = zahl(v);
            if (n !== null && typeof v === 'number') f[feld] = Math.round(n * 1000) / 1000;
            else if (n !== null && /^[\d\s.,]+(kwp|m²|m2)?$/i.test(text(v))) f[feld] = n;
            else notizen.push((feld === 'kwp' ? 'kWp: ' : 'Modulfläche: ') + text(v));
            break;
          }
          case 'zaehlpunkt':
            if (typeof v === 'number') {
              punkte.push('Zählpunkt prüfen – in Excel als Zahl gespeichert, Stellen sind verloren gegangen');
              hinweise.push(`${zeilenName} (${kunde}): Zählpunkt war als Zahl gespeichert (${text(v)}) – bitte in der App nachtragen.`);
            } else if (zpNorm(v).length >= 20) f.zaehlpunkt = text(v).replace(/\s/g, '');
            else notizen.push('Zählpunkt-Feld: ' + text(v));
            break;
          case 'ticket': {
            const t = text(v);
            if (istHexTicket(t)) f.ticket = t; else notizen.push('Ticket: ' + t);
            break;
          }
          case 'fpj': {
            const t = text(v);
            if (/^fpj/i.test(t)) { f.fpj = t.toUpperCase(); f.schritte.projekt = f.schritte.projekt || '✓'; }
            else if (schritt(v).wert) f.schritte.projekt = schritt(v).wert;
            else notizen.push('Projekt angelegt: ' + t);
            break;
          }
          case 'art': { const a = art(v); if (a === null) notizen.push('Art: ' + text(v)); else f.art = a; break; }
          case 'einspeisung': f.einspeisung = einspeisung(v); break;
          case 'plz': f.plz = text(typeof v === 'number' ? Math.round(v) : v); break;
          case 'wr_leistung': f.wr_leistung = typeof v === 'number' ? (v >= 1000 ? v / 1000 : v) + ' kW' : text(v); break;
          case 'speicher': f.speicher = typeof v === 'number' ? v + ' kWh' : text(v); break;
          case 'offene_punkte': {
            const t = text(v);
            const ibn = /\bIBN\b\D{0,3}(\d{1,2}\.\d{1,2}\.\d{2,4})/i.exec(t);   // "IBN 17.12.2025" = Inbetriebnahme
            if (ibn && datum(ibn[1])) f.schritte.inbetriebnahme = datum(ibn[1]);
            punkte.push(t);
            break;
          }
          case 'info': notizen.push(text(v)); break;
          default: f[feld] = text(v);
        }
      });
      if (f.ticket && !f.schritte.ticket) f.schritte.ticket = '✓';
      if (vertragDa && !f.schritte.vertrag_erhalten) f.schritte.vertrag_erhalten = '✓';
      // grün hinterlegt = Fördervertrag erhalten (Legende der Excel-Liste)
      const zelle = ws[window.XLSX.utils.encode_cell({ r: zi, c: spB })];
      const farbe = zelle && zelle.s && zelle.s.fgColor && zelle.s.fgColor.rgb;
      if (farbe && /92D050$/i.test(farbe) && !f.schritte.vertrag_erhalten) f.schritte.vertrag_erhalten = '✓';
      // orange-rot (FF572F) = in diesem Call abgelehnt → neu ansuchen (solange ein Call offen ist)
      if (farbe && /FF572F$/i.test(farbe) && f.foerdercall) {
        f._abgelehntIm = f.foerdercall;
        delete f.schritte.ticket; delete f.schritte.eingereicht;
        if (offenerCall(heute)) Object.assign(f, neuAnsuchen(f, heute));
        else f.schritte.abgelehnt = '✓';
      }
      f.info = notizen.filter(Boolean).join(' · ');
      f.offene_punkte = punkte.filter(Boolean).join(' · ');
      if (!f.art && (f.kwp || f.speicher)) f.art = f.speicher ? 'PV + Speicher' : 'PV';
      vorherigeAbhaken(f.schritte);
      f._quelle = zeilenName;
      recs.push(f);
    }
    return { name, versteckt, zuteilung, jahr, recs, hinweise };
  }

  const TEXTFELDER = ['programm', 'art', 'mitarbeiter', 'zieher', 'kunde', 'vollmacht', 'strasse', 'plz', 'ort', 'kg_gst', 'zaehlpunkt', 'mail',
    'projekt_nr', 'einspeisung', 'wr_leistung', 'speicher', 'anbringung', 'zeitplan', 'ticket', 'fpj'];

  // Füllt leere Felder von a mit Werten aus b; gibt die geänderten Felder zurück
  function ergaenze(a, b) {
    const patch = {};
    TEXTFELDER.concat(['foerdercall', 'geburtsdatum', 'kwp', 'modulflaeche']).forEach(k => {
      if (leer(a[k]) && !leer(b[k])) patch[k] = b[k];
    });
    const s = Object.assign({}, a.schritte || {});
    let sGeaendert = false;
    Object.entries(b.schritte || {}).forEach(([k, v]) => {
      if (!v) return;
      if (!s[k] || (s[k] === '✓' && v !== '✓')) { s[k] = v; sGeaendert = true; }
    });
    if (sGeaendert) patch.schritte = s;
    ['info', 'offene_punkte'].forEach(k => {
      const alt = (a[k] || '').split(' · ').filter(Boolean);
      const neu = (b[k] || '').split(' · ').filter(t => t && !alt.includes(t));
      if (neu.length) patch[k] = alt.concat(neu).join(' · ');
    });
    return patch;
  }

  // Liest die ganze Mappe und führt Einträge zusammen
  function analysiere(buffer, standardJahr, heute) {
    heute = heute || heuteText();
    const X = window.XLSX;
    const wb = X.read(buffer, { type: 'array', cellDates: false, cellStyles: true });
    const infos = (wb.Workbook && wb.Workbook.Sheets) || [];
    const blaetter = [];
    wb.SheetNames.forEach((name, i) => {
      const b = leseBlatt(wb.Sheets[name], name, !!(infos[i] && infos[i].Hidden), standardJahr, heute);
      if (b) blaetter.push(b);
    });
    const listen = blaetter.filter(b => !b.zuteilung).sort((a, b) => (a.versteckt - b.versteckt));
    const zuteil = blaetter.filter(b => b.zuteilung);
    const alle = [];
    let doppelt = 0;
    const hinweise = [];
    const aufnehmen = (f, jahrEgal) => {
      const treffer = alle.find(a => (jahrEgal || a.jahr === f.jahr) && gleicherKunde(a, f));
      if (treffer) {
        Object.assign(treffer, ergaenze(treffer, f));
        treffer._quellen.push(f._quelle);
        doppelt++;
      } else {
        f._quellen = [f._quelle];
        alle.push(f);
      }
    };
    listen.forEach(b => { b.recs.forEach(f => aufnehmen(f, false)); hinweise.push(...b.hinweise); });
    zuteil.forEach(b => {
      b.recs.forEach(f => {
        const treffer = alle.find(a => a.jahr === f.jahr && gleicherKunde(a, f)) || alle.find(a => gleicherKunde(a, f));
        if (treffer) {
          if (!treffer.zieher) treffer.zieher = f.zieher;
          else if (treffer.zieher !== f.zieher && !treffer.zieher.split(' / ').includes(f.zieher)) treffer.zieher += ' / ' + f.zieher;
          Object.assign(treffer, ergaenze(treffer, Object.assign({}, f, { zieher: '' })));
          treffer._quellen.push(f._quelle);
          doppelt++;
        } else {
          f._quellen = [f._quelle];
          alle.push(f);
        }
      });
      hinweise.push(...b.hinweise);
    });
    alle.forEach(f => vorherigeAbhaken(f.schritte));
    return {
      blaetter: blaetter.map(b => ({ name: b.name, versteckt: b.versteckt, zuteilung: b.zuteilung, anzahl: b.recs.length, jahr: b.jahr })),
      eintraege: alle, doppelt, hinweise: Array.from(new Set(hinweise))
    };
  }

  // Vergleich mit dem, was schon in der Datenbank ist
  function abgleich(eintraege, bestand, heute) {
    heute = heute || heuteText();
    const neu = [], ergaenzen = [], gleich = [];
    eintraege.forEach(f => {
      const t = bestand.find(b => !b.geloescht_am && b.jahr === f.jahr && gleicherKunde(b, f));
      if (!t) { neu.push(f); return; }
      const patch = ergaenze(t, f);
      let neuAngesucht = false;
      // In der Liste orange (abgelehnt), in der App noch im alten Call: Ticket/Einreichung zurück,
      // in den offenen Call. Nur einmal – steht der Eintrag schon im neuen Call, bleibt er.
      if (f._abgelehntIm && t.foerdercall === f._abgelehntIm && !(t.schritte || {}).frueher_abgelehnt) {
        const basis = Object.assign({}, t, patch, { schritte: Object.assign({}, t.schritte || {}, patch.schritte || {}) });
        if (offenerCall(heute)) Object.assign(patch, neuAnsuchen(basis, heute));
        else patch.schritte = Object.assign({}, basis.schritte, { abgelehnt: '✓' });
        neuAngesucht = true;
      }
      if (Object.keys(patch).length) ergaenzen.push({ ziel: t, patch, quelle: f, neuAngesucht });
      else gleich.push(f);
    });
    return { neu, ergaenzen, gleich };
  }

  function sauber(f) {
    const r = {};
    window.EAG.FELDER.forEach(k => { if (f[k] !== undefined) r[k] = f[k]; });
    return r;
  }

  window.EAG_IMPORT = { analysiere, abgleich, sauber, ergaenze, vorherigeAbhaken };
})();
