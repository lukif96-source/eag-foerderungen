// Fachlogik (Ablauf, Status) und Datenzugriff (Supabase bzw. Demo im Speicher)
(function () {
  'use strict';

  // ---------------------------------------------------------------
  // Ablauf einer Förderung. auto = wird aus den Daten abgeleitet.
  // ---------------------------------------------------------------
  const SCHRITTE = [
    { key: 'daten',             label: 'Daten erfasst',              todo: 'Daten erfassen', knopf: 'Ergänzen', kurz: 'Daten',            auto: true },
    { key: 'aufgeteilt',        label: 'Aufgeteilt',                  todo: 'Aufteilen', knopf: 'Zuteilen', kurz: 'Aufgeteilt',       auto: true },
    { key: 'ticket',            label: 'Ticket gezogen',              todo: 'Ticket ziehen', knopf: 'Ticket gezogen', kurz: 'Ticket' },
    { key: 'projekt',           label: 'Projekt angelegt',            todo: 'Projekt anlegen', knopf: 'Projekt angelegt', kurz: 'Projekt' },
    { key: 'eingereicht',       label: 'Im Portal eingereicht',       todo: 'Im Portal einreichen', knopf: 'Eingereicht', kurz: 'Eingereicht' },
    { key: 'vertrag_erhalten',  label: 'Fördervertrag erhalten',      todo: 'Vertrag abwarten', knopf: 'Vertrag erhalten', warten: 'Warten auf Fördervertrag', kurz: 'Vertrag da' },
    { key: 'vertrag_versendet', label: 'Vertrag an Kunden versendet', todo: 'Vertrag versenden', knopf: 'Versendet', kurz: 'Vertrag versendet' },
    { key: 'rechnung',          label: 'Rechnung hochgeladen',        todo: 'Rechnung hochladen', knopf: 'Hochgeladen', kurz: 'Rechnung' },
    { key: 'zahlung',           label: 'Zahlung hochgeladen',         todo: 'Zahlung hochladen', knopf: 'Hochgeladen', kurz: 'Zahlung' },
    { key: 'abgeschlossen',     label: 'Abgeschlossen',               todo: 'Abschließen', knopf: 'Abgeschlossen', kurz: 'Abgeschlossen' },
    { key: 'ausgezahlt',        label: 'Ausgezahlt',                  todo: 'Auszahlung abwarten', knopf: 'Ausgezahlt', warten: 'Warten auf Auszahlung', kurz: 'Ausgezahlt' }
  ];

  // Was vor dem Ticket-Ziehen vorhanden sein muss
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

  function schrittWert(f, key) {
    if (key === 'daten') return fehlendeDaten(f).length === 0 ? '✓' : '';
    if (key === 'aufgeteilt') return leer(f.zieher) ? '' : '✓';
    const v = (f.schritte || {})[key];
    return leer(v) ? '' : v;
  }

  // Status: höchster erledigter Schritt; "nächster" = erster offener Schritt danach
  function status(f) {
    const erledigt = SCHRITTE.map(s => !!schrittWert(f, s.key));
    const hoechster = erledigt.lastIndexOf(true);
    let naechster = -1;
    for (let i = hoechster + 1; i < SCHRITTE.length; i++) if (!erledigt[i]) { naechster = i; break; }
    const luecken = [];
    for (let i = 0; i < hoechster; i++) if (!erledigt[i] && !SCHRITTE[i].auto) luecken.push(i);
    return { erledigt, hoechster, naechster, luecken, fertig: naechster === -1 };
  }

  // ---------------------------------------------------------------
  // Hilfen zum Vergleichen (Import / Duplikate)
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
      async nutzerSpeichern(n) { return pruefe(await sb.from('foerder_nutzer').upsert(n).select().single()); },
      async nutzerLoeschen(mail) { pruefe(await sb.from('foerder_nutzer').delete().eq('email', mail)); },
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
    const kopie = o => JSON.parse(JSON.stringify(o));
    const neuId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    function beispiel() {
      const orte = [['Gmunden', '4810'], ['Bad Ischl', '4820'], ['Ebensee', '4802'], ['Vöcklabruck', '4840'], ['Lenzing', '4860'], ['Scharnstein', '4644']];
      const namen = ['Muster Max', 'Beispiel Anna', 'Test Franz', 'Probe Maria', 'Demo Karl', 'Sonne Eva', 'Dach Peter', 'Strom Julia', 'Licht Georg', 'Wald Sabine', 'Berg Michael', 'See Petra'];
      const vk = ['Manfred', 'Patrick', 'Thomas', 'Hermann'];
      const zi = ['Verena', 'Bianca', 'Thomas', 'Marion', ''];
      namen.forEach((n, i) => {
        const [ort, plz] = orte[i % orte.length];
        const s = {};
        const stufe = i % 11;
        const keys = ['ticket', 'projekt', 'eingereicht', 'vertrag_erhalten', 'vertrag_versendet', 'rechnung', 'zahlung', 'abgeschlossen', 'ausgezahlt'];
        keys.slice(0, Math.max(0, stufe - 2)).forEach((k, j) => { s[k] = '2026-0' + (6 + Math.min(3, Math.floor(j / 3))) + '-1' + j; });
        daten.push({
          id: neuId(), jahr: 2026, programm: 'EAG', art: i % 5 === 4 ? 'Speicher' : 'PV + Speicher',
          foerdercall: i < 8 ? '2026-06-16' : '2026-10-08', mitarbeiter: vk[i % vk.length], zieher: stufe >= 1 ? zi[i % zi.length] : '',
          kunde: n, geburtsdatum: '1970-0' + (1 + i % 9) + '-15', vollmacht: 'Nein', strasse: 'Musterweg ' + (i + 1), plz, ort,
          kg_gst: '', zaehlpunkt: i % 6 === 5 ? '' : 'AT00300000000000000000000301' + String(10000 + i * 37).slice(0, 5), mail: i % 7 === 6 ? '' : 'kunde' + i + '@example.at',
          projekt_nr: 'P26' + String(100 + i).padStart(4, '0'), kwp: 8 + i * 0.75, modulflaeche: 40 + i * 3, einspeisung: 'Überschuss',
          wr_leistung: '10 kW', speicher: '18 kWh', anbringung: 'Dach', zeitplan: ['März', 'April', 'Mai'][i % 3],
          ticket: stufe >= 3 ? 'a' + (1000 + i).toString(16) : '', fpj: stufe >= 4 ? 'FPJ0011' + (3000 + i) : '', schritte: s,
          offene_punkte: i % 4 === 1 ? 'Vollmacht fehlt noch' : '', info: '', geloescht_am: null,
          erstellt_am: jetzt(), erstellt_von: 'Demo', geaendert_am: jetzt(), geaendert_von: 'Demo'
        });
      });
    }
    beispiel();
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
      async nutzerSpeichern(n) { nutzer = nutzer.filter(x => x.email !== n.email).concat([n]); return kopie(n); },
      async nutzerLoeschen(mail) { nutzer = nutzer.filter(x => x.email !== mail); },
      async massenAnlegen(recs) { const out = []; for (const r of recs) out.push(await this.anlegen(r)); return out; }
    };
  }

  window.EAG = {
    SCHRITTE, PFLICHT, FELDER, leer, fehlendeDaten, schrittWert, status, nameTokens, zpNorm, gleicherKunde, fehlerText,
    quelle: /[?&]demo\b/.test(location.search) ? demoQuelle() : supabaseQuelle()
  };
})();
