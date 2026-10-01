// Fachlogik (Ablauf, Status) und Datenzugriff (Supabase bzw. Demo im Speicher)
(function () {
  'use strict';

  // Schritte, Status, Fristen und Prüfungen stehen in js/ablauf.js (getestet)
  const A = window.EAG_ABLAUF;

  // ---------------------------------------------------------------
  // Datenzugriff
  // ---------------------------------------------------------------
  function fehlerText(e) {
    if (!e) return 'Unbekannter Fehler';
    const m = e.message || String(e);
    if (/Invalid login credentials/i.test(m)) return 'E-Mail oder Passwort falsch.';
    if (/Email not confirmed/i.test(m)) return 'Bitte zuerst den Link in der Bestätigungs-Mail anklicken.';
    if (/User already registered/i.test(m)) return 'Für diese E-Mail gibt es schon ein Konto – bitte anmelden.';
    if (/Password should be at least/i.test(m)) return 'Das Passwort ist zu kurz (mind. 8 Zeichen).';
    if (/row-level security|permission denied/i.test(m)) return 'Dafür fehlt dir die Berechtigung.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Keine Verbindung zum Server.';
    return m;
  }

  function supabaseQuelle() {
    const cfg = window.EAG_CONFIG;
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const pruefe = ({ data, error }) => { if (error) throw new Error(fehlerText(error)); return data; };
    const archivRpc = ({ data, error }) => {
      if (error) {
        const e = new Error(fehlerText(error));
        e.fehlt = ['PGRST202', 'PGRST205', '42883', '42P01'].includes(error.code) || /Could not find the (function|table)/i.test(error.message || '');
        throw e;
      }
      return data;
    };

    return {
      demo: false,
      onAuth(cb) { sb.auth.onAuthStateChange((ev, session) => cb(ev, session)); },
      async session() { return pruefe(await sb.auth.getSession()).session; },
      async anmelden(mail, pw) { return pruefe(await sb.auth.signInWithPassword({ email: mail, password: pw })); },
      async registrieren(mail, pw) {
        return pruefe(await sb.auth.signUp({ email: mail, password: pw, options: { emailRedirectTo: location.origin + location.pathname } }));
      },
      async passwortVergessen(mail) {
        return pruefe(await sb.auth.resetPasswordForEmail(mail, { redirectTo: location.origin + location.pathname }));
      },
      async passwortSetzen(pw) { return pruefe(await sb.auth.updateUser({ password: pw })); },
      async abmelden() { await sb.auth.signOut(); },
      async ich(mail) {
        const rows = pruefe(await sb.from('foerder_nutzer').select('*').eq('email', (mail || '').toLowerCase()));
        return rows[0] || null;
      },
      async liste() {
        const alle = [];
        for (let von = 0; ; von += 1000) {
          const rows = pruefe(await sb.from('foerderungen').select('*').order('kunde').range(von, von + 999));
          alle.push(...rows);
          if (rows.length < 1000) break;
        }
        return alle;
      },
      async anlegen(rec) { return pruefe(await sb.from('foerderungen').insert(rec).select().single()); },
      async aendern(id, patch, stand) {
        let q = sb.from('foerderungen').update(patch).eq('id', id);
        if (stand) q = q.eq('geaendert_am', stand);
        const rows = pruefe(await q.select());
        if (!rows.length) {
          const e = new Error('KONFLIKT');
          e.konflikt = true;
          throw e;
        }
        return rows[0];
      },
      async loeschen(id) { pruefe(await sb.from('foerderungen').delete().eq('id', id)); },
      async verlauf(id) {
        return pruefe(await sb.from('foerder_verlauf').select('*').eq('foerderung_id', id).order('zeit', { ascending: false }).limit(200));
      },
      async nutzerListe() { return pruefe(await sb.from('foerder_nutzer').select('*').order('name')); },
      async offeneKonten() { return pruefe(await sb.rpc('foerder_offene_konten')); },
      async kontoAblehnen(mail) { pruefe(await sb.rpc('foerder_konto_ablehnen', { p_email: mail })); },
      async nutzerSpeichern(n) { return pruefe(await sb.from('foerder_nutzer').upsert(n).select().single()); },
      async nutzerLoeschen(mail) { pruefe(await sb.from('foerder_nutzer').delete().eq('email', mail)); },
      // OeMAG-Posteingang (sql/oemag.sql) – fehlt die Einrichtung, wirft das mit e.fehlt = true
      async posteingang() {
        return archivRpc(await sb.from('foerder_posteingang').select('*').order('empfangen_am', { ascending: false }).limit(300));
      },
      async posteingangEinfuegen(zeile) { return archivRpc(await sb.from('foerder_posteingang').insert(zeile).select().single()); },
      async posteingangStatus(id, status, foerderungId) {
        const p = { status };
        if (foerderungId !== undefined) p.foerderung_id = foerderungId;
        archivRpc(await sb.from('foerder_posteingang').update(p).eq('id', id));
      },
      async oemagAnwenden(id, aenderung, foerderungId) {
        archivRpc(await sb.rpc('foerder_oemag_anwenden', { p_id: id, p_aenderung: aenderung, p_foerderung: foerderungId || null }));
      },
      // Tägliche Sicherungen (sql/archiv.sql) – fehlt die Einrichtung, wirft das mit e.fehlt = true
      async archivListe() { return archivRpc(await sb.rpc('foerder_archiv_liste')); },
      async archivTag(tag) { return archivRpc(await sb.rpc('foerder_archiv_tag', { p_tag: tag })) || []; },
      async archivJetzt() { return archivRpc(await sb.rpc('foerder_archivieren')); },
      async archivWiederherstellen(tag, id) { archivRpc(await sb.rpc('foerder_archiv_wiederherstellen', { p_tag: tag, p_id: id })); },
      async massenAnlegen(recs) {
        const out = [];
        for (let i = 0; i < recs.length; i += 200) out.push(...pruefe(await sb.from('foerderungen').insert(recs.slice(i, i + 200)).select()));
        return out;
      }
    };
  }

  // Demo: alles im Speicher, zum Ausprobieren ohne Datenbank (?demo in der Adresse)
  function demoQuelle() {
    const jetzt = () => new Date().toISOString();
    const ich = { email: 'demo@solpro.at', name: 'Demo', rolle: 'admin' };
    let nutzer = [ich, { email: 'buero@solpro.at', name: 'Büro', rolle: 'bearbeiten' }];
    let daten = [];
    let verlauf = [];
    let wartend = [{ email: 'neu@solpro.at', registriert_am: jetzt() }];
    const kopie = o => JSON.parse(JSON.stringify(o));
    const neuId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    function beispiel() {
      const h = A.heuteText(), t = n => A.plusTage(h, n), m = n => A.plusMonate(h, n);
      const call = A.offenerCall(h) || A.LETZTER_CALL;
      const orte = [['Gmunden', '4810'], ['Bad Ischl', '4820'], ['Ebensee', '4802'], ['Vöcklabruck', '4840'], ['Lenzing', '4860'], ['Scharnstein', '4644']];
      // [Name, Call, kWp, Speicher, Schritte, Extras]
      const faelle = [
        ['Muster Max', call, 9.9, '18 kWh', {}, { zaehlpunkt: '' }],
        ['Beispiel Anna', call, 12.4, '15 kWh', {}, { zieher: '' }],
        ['Test Franz', call, 8.6, '9 kWh', {}, {}],
        ['Probe Maria', call, 14.3, '18 kWh', { projekt: t(-20) }, { fpj: 'FPJ00140001' }],
        ['Demo Karl', call, 22.1, '27 kWh', { projekt: t(-20) }, { fpj: 'FPJ00140002', offene_punkte: 'Kategorie C: Gebot festlegen' }],
        ['Sonne Eva', '2026-06-16', 11.2, '18 kWh', { projekt: '2026-06-02', abgelehnt: '2026-07-08' }, { fpj: 'FPJ00113001', zaehlpunkt: '0030000000000000000000000004711' }],
        ['Dach Peter', call, 10.6, '18 kWh', { projekt: '2026-06-03', frueher_abgelehnt: '2026-06-16', frueher_abgelehnt_am: '2026-07-08' }, { fpj: 'FPJ00113002' }],
        ['Alt Werner', '2025-10-08', 8.2, '9 kWh', { projekt: '✓', ticket: '2025-10-08', eingereicht: '2025-10-09', abgelehnt: '2025-12-02' }, { fpj: 'FPJ00090021', jahr: 2025 }],
        ['Strom Julia', '2026-06-16', 13.1, '18 kWh', { projekt: '2026-06-05', ticket: '2026-06-16', eingereicht: '2026-06-18' }, { fpj: 'FPJ00113003', ticket: 'a91f3c' }],
        ['Licht Georg', '2026-06-16', 9.2, '12 kWh', { projekt: '2026-06-05', ticket: '2026-06-16', eingereicht: '2026-06-17', nachforderung: t(-20) }, { fpj: 'FPJ00113004', ticket: 'b20e11', offene_punkte: 'Vollmacht neu unterschreiben lassen' }],
        ['Wald Sabine', '2026-04-23', 15.4, '18 kWh', { projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: m(-6).slice(0, 8) + '05' }, { fpj: 'FPJ00100005', ticket: 'c11a07' }],
        ['Berg Michael', '2026-04-23', 7.8, '9 kWh', { projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: t(-150), vertrag_versendet: t(-140) }, { fpj: 'FPJ00100006', ticket: 'c11a08' }],
        ['See Petra', '2026-04-23', 18.9, '27 kWh', { projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '✓', vertrag_versendet: '✓' }, { fpj: 'FPJ00100007', ticket: 'c11a09' }],
        ['Feld Hans', '2026-04-23', 10.1, '15 kWh', { projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: '2026-05-20', vertrag_versendet: '2026-05-22', inbetriebnahme: '2026-09-10' }, { fpj: 'FPJ00100008', ticket: 'c11a10' }],
        ['Bach Lisa', '2026-04-23', 6.4, '9 kWh', { projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: '2026-05-15', vertrag_versendet: '2026-05-18', inbetriebnahme: '2026-08-01', herkunftsnachweis: '2026-08-12', rechnung: '2026-08-20' }, { fpj: 'FPJ00100009', ticket: 'c11a11' }],
        ['Hof Martin', '2026-04-23', 16.0, '18 kWh', { projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: '2026-05-12', vertrag_versendet: '2026-05-14', inbetriebnahme: '2026-07-20', herkunftsnachweis: '2026-07-28', rechnung: '2026-08-02', zahlung: '2026-08-02', abgeschlossen: '2026-08-05' }, { fpj: 'FPJ00100010', ticket: 'c11a12' }],
        ['Wiese Clara', '2025-10-08', 11.8, '15 kWh', Object.assign(Object.fromEntries(A.SCHRITTE.filter(s => !s.auto).map(s => [s.key, '✓'])), { ausgezahlt: '2026-02-11' }), { fpj: 'FPJ00090011', ticket: 'd00b01' }],
        ['Tal Robert', '2026-06-16', 9.0, '9 kWh', { projekt: '2026-06-04', zurueckgezogen: '2026-06-12' }, { fpj: 'FPJ00113012', info: 'Kunde hat storniert' }]
      ];
      const vk = ['Manfred', 'Patrick', 'Thomas', 'Hermann'];
      const zi = ['Verena', 'Bianca', 'Thomas', 'Marion'];
      faelle.forEach(([n, c, kwp, sp, s, x], i) => {
        const [ort, plz] = orte[i % orte.length];
        daten.push(Object.assign({
          id: neuId(), jahr: +String(c).slice(0, 4), programm: 'EAG', art: 'PV + Speicher',
          foerdercall: c, mitarbeiter: vk[i % vk.length], zieher: zi[i % zi.length],
          kunde: n, geburtsdatum: '1970-0' + (1 + i % 9) + '-15', vollmacht: 'Nein', strasse: 'Musterweg ' + (i + 1), plz, ort,
          kg_gst: '', zaehlpunkt: 'AT00300000000000000000000301' + String(10000 + i * 37).slice(0, 5), mail: 'kunde' + i + '@example.at',
          projekt_nr: 'P26' + String(100 + i).padStart(4, '0'), kwp, modulflaeche: Math.round(kwp * 4.9), einspeisung: 'Überschuss',
          wr_leistung: Math.ceil(kwp) + ' kW', speicher: sp, anbringung: 'Dach', zeitplan: '',
          ticket: '', fpj: '', schritte: s, offene_punkte: '', info: '', geloescht_am: null,
          erstellt_am: jetzt(), erstellt_von: 'Demo', geaendert_am: jetzt(), geaendert_von: 'Demo'
        }, x));
      });
    }
    beispiel();
    // Demo-Sicherungen: gestern (eine Förderung anders, eine noch vorhanden, die es heute nicht mehr gibt)
    const hashText = t => Array.from(t).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0').repeat(8);
    const gestern = kopie(daten);
    gestern[2].kunde = gestern[2].kunde + ' (alter Name)';
    gestern.push(Object.assign(kopie(gestern[0]), { id: neuId(), kunde: 'Gelöscht Gustav' }));
    const archiv = [{ tag: A.plusTage(A.heuteText(), -1), erstellt_am: jetzt(), daten: gestern, sha256: hashText('g'), vorher_sha256: hashText('v') }];
    // Demo-Posteingang: drei OeMAG-Mails (Wortlaut wie echt, Nummern erfunden)
    const post = [];
    (function demoPost() {
      const O = window.EAG_OEMAG;
      if (!O) return;
      const julia = daten.find(d => d.kunde === 'Strom Julia'), martin = daten.find(d => d.kunde === 'Hof Martin');
      martin.eag_nr = 'EAG00051111';
      const de = d => d.split('-').reverse().join('.');
      const mails = [
        { betreff: 'Ticketziehung', datum: A.plusTage(A.heuteText(), -1) + 'T15:04:40Z',
          text: `Sehr geehrte(r) Förderwerberin/Förderwerber!\nIhr Ticket mit der Nummer 4b7e21 zum Einspeisezählpunkt ${julia.zaehlpunkt} wurde am 16.06.2026 um 17:04:35 Uhr von Ihnen gezogen.` },
        { betreff: 'Nachforderung von Unterlagen', datum: A.plusTage(A.heuteText(), -2) + 'T08:12:00Z',
          text: `Zu Ihrer Endabrechnung zu EAG00051111 mit der Zählpunktbezeichnung ${martin.zaehlpunkt} benötigen wir noch weitere Unterlagen/Informationen innerhalb der 4-Wochenfrist bis spätestens ${de(A.plusTage(A.heuteText(), 26))}\n\n* Leasingvertrag\n* Nachweis der Nettokapazität Stromspeicher\n\nHierzu loggen Sie sich bitte im EAG Portal ein!` },
        { betreff: 'Fördervertrag', datum: A.plusTage(A.heuteText(), -3) + 'T10:00:00Z',
          text: 'Ihr Fördervertrag zur Zählpunktbezeichnung AT0030000000000000000000030199999 steht im Portal bereit.' }
      ];
      mails.forEach((m, i) => {
        const r = O.verarbeiten(m, daten);
        post.push({ id: i + 1, message_id: 'demo-' + i, quelle: 'postfach', empfangen_am: m.datum, absender: 'noreply@oemag.at', betreff: m.betreff, text: m.text,
          art: r.erkannt.art, sicher: r.erkannt.sicher, erkannt: r.erkannt, foerderung_id: r.foerderung ? r.foerderung.id : null, zuordnung: r.zuordnung,
          kandidaten: r.kandidaten, automatisch: r.automatisch, vorschlag: r.vorschlag, notizen: r.notizen, status: r.status });
        if (r.foerderung && Object.keys(r.automatisch).length) Object.assign(r.foerderung, O.anwenden(r.foerderung, r.automatisch), { geaendert_von: 'OeMAG-Mail' });
      });
    })();
    function logge(id, aktion, diff) { verlauf.unshift({ id: verlauf.length + 1, foerderung_id: id, zeit: jetzt(), von: ich.name, aktion, aenderungen: diff || {} }); }
    let authCb = null;
    let angemeldet = true;
    return {
      demo: true,
      onAuth(cb) { authCb = cb; },
      async session() { return angemeldet ? { user: { email: ich.email } } : null; },
      async anmelden() { angemeldet = true; authCb && authCb('SIGNED_IN', { user: { email: ich.email } }); },
      async registrieren() { },
      async passwortVergessen() { },
      async passwortSetzen() { },
      async abmelden() { angemeldet = false; authCb && authCb('SIGNED_OUT', null); },
      async ich() { return kopie(ich); },
      async liste() { return kopie(daten); },
      async anlegen(rec) {
        const r = Object.assign({ id: neuId(), schritte: {}, geloescht_am: null }, kopie(rec), { erstellt_am: jetzt(), erstellt_von: ich.name, geaendert_am: jetzt(), geaendert_von: ich.name });
        daten.push(r); logge(r.id, 'angelegt'); return kopie(r);
      },
      async aendern(id, patch, stand) {
        const r = daten.find(d => d.id === id);
        if (!r || (stand && r.geaendert_am !== stand)) { const e = new Error('KONFLIKT'); e.konflikt = true; throw e; }
        const diff = {};
        Object.keys(patch).forEach(k => { if (JSON.stringify(r[k]) !== JSON.stringify(patch[k])) diff[k] = [r[k], patch[k]]; });
        Object.assign(r, kopie(patch), { geaendert_am: jetzt(), geaendert_von: ich.name });
        if (Object.keys(diff).length) logge(id, 'geändert', diff);
        return kopie(r);
      },
      async loeschen(id) { daten = daten.filter(d => d.id !== id); },
      async verlauf(id) { return kopie(verlauf.filter(v => v.foerderung_id === id)); },
      async nutzerListe() { return kopie(nutzer); },
      async offeneKonten() { return kopie(wartend); },
      async kontoAblehnen(mail) { wartend = wartend.filter(k => k.email !== mail); },
      async nutzerSpeichern(n) { nutzer = nutzer.filter(x => x.email !== n.email).concat([n]); wartend = wartend.filter(k => k.email !== n.email); return kopie(n); },
      async nutzerLoeschen(mail) { nutzer = nutzer.filter(x => x.email !== mail); },
      async massenAnlegen(recs) { const out = []; for (const r of recs) out.push(await this.anlegen(r)); return out; },
      async posteingang() { return kopie(post.slice().sort((a, b) => b.empfangen_am.localeCompare(a.empfangen_am))); },
      async posteingangEinfuegen(zeile) {
        if (post.some(p => p.message_id === zeile.message_id)) throw new Error('Diese Mail ist schon im Posteingang.');
        const z = Object.assign({ id: post.length + 1, empfangen_am: jetzt(), status: 'offen', automatisch: {}, vorschlag: {}, notizen: [], kandidaten: [] }, kopie(zeile));
        post.push(z); return kopie(z);
      },
      async posteingangStatus(id, status, foerderungId) {
        const z = post.find(p => p.id === id); z.status = status; if (foerderungId !== undefined) z.foerderung_id = foerderungId;
      },
      async oemagAnwenden(id, aenderung, foerderungId) {
        const z = post.find(p => p.id === id);
        const fid = foerderungId || z.foerderung_id;
        const r = daten.find(d => d.id === fid);
        if (!r) throw new Error('Keine Förderung zugeordnet');
        const patch = window.EAG_OEMAG.anwenden(r, aenderung);
        if (Object.keys(patch).length) await this.aendern(fid, patch);
        r.geaendert_von = 'OeMAG-Mail';
        if (foerderungId && foerderungId !== z.foerderung_id) z.zuordnung = 'hand';
        z.foerderung_id = fid; z.status = 'angewendet';
      },
      async archivListe() { return archiv.map(a => ({ tag: a.tag, erstellt_am: a.erstellt_am, anzahl: a.daten.length, sha256: a.sha256, vorher_sha256: a.vorher_sha256, datei: a.tag + '.json', versendet_am: a.erstellt_am })); },
      async archivTag(tag) { const a = archiv.find(x => x.tag === tag); return a ? kopie(a.daten) : []; },
      async archivJetzt() {
        const tag = A.heuteText();
        if (!archiv.some(a => a.tag === tag)) archiv.unshift({ tag, erstellt_am: jetzt(), daten: kopie(daten), sha256: hashText(tag + daten.length), vorher_sha256: archiv[0] ? archiv[0].sha256 : null });
        return tag;
      },
      async archivWiederherstellen(tag, id) {
        const alt = (archiv.find(a => a.tag === tag) || { daten: [] }).daten.find(d => d.id === id);
        if (!alt) throw new Error('In dieser Sicherung gibt es die Förderung nicht.');
        const r = daten.find(d => d.id === id);
        if (r) Object.assign(r, kopie(alt), { geaendert_am: jetzt(), geaendert_von: ich.name }); else daten.push(Object.assign(kopie(alt), { geaendert_am: jetzt() }));
        logge(id, 'aus Sicherung ' + tag);
      }
    };
  }

  window.EAG = Object.assign({}, A, {
    OEMAG: window.EAG_OEMAG,
    fehlerText,
    quelle: /[?&]demo\b/.test(location.search) ? demoQuelle() : supabaseQuelle()
  });
})();
