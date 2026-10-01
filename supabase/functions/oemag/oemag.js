// OeMAG-Mails lesen: Art erkennen, Kennungen herausziehen, Förderung zuordnen, Änderung vorschlagen.
// Rein – ohne Seite, ohne Datenbank. Läuft im Browser (window.EAG_OEMAG), in der Edge Function „oemag“
// und in Node für die Tests (tests/oemag.test.js).
//
// „sicher“ = Regel an einer echten OeMAG-Mail geprüft → wird automatisch übernommen.
// Alles andere wird nur vorgeschlagen (ein Klick im Posteingang), bis ein echtes Beispiel vorliegt.
// Kennungen (EAG-Nr., Ticketnummer, FPJ) werden immer übernommen – aber nur in leere Felder.
(function (wurzel) {
  'use strict';
  const A = typeof module !== 'undefined' && module.exports ? require('./ablauf.js') : wurzel.EAG_ABLAUF;

  // Reihenfolge = Vorrang (eine Ablehnung, die „Unterlagen“ erwähnt, bleibt eine Ablehnung)
  const ARTEN = [
    { art: 'abgelehnt', sicher: true, label: 'Ablehnung',
      test: t => /kann diese leider nicht ber(ü|ue)cksichtigt werden|nicht gereiht|gilt Ihr Antrag (somit )?als zur(ü|ue)ckgezogen|wurde abgelehnt/i.test(t) },
    { art: 'nachforderung_abrechnung', sicher: true, label: 'Nachforderung zur Endabrechnung',
      test: t => /Endabrechnung/i.test(t) && /ben(ö|oe)tigen wir noch weitere Unterlagen|nachreichen|Nachforderung/i.test(t) },
    { art: 'nachforderung', sicher: false, label: 'Nachforderung zum Antrag',
      test: t => /ben(ö|oe)tigen wir noch weitere Unterlagen|Nachforderung von Unterlagen/i.test(t) },
    { art: 'ticket', sicher: true, label: 'Ticket gezogen',
      test: t => /Ihr Ticket mit der Nummer\s+[0-9a-f]{4,12}/i.test(t) },
    { art: 'ausgezahlt', sicher: false, label: 'Auszahlung',
      test: t => /Auszahlung|ausbezahlt|(ü|ue)berwiesen/i.test(t) },
    { art: 'abgeschlossen', sicher: false, label: 'Endabrechnung eingelangt',
      test: t => /Endabrechnung\b[^.]{0,80}\b(eingelangt|eingegangen|eingereicht)/i.test(t) },
    { art: 'vertrag_erhalten', sicher: false, label: 'Fördervertrag / Zusage',
      test: t => /F(ö|oe)rdervertrag|F(ö|oe)rderzusage|Zusage/i.test(t) },
    { art: 'eingereicht', sicher: false, label: 'Antrag eingereicht',
      test: t => /Eingangsbest(ä|ae)tigung|erfolgreich eingereicht|Antrag\b[^.]{0,60}\b(eingelangt|eingereicht)/i.test(t) },
    { art: 'projekt', sicher: false, label: 'Projekt im Portal angelegt',
      test: t => /Projekt\b[^.]{0,60}\b(angelegt|erfasst)/i.test(t) }
  ];
  const ART = Object.fromEntries(ARTEN.map(a => [a.art, a]));

  const pad = n => String(n).padStart(2, '0');   // für isoDatum
  const isoDatum = (d, m, y) => `${y.length === 2 ? '20' + y : y}-${pad(m)}-${pad(d)}`;

  // Mailtext ohne HTML; Kennungen werden auch gefunden, wenn sie mit Leerzeichen geschrieben sind
  function textAusHtml(html) {
    return String(html || '').replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, '\n').replace(/<li[^>]*>/gi, '\n* ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/[ \t]+/g, ' ');
  }
  // Leerzeichen zwischen Ziffern/Großbuchstaben entfernen: „AT003000 00000 … 20285“ → „AT003000…20285“
  const kompakt = t => String(t).replace(/([0-9A-Z])[^\S\r\n]+(?=[0-9A-Z])/g, '$1');

  // Weitergeleitete Mail: Datum der Originalmail aus dem Kopfblock („Gesendet: Montag, 3. August 2026 08:12“,
  // „Sent: Monday, August 3, 2026 8:12 AM“, „Datum: 03.08.2026 08:12“). Sonst null.
  const MONAT = { jänner: 1, januar: 1, january: 1, jan: 1, februar: 2, february: 2, feb: 2, märz: 3, maerz: 3, march: 3, mär: 3, mar: 3,
    april: 4, apr: 4, mai: 5, may: 5, juni: 6, june: 6, jun: 6, juli: 7, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
    oktober: 10, october: 10, okt: 10, oct: 10, november: 11, nov: 11, dezember: 12, december: 12, dez: 12, dec: 12 };
  function originalDatum(text) {
    const kopf = String(text).match(/^[ \t>]*(?:Gesendet|Sent|Datum|Date)\s*:\s*(.+)$/im);
    if (!kopf) return null;
    const z = kopf[1];
    let m = z.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (m) return isoDatum(m[1], m[2], m[3]);
    m = z.match(/(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]+)\.?\s+(\d{4})/);                       // 3. August 2026
    if (m && MONAT[m[2].toLowerCase()]) return isoDatum(m[1], MONAT[m[2].toLowerCase()], m[3]);
    m = z.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);                                  // August 3, 2026
    if (m && MONAT[m[1].toLowerCase()]) return isoDatum(m[2], MONAT[m[1].toLowerCase()], m[3]);
    return null;
  }

  function lesen(mail) {
    const betreff = String(mail.betreff || '');
    const text = String(mail.text || textAusHtml(mail.html));
    const alles = betreff + '\n' + text;
    const k = kompakt(alles);
    const typ = ARTEN.find(a => a.test(alles)) || null;

    const zp = (k.match(/AT\d{11}[0-9A-Z]{20}/) || [])[0] || null;
    const eagNr = ((k.match(/\bEAG0*\d{5,10}\b/) || [])[0] || '').toUpperCase() || null;
    const fpj = ((k.match(/\bFPJ0*\d{5,10}\b/i) || [])[0] || '').toUpperCase() || null;
    const ticket = ((alles.match(/Ticket(?: mit der Nummer|nummer| ?Nr\.?)\s*[:#]?\s*([0-9a-f]{4,12})\b/i) || [])[1] || '').toLowerCase() || null;

    // Datum des Ereignisses: beim Ticket aus dem Text („am 16.06.2026 um 17:04:35 Uhr … gezogen“), sonst Maildatum
    const gezogen = alles.match(/am (\d{1,2})\.(\d{1,2})\.(\d{2,4}) um (\d{1,2}:\d{2}(?::\d{2})?) Uhr[^.]{0,40}gezogen/i);
    // bei Weiterleitungen zählt das Datum der Originalmail
    const maildatum = originalDatum(text) || (mail.datum ? String(mail.datum).slice(0, 10) : null);
    const datum = gezogen ? isoDatum(gezogen[1], gezogen[2], gezogen[3]) : (A.istDatum(maildatum) ? maildatum : null);
    const uhrzeit = gezogen ? (gezogen[4].length === 5 ? gezogen[4] + ':00' : gezogen[4]).padStart(8, '0') : null;

    const bis = alles.match(/bis sp(ä|ae)testens (\d{1,2})\.(\d{1,2})\.(\d{2,4})/i);
    const fristBis = bis ? isoDatum(bis[2], bis[3], bis[4]) : null;
    const unterlagen = (text.match(/^[ \t]*[*•\-–][ \t]+(.+)$/gm) || []).map(z => z.replace(/^[ \t]*[*•\-–][ \t]+/, '').trim())
      .filter(z => z && !/^\[?(Registrierung|Einloggen|Projekterfassung|Antragseinreichung)/i.test(z));
    const grund = ((alles.match(/aus folgendem Grund[^:]*:\s*([^\n]+?)(?::| Gem(ä|ae)ß|\.|\n|$)/i) || [])[1] || '').trim() || null;

    return {
      art: typ ? typ.art : 'unbekannt', label: typ ? typ.label : 'Nicht erkannt', sicher: !!(typ && typ.sicher),
      eagNr, fpj, ticket, zaehlpunkt: zp, datum, uhrzeit, fristBis, unterlagen, grund
    };
  }

  // Welche Förderung? EAG-Nr. → FPJ → Zählpunkt (ohne „AT“ verglichen). Mehrere Treffer = mehrdeutig.
  function zuordnen(e, liste) {
    const aktiv = liste.filter(f => !f.geloescht_am);
    const versuche = [
      ['eag_nr', e.eagNr, f => String(f.eag_nr || '').toUpperCase() === e.eagNr],
      ['fpj', e.fpj, f => String(f.fpj || '').toUpperCase().replace(/\s/g, '') === e.fpj],
      ['zaehlpunkt', e.zaehlpunkt, f => A.zpNorm(f.zaehlpunkt) && A.zpNorm(f.zaehlpunkt) === A.zpNorm(e.zaehlpunkt)]
    ];
    for (const [ueber, wert, passt] of versuche) {
      if (!wert) continue;
      const t = aktiv.filter(passt);
      if (t.length === 1) return { f: t[0], ueber, kandidaten: t };
      if (t.length > 1) return { f: null, ueber: 'mehrdeutig', kandidaten: t };
    }
    return { f: null, ueber: null, kandidaten: [] };
  }

  // Was soll sich an der Förderung ändern? automatisch = sofort, vorschlag = mit einem Klick.
  // Nur die Unterschiede: neue Felder, neue Schritte (schritte), Text zum Anhängen (offene_punkte_plus, info_plus).
  // Zusammengeführt wird erst beim Übernehmen (anwenden() bzw. foerder_oemag_anwenden in der Datenbank) –
  // so geht nichts verloren, was inzwischen jemand anderer geändert hat.
  // Nie überschreiben: Felder nur, wenn leer; Schritte nur, wenn offen oder bisher nur „✓“.
  function aenderung(f, e) {
    const auto = {}, vorschlag = {}, notizen = [], konflikte = [];
    const s = Object.assign({}, f.schritte || {});
    const leer = k => A.leer(f[k]);
    if (e.eagNr && leer('eag_nr')) { auto.eag_nr = e.eagNr; notizen.push('EAG-Nr. ' + e.eagNr); }
    if (e.fpj && leer('fpj')) { auto.fpj = e.fpj; notizen.push(e.fpj); }
    if (e.ticket && leer('ticket')) { auto.ticket = e.ticket; notizen.push('Ticket ' + e.ticket); }
    // Widerspruch zwischen Mail und App: nicht überschreiben, aber zur Prüfung vorlegen
    [['eag_nr', e.eagNr, 'EAG-Nr.'], ['fpj', e.fpj, 'FPJ-Nr.'], ['ticket', e.ticket, 'Ticketnummer']].forEach(([k, wert, name]) => {
      if (wert && !leer(k) && String(f[k]).trim().toLowerCase() !== String(wert).toLowerCase()) {
        konflikte.push(`${name}: in der App ${String(f[k]).trim()}, laut Mail ${wert}`);
      }
    });

    const ziel = e.sicher ? auto : vorschlag;
    const schritt = (key, datum) => {
      if (!datum) return false;
      if (A.istDatum(s[key]) && s[key] === datum) return false;
      if (A.istDatum(s[key])) {
        const name = (A.SCHRITTE.find(x => x.key === key) || A.ENDE.find(x => x.key === key) || {}).label || A.NEBEN[key] || key;
        konflikte.push(`${name}: in der App ${A.datumDE(s[key])}, laut Mail ${A.datumDE(datum)}`);
        return false;
      }
      ziel.schritte = Object.assign({}, ziel.schritte, { [key]: datum });
      return true;
    };
    const punkt = t => { ziel.offene_punkte_plus = t; };
    switch (e.art) {
      case 'ticket':
        if (schritt('ticket', e.datum)) notizen.push('Ticket gezogen ' + A.datumDE(e.datum) + (e.uhrzeit ? ' ' + e.uhrzeit : ''));
        if (e.uhrzeit && !s.ticket_uhrzeit) ziel.schritte = Object.assign({}, ziel.schritte, { ticket_uhrzeit: e.uhrzeit });
        break;
      case 'abgelehnt':
        if (schritt('abgelehnt', e.datum)) {
          notizen.push('Abgelehnt' + (e.grund ? ': ' + e.grund : ''));
          if (e.grund) ziel.info_plus = 'OeMAG: ' + e.grund;
        }
        break;
      case 'nachforderung':
      case 'nachforderung_abrechnung': {
        // Frist steht in der Mail („bis spätestens …“) – Nachforderung so datieren, dass die 4-Wochen-Frist genau passt
        const am = e.fristBis ? A.plusTage(e.fristBis, -28) : e.datum;
        if (schritt(e.art, am)) {
          notizen.push(ART[e.art].label + (e.fristBis ? ' – bis ' + A.datumDE(e.fristBis) : ''));
          if (e.unterlagen.length) punkt(`Nachreichen${e.fristBis ? ' bis ' + A.datumDE(e.fristBis) : ''}: ${e.unterlagen.join('; ')}`);
        }
        break;
      }
      case 'vertrag_erhalten': case 'eingereicht': case 'ausgezahlt': case 'abgeschlossen': case 'projekt':
        if (schritt(e.art, e.datum)) notizen.push(ART[e.art].label + ' ' + A.datumDE(e.datum));
        break;
      default: break;
    }
    return { automatisch: auto, vorschlag, notizen, konflikte };
  }

  // Änderung auf den aktuellen Stand einer Förderung legen → Patch für die Datenbank (wie foerder_oemag_anwenden)
  function anwenden(f, aend) {
    const p = {};
    ['eag_nr', 'fpj', 'ticket'].forEach(k => { if (aend[k] && A.leer(f[k])) p[k] = aend[k]; });
    if (aend.schritte) p.schritte = Object.assign({}, f.schritte || {}, aend.schritte);
    const plus = (k, t) => { if (t && !String(f[k] || '').includes(t)) p[k] = [String(f[k] || '').trim(), t].filter(Boolean).join(' · '); };
    plus('offene_punkte', aend.offene_punkte_plus);
    plus('info', aend.info_plus);
    return p;
  }

  // Alles in einem Schritt (für Edge Function und „Mail einfügen“)
  function verarbeiten(mail, liste) {
    const erkannt = lesen(mail);
    const z = zuordnen(erkannt, liste);
    const a = z.f ? aenderung(z.f, erkannt) : { automatisch: {}, vorschlag: {}, notizen: [], konflikte: [] };
    const hatAuto = Object.keys(a.automatisch).length > 0, hatVorschlag = Object.keys(a.vorschlag).length > 0;
    // Widersprüche bleiben „zu prüfen“ – als Hinweis vorne in den Notizen
    a.notizen = a.konflikte.map(k => '⚠ ' + k).concat(a.notizen);
    const status = !z.f ? 'offen' : (hatVorschlag || a.konflikte.length) ? 'vorschlag' : hatAuto ? 'angewendet' : 'erledigt';
    return { erkannt, foerderung: z.f, zuordnung: z.ueber, kandidaten: z.kandidaten.map(f => f.id), ...a, status };
  }

  const API = { ARTEN, lesen, zuordnen, aenderung, anwenden, verarbeiten, textAusHtml, kompakt, originalDatum };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else wurzel.EAG_OEMAG = API;
})(typeof window !== 'undefined' ? window : globalThis);
