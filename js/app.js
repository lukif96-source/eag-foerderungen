(function () {
  'use strict';
  const E = window.EAG;
  const Q = E.quelle;
  const { SCHRITTE } = E;
  // Bezeichnung jedes Schlüssels in "schritte" (Hauptschritte, Ende, Nebenschritte)
  const ALLE_LABEL = Object.assign({}, ...SCHRITTE.map(x => ({ [x.key]: x.label })), ...E.ENDE.map(x => ({ [x.key]: x.label })), E.NEBEN);
  // Gruppen der Übersicht: jeder Schritt, dazu "Unterlagen nachreichen" vor dem Warten auf den Vertrag
  const GRUPPEN = SCHRITTE.flatMap(x => x.key === 'vertrag_erhalten'
    ? [{ key: 'nachgereicht', todo: 'Unterlagen nachreichen', kurz: 'Nachreichen', phase: 'call', neben: true }, x] : [x]);

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const heute = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const datumDE = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : (v || ''); };
  const zahlDE = v => (v === null || v === undefined || v === '') ? '' : Number(v).toLocaleString('de-AT', { maximumFractionDigits: 2 });
  const speicherLokal = {
    lesen(k, std) { try { const v = localStorage.getItem('eag_' + k); return v === null ? std : JSON.parse(v); } catch (e) { return std; } },
    schreiben(k, v) { try { localStorage.setItem('eag_' + k, JSON.stringify(v)); } catch (e) { /* egal */ } }
  };

  const FELD_LABEL = {
    jahr: 'Jahr', programm: 'Programm', art: 'Art', foerdercall: 'Fördercall', mitarbeiter: 'Mitarbeiter', zieher: 'Ticket-Zieher',
    kunde: 'Kunde', geburtsdatum: 'Geb.-Datum', vollmacht: 'Vollmacht', strasse: 'Straße', plz: 'PLZ', ort: 'Ort', kg_gst: 'KG / Gst.-Nr.',
    zaehlpunkt: 'Zählpunkt', mail: 'Mail', projekt_nr: 'Projekt-Nr.', kwp: 'kWp', modulflaeche: 'Modulfläche m²', einspeisung: 'Einspeisung',
    wr_leistung: 'WR-Leistung', speicher: 'Speicher', anbringung: 'Anbringung', zeitplan: 'Zeitplan', ticket: 'Ticket', fpj: 'FPJ-Nr.',
    offene_punkte: 'Offene Punkte', info: 'Info', geloescht_am: 'Papierkorb', schritte: 'Ablauf'
  };

  const FORM = [
    { titel: 'Kunde', felder: [
      { k: 'kunde', breit: true },
      { k: 'geburtsdatum', typ: 'date', label: 'Geb.-Datum (nat. Person)' },
      { k: 'vollmacht', typ: 'select', optionen: ['', 'Nein', 'Ja', 'nicht notwendig'] },
      { k: 'strasse', breit: true }, { k: 'plz', klein: true }, { k: 'ort' },
      { k: 'mail', typ: 'email', breit: true },
      { k: 'zaehlpunkt', label: 'Einspeisezählpunkt', breit: true, mono: true },
      { k: 'kg_gst', label: 'KG / Grundstücksnummer' }
    ] },
    { titel: 'Anlage', felder: [
      { k: 'projekt_nr' }, { k: 'kwp', typ: 'number', label: 'Größe kWp' }, { k: 'modulflaeche', typ: 'number' },
      { k: 'einspeisung', typ: 'select', optionen: ['', 'Überschuss', 'Volleinspeisung'] },
      { k: 'wr_leistung', label: 'WR-Nennleistung' }, { k: 'speicher', label: 'Speicher netto' },
      { k: 'anbringung', liste: ['Dach', 'Freifläche', 'Fassade', 'Carport'] }, { k: 'zeitplan' }
    ] },
    { titel: 'Förderung', felder: [
      { k: 'jahr', typ: 'number', klein: true }, { k: 'programm', liste: ['EAG', 'Land Salzburg'] },
      { k: 'art', typ: 'select', optionen: ['', 'PV', 'PV + Speicher', 'Speicher'] },
      { k: 'foerdercall', typ: 'date' },
      { k: 'mitarbeiter', label: 'Mitarbeiter (Verkauf)', liste: 'mitarbeiter' },
      { k: 'zieher', label: 'Ticket-Zieher (aufgeteilt an)', liste: 'zieher' },
      { k: 'ticket', mono: true }, { k: 'fpj', label: 'FPJ-Nr. (Portal)', mono: true }
    ] },
    { titel: 'Notizen', felder: [
      { k: 'offene_punkte', typ: 'textarea', breit: true }, { k: 'info', typ: 'textarea', breit: true }
    ] }
  ];

  const S = {
    ich: null, daten: [],
    filter: Object.assign({ suche: '', jahr: String(new Date().getFullYear()), call: '', art: '', mitarbeiter: '', zieher: '', papierkorb: false, schritt: '' }, speicherLokal.lesen('filter', {})),
    sort: speicherLokal.lesen('sort', { k: 'call', auf: true }),
    detail: null, geladenUm: 0,
    extra: '',
    ansicht: ['todo', 'warten', 'fertig', 'beendet', 'alle'].includes(speicherLokal.lesen('ansicht', 'todo')) ? speicherLokal.lesen('ansicht', 'todo') : 'todo', aufgeklappt: new Set(), phase: ''
  };
  S.filter.suche = '';
  S.filter.papierkorb = false;

  const darf = r => !!S.ich && (S.ich.rolle === 'admin' || (r === 'bearbeiten' && S.ich.rolle === 'bearbeiten') || r === 'lesen');

  // ---------------------------------------------------------------
  // Kleinigkeiten: Toast, Rückfrage
  // ---------------------------------------------------------------
  let toastTimer;
  function toast(msg, art) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (art ? ' toast-' + art : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, art === 'fehler' ? 6000 : 3000);
  }

  function frage(text, jaText, gefahr) {
    return new Promise(res => {
      const o = document.createElement('div');
      o.className = 'overlay overlay-frage';
      o.innerHTML = `<div class="panel panel-klein" role="alertdialog" aria-modal="true"><div class="panel-inhalt"><p>${esc(text)}</p></div>
        <footer class="panel-fuss"><button class="btn" data-a="nein">Abbrechen</button><button class="btn ${gefahr ? 'btn-gefahr' : 'btn-primaer'}" data-a="ja">${esc(jaText || 'OK')}</button></footer></div>`;
      const zu = v => { o.remove(); document.removeEventListener('keydown', taste, true); res(v); };
      const taste = e => { if (e.key === 'Escape') { e.stopPropagation(); zu(false); } };
      o.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (a) zu(a.dataset.a === 'ja'); else if (e.target === o) zu(false); });
      document.addEventListener('keydown', taste, true);
      document.body.appendChild(o);
      $('[data-a="ja"]', o).focus();
    });
  }

  function zeige(id) {
    ['laden', 'login', 'gesperrt', 'app'].forEach(x => { $('#' + x).hidden = x !== id; });
  }

  // ---------------------------------------------------------------
  // Anmeldung
  // ---------------------------------------------------------------
  let loginModus = 'anmelden';
  function setzeLoginModus(m) {
    loginModus = m;
    $('#login-titel').textContent = { anmelden: 'Bitte melde dich an.', registrieren: 'Neues Konto anlegen. Danach schaltet dich der Admin frei.', vergessen: 'Wir schicken dir einen Link zum Zurücksetzen.' }[m];
    $('#login-btn').textContent = { anmelden: 'Anmelden', registrieren: 'Konto anlegen', vergessen: 'Link senden' }[m];
    $('#login-pw-feld').hidden = m === 'vergessen';
    $('#login-pw').required = m !== 'vergessen';
    $('#login-pw').autocomplete = m === 'registrieren' ? 'new-password' : 'current-password';
    $('#login-modus').textContent = m === 'anmelden' ? 'Noch kein Konto? Registrieren' : 'Zurück zur Anmeldung';
    $('#login-vergessen').hidden = m !== 'anmelden';
    $('#login-fehler').hidden = true;
  }

  async function loginAbsenden(e) {
    e.preventDefault();
    const mail = $('#login-mail').value.trim(), pw = $('#login-pw').value;
    const fehler = $('#login-fehler');
    fehler.hidden = true; fehler.classList.remove('ok');
    $('#login-btn').disabled = true;
    try {
      if (loginModus === 'anmelden') {
        await Q.anmelden(mail, pw);
      } else if (loginModus === 'registrieren') {
        const r = await Q.registrieren(mail, pw);
        fehler.textContent = r && r.session
          ? 'Konto angelegt. Sobald der Admin dich freischaltet, siehst du die Förderliste.'
          : 'Konto angelegt. Bitte zuerst den Link in der Bestätigungs-Mail anklicken, danach schaltet dich der Admin frei.';
        fehler.classList.add('ok'); fehler.hidden = false;
        setzeLoginModus('anmelden');
        fehler.hidden = false;
      } else {
        await Q.passwortVergessen(mail);
        fehler.textContent = 'Falls es das Konto gibt, ist der Link unterwegs.';
        fehler.classList.add('ok'); fehler.hidden = false;
      }
    } catch (err) {
      fehler.textContent = E.fehlerText(err); fehler.hidden = false;
    } finally {
      $('#login-btn').disabled = false;
    }
  }

  let anmeldungLaeuft = null;
  function nachAnmeldung(session) {
    if (!anmeldungLaeuft) anmeldungLaeuft = nachAnmeldungIntern(session).finally(() => { anmeldungLaeuft = null; });
    return anmeldungLaeuft;
  }
  async function nachAnmeldungIntern(session) {
    if (!session) { zeige('login'); setzeLoginModus('anmelden'); return; }
    const mail = session.user && session.user.email;
    try {
      S.ich = await Q.ich(mail);
    } catch (e) {
      S.ich = null;
      zeige('login'); const f = $('#login-fehler'); f.textContent = E.fehlerText(e); f.hidden = false;
      return;
    }
    if (!S.ich) { $('#gesperrt-mail').textContent = mail; zeige('gesperrt'); return; }
    $('#nutzer-name').textContent = S.ich.name || mail;
    $('#nutzer-mail').textContent = mail;
    $('#nutzer-rolle').textContent = { admin: 'Admin', bearbeiten: 'Bearbeiten', lesen: 'Nur lesen' }[S.ich.rolle] || S.ich.rolle;
    $$('[data-recht]').forEach(el => { el.hidden = !darf(el.dataset.recht); });
    zeige('app');
    await laden();
    await pruefeFreischaltungen();
    // Link aus der Admin-Mail: direkt die Freischaltung öffnen
    if (location.hash === '#nutzer' && darf('admin')) {
      history.replaceState(null, '', location.pathname + location.search);
      nutzerDialog();
    }
  }

  async function pruefeFreischaltungen() {
    const el = $('#freischalt-hinweis');
    if (!darf('admin')) { el.hidden = true; return; }
    try {
      const offen = await Q.offeneKonten();
      el.hidden = !offen.length;
      el.innerHTML = `<svg><use href="#i-users"/></svg><span><b>${offen.length === 1 ? '1 neue Registrierung wartet' : offen.length + ' neue Registrierungen warten'}</b> auf deine Freischaltung</span><span class="freischalt-los">Ansehen</span>`;
    } catch (e) { el.hidden = true; }
  }

  // ---------------------------------------------------------------
  // Daten laden & Filter
  // ---------------------------------------------------------------
  async function laden(still) {
    try {
      S.daten = await Q.liste();
      S.geladenUm = Date.now();
      fuelleFilter();
      zeichne();
      if (!still) { /* ruhig */ }
    } catch (e) {
      toast('Laden fehlgeschlagen: ' + E.fehlerText(e), 'fehler');
    }
  }

  function werte(k) {
    return Array.from(new Set(S.daten.map(d => (d[k] === null || d[k] === undefined) ? '' : String(d[k]).trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'de'));
  }
  function zieherWerte() {
    return Array.from(new Set(S.daten.flatMap(d => (d.zieher || '').split(' / ').map(s => s.trim())).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'de'));
  }

  function fuelleFilter() {
    const opt = (sel, liste, alle, fmt) => {
      const el = $(sel), aktuell = S.filter[el.id.slice(2)];
      const werteListe = liste.slice();
      if (aktuell && !werteListe.includes(aktuell)) werteListe.push(aktuell);
      el.innerHTML = `<option value="">${esc(alle)}</option>` + werteListe.map(v => `<option value="${esc(v)}">${esc(fmt ? fmt(v) : v)}</option>`).join('');
      el.value = aktuell || '';
    };
    opt('#f-jahr', werte('jahr').sort().reverse(), 'Alle Jahre');
    opt('#f-call', werte('foerdercall').sort().reverse().concat(S.daten.some(d => !d.foerdercall) ? ['ohne'] : []), 'Alle Fördercalls', v => v === 'ohne' ? 'ohne Fördercall' : 'Call ' + datumDE(v));
    opt('#f-art', werte('art'), 'Alle Arten');
    opt('#f-mitarbeiter', werte('mitarbeiter'), 'Alle Mitarbeiter');
    opt('#f-zieher', zieherWerte().concat(['–']), 'Alle Ticket-Zieher', v => v === '–' ? 'noch nicht aufgeteilt' : v);
    $('#f-papierkorb').checked = S.filter.papierkorb;
    $('#f-suche').value = S.filter.suche;
  }

  function passtBasis(d) {
    const f = S.filter;
    if (!!d.geloescht_am !== f.papierkorb) return false;
    if (f.jahr && String(d.jahr) !== f.jahr) return false;
    if (f.call && (f.call === 'ohne' ? !!d.foerdercall : d.foerdercall !== f.call)) return false;
    if (f.art && d.art !== f.art) return false;
    if (f.mitarbeiter && (d.mitarbeiter || '').trim() !== f.mitarbeiter) return false;
    if (f.zieher && (f.zieher === '–' ? !!(d.zieher || '').trim() : !(d.zieher || '').split(' / ').map(s => s.trim()).includes(f.zieher))) return false;
    if (f.suche) {
      const q = f.suche.toLowerCase();
      const heu = [d.kunde, d.ort, d.plz, d.strasse, d.zaehlpunkt, d.projekt_nr, d.ticket, d.fpj, d.mail, d.mitarbeiter, d.zieher, d.offene_punkte, d.info].join(' ').toLowerCase();
      if (!q.split(/\s+/).every(t => heu.includes(t))) return false;
    }
    return true;
  }
  function sortiere(liste) {
    const { k, auf } = S.sort;
    const wert = x => {
      switch (k) {
        case 'kunde': return (x.d.kunde || '').toLowerCase();
        case 'ort': return (x.d.ort || '').toLowerCase();
        case 'mitarbeiter': return (x.d.mitarbeiter || '').toLowerCase();
        case 'zieher': return (x.d.zieher || '').toLowerCase();
        case 'kwp': return x.d.kwp || 0;
        case 'status': return x.st.fertig ? 99 : x.st.ende ? 98 : x.st.naechster;
        case 'frist': { const fr = E.fristen(x.d, heute())[0]; return fr ? (fr.datum || '0000') : '9999'; }
        case 'geaendert': return x.d.geaendert_am || '';
        default: return (x.d.foerdercall || '9999') + (x.d.kunde || '').toLowerCase();
      }
    };
    return liste.sort((a, b) => {
      const va = wert(a), vb = wert(b);
      const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'de');
      return auf ? c : -c;
    });
  }

  // Ansicht: "todo" = wir sind dran, "warten" = Förderstelle/Kunde ist dran, "fertig", "alle"
  // Ansicht eines Eintrags: wir sind dran (todo), die Förderstelle ist dran (warten), fertig, beendet
  function kategorie(st, d) {
    if (st.ende) return 'beendet';
    if (st.fertig) return 'fertig';
    const a = d ? E.aufgabe(d, st) : null;
    return a && a.warten ? 'warten' : 'todo';
  }

  const hatOffenePunkte = x => !!(x.d.offene_punkte || '').trim();
  const fehltDaten = x => E.fehlendeDaten(x.d).length > 0 && x.st.hoechster < E.IDX.ticket && !x.st.ende;
  const fristBald = x => { const fr = E.fristen(x.d, heute())[0]; return !!fr && fr.stufe !== 'ruhig'; };
  function passtExtra(x) {
    if (S.extra === 'frist') return fristBald(x);
    if (S.extra === 'offen') return hatOffenePunkte(x);
    if (S.extra === 'datenfehlen') return fehltDaten(x);
    return true;
  }

  function aktuelleListe() {
    return S.daten.filter(passtBasis).map(d => ({ d, st: E.status(d) }))
      .filter(x => S.ansicht === 'alle' || kategorie(x.st, x.d) === S.ansicht).filter(passtExtra)
      .filter(x => !S.phase || ['todo', 'warten'].indexOf(S.ansicht) < 0 || (E.aufgabe(x.d, x.st) || {}).phase === S.phase);
  }

  function zeichneExtra() { /* Alarme stehen jetzt in der Ansicht-Leiste (zeichneReiter) */ }

  // ---------------------------------------------------------------
  // Übersicht zeichnen
  // ---------------------------------------------------------------
  function zeichne() {
    const basis = S.daten.filter(passtBasis).map(d => ({ d, st: E.status(d) }));
    zeichneReiter(basis);
    const inAnsicht = basis.filter(x => S.ansicht === 'alle' || kategorie(x.st, x.d) === S.ansicht);
    zeichnePhasen(inAnsicht);
    const liste = inAnsicht.filter(passtExtra)
      .filter(x => !S.phase || ['todo', 'warten'].indexOf(S.ansicht) < 0 || (E.aufgabe(x.d, x.st) || {}).phase === S.phase);
    if (S.ansicht === 'alle') zeichneListe(sortiere(liste), basis.length);
    else zeichneGruppen(liste);
    const f = S.filter;
    const aktiv = [f.call, f.art, f.mitarbeiter, f.zieher, f.papierkorb].filter(Boolean).length;
    $('#filter-zurueck').hidden = !(f.suche || aktiv);
    $('#mehr-filter-btn').classList.toggle('aktiv', !!aktiv);
    $('#mehr-filter-btn span').textContent = aktiv ? `Filter (${aktiv})` : 'Filter';
    speicherLokal.schreiben('filter', { jahr: f.jahr, call: f.call, art: f.art, mitarbeiter: f.mitarbeiter, zieher: f.zieher });
    speicherLokal.schreiben('ansicht', S.ansicht);
  }

  // Ansicht-Leiste: links die Ansichten, rechts nur die Alarme
  function zeichneReiter(basis) {
    const n = { todo: 0, warten: 0, fertig: 0, beendet: 0, alle: basis.length };
    basis.forEach(x => { n[kategorie(x.st, x.d)]++; });
    const offen = basis.filter(x => !x.st.ende && !x.st.fertig);
    const alarm = { frist: offen.filter(fristBald).length, offen: offen.filter(hatOffenePunkte).length, datenfehlen: offen.filter(fehltDaten).length };
    const kritisch = offen.some(x => { const fr = E.fristen(x.d, heute())[0]; return fr && ['unbekannt', 'ueberfaellig'].includes(fr.stufe); });
    const seg = (k, t) => `<button class="seg-knopf ${S.ansicht === k ? 'aktiv' : ''}" data-ansicht="${k}">${t}<span>${n[k]}</span></button>`;
    const chip = (k, icon, t, laut) => alarm[k] ? `<button class="alarm alarm-${k} ${laut ? 'laut' : ''} ${S.extra === k ? 'aktiv' : ''}" data-extra="${k}" title="${esc(t)}"><svg><use href="#${icon}"/></svg><b>${alarm[k]}</b><span>${t}</span></button>` : '';
    $('#reiter').innerHTML = `<div class="seg">${seg('todo', 'Zu tun')}${seg('warten', 'Wartet')}${seg('fertig', 'Fertig')}${seg('beendet', 'Beendet')}${seg('alle', 'Alle')}</div>
      <div class="alarme">${chip('frist', 'i-history', 'Fristen', kritisch)}${chip('offen', 'i-flag', 'Offene Punkte')}${chip('datenfehlen', 'i-alert', 'Daten fehlen', true)}</div>`;
  }

  // Phasen-Balken: 5 Phasen mit Anzahl, Klick filtert
  function zeichnePhasen(inAnsicht) {
    const el = $('#extra-filter');
    if (['todo', 'warten'].indexOf(S.ansicht) < 0) { el.innerHTML = ''; return; }
    const n = {};
    inAnsicht.forEach(x => { const a = E.aufgabe(x.d, x.st); if (a) n[a.phase] = (n[a.phase] || 0) + 1; });
    el.innerHTML = `<nav class="phasen" aria-label="Phasen">${E.PHASEN.map(p => `<button class="phase-knopf p-${p.key} ${S.phase === p.key ? 'aktiv' : ''} ${n[p.key] ? '' : 'leer'}" data-phase="${p.key}">
      <span class="phase-name">${esc(p.label)}</span><b>${n[p.key] || 0}</b></button>`).join('')}</nav>`;
  }

  // Frist als kleines Etikett; lang = mit Resttagen
  function fristBadge(fr, lang) {
    if (!fr) return '';
    const wann = fr.datum ? datumDE(fr.datum) : 'unbekannt';
    const rest = fr.tage === null ? '' : fr.tage < 0 ? ` · ${-fr.tage} Tage überfällig` : fr.tage === 0 ? ' · heute' : ` · noch ${fr.tage} Tage`;
    return `<span class="frist frist-${fr.stufe}" title="${esc(fr.hinweis)}"><svg><use href="#i-history"/></svg>${esc(fr.label)}: ${esc(wann)}${lang ? esc(rest) : ''}</span>`;
  }
  const callsText = v => String(v || '').split(',').map(x => datumDE(x.trim())).filter(Boolean).join(', ');

  function zeileHtml(d, st, bearbeiten, ohneFrist) {
    const n = E.aufgabe(d, st);
    const fehlt = E.fehlendeDaten(d);
    const fr = E.fristen(d, heute())[0];
    const s = d.schritte || {};
    const meta = [[d.plz, d.ort].filter(Boolean).join(' '), d.foerdercall ? 'Call ' + datumDE(d.foerdercall).slice(0, 6) + d.foerdercall.slice(2, 4) : '',
      d.kwp ? zahlDE(d.kwp) + ' kWp' : '', d.zieher || ''].filter(Boolean);
    let knopf = '';
    if (st.fertig) {
      knopf = `<span class="z-status ok"><svg><use href="#i-check"/></svg>${s.ausgezahlt && s.ausgezahlt !== '✓' ? datumDE(s.ausgezahlt) : 'ausgezahlt'}</span>`;
    } else if (st.ende) {
      const w = s[st.ende.key];
      knopf = st.ende.key === 'abgelehnt' && bearbeiten && E.offenerCall(heute())
        ? `<button class="z-knopf" data-neu-ansuchen title="Im Call ${esc(datumDE(E.offenerCall(heute())))} neu ansuchen"><svg><use href="#i-restore"/></svg>Neu ansuchen</button>`
        : `<span class="z-status ende">${esc(st.ende.label)}${w && w !== '✓' ? ' · ' + datumDE(w) : ''}</span>`;
    } else if (bearbeiten && !n.auto) {
      knopf = `<button class="z-knopf" data-schnell="${n.key}" title="${esc(n.todo)} – heute erledigt"><svg><use href="#i-check"/></svg>${esc(n.knopf)}</button>`;
    } else if (bearbeiten) {
      knopf = `<button class="z-knopf leise" data-oeffnen>${esc(n.knopf)}</button>`;
    }
    const flags = [
      s.frueher_abgelehnt ? `<span class="z-tag" title="Abgelehnt im Call ${esc(callsText(s.frueher_abgelehnt))}">2. Versuch</span>` : '',
      (d.offene_punkte || '').trim() ? `<span class="z-icon gelb" title="${esc(d.offene_punkte)}"><svg><use href="#i-flag"/></svg></span>` : '',
      fehlt.length && st.hoechster < E.IDX.ticket && !st.ende ? `<span class="z-icon rot" title="Es fehlen: ${esc(fehlt.join(', '))}"><svg><use href="#i-alert"/></svg></span>` : ''
    ].join('');
    const phase = st.fertig ? 'fertig' : st.ende ? 'ende' : n.phase;
    return `<div class="z" data-id="${d.id}" tabindex="0">
      <span class="z-punkt p-${phase}" aria-hidden="true"></span>
      <div class="z-haupt"><div class="z-name">${esc(d.kunde || '(ohne Namen)')}${flags}</div><div class="z-meta">${esc(meta.join(' · '))}</div></div>
      <div class="z-frist">${ohneFrist ? '' : fr && fr.stufe !== 'ruhig' ? fristBadge(fr, true) : fr ? `<span class="z-datum">${esc(fr.label)} bis ${datumDE(fr.datum)}</span>` : ''}</div>
      <div class="z-aktion">${knopf}</div>
    </div>`;
  }

  function zeichneGruppen(liste) {
    const bearbeiten = darf('bearbeiten') && !S.filter.papierkorb;
    $('#liste-info').innerHTML = S.filter.papierkorb ? '<b class="rot">Papierkorb</b>' : '';
    if (!S.daten.length) {
      $('#liste').innerHTML = `<div class="leer-hinweis">${darf('admin') ? 'Noch keine Kunden. Oben auf „Neuer Kunde“ klicken oder die Excel-Liste importieren.' : 'Noch keine Kunden erfasst.'}</div>`;
      return;
    }
    const gruppen = new Map();
    liste.forEach(x => {
      const key = x.st.fertig ? 'fertig' : x.st.ende ? x.st.ende.key : E.aufgabe(x.d, x.st).key;
      if (!gruppen.has(key)) gruppen.set(key, []);
      gruppen.get(key).push(x);
    });
    const defs = S.ansicht === 'fertig' ? [{ key: 'fertig', todo: 'Ausgezahlt', phase: 'fertig' }]
      : S.ansicht === 'beendet' ? E.ENDE.map(e => ({ key: e.key, todo: e.label, phase: 'ende' }))
      : GRUPPEN;
    const RANG = { unbekannt: 0, ueberfaellig: 1, dringend: 2, bald: 3, ruhig: 4 };
    const dringlich = x => { const fr = E.fristen(x.d, heute())[0]; return fr ? RANG[fr.stufe] + (fr.datum || '') : '9'; };
    const zeigen = (S.filter.suche || S.extra) ? 999 : 8;
    const call = E.offenerCall(heute());
    const html = defs.map(g => {
      const eintraege = (gruppen.get(g.key) || []).sort((a, b) => dringlich(a).localeCompare(dringlich(b)) || (a.d.kunde || '').localeCompare(b.d.kunde || '', 'de'));
      if (!eintraege.length) return '';
      const offen = S.aufgeklappt.has(g.key) || eintraege.length <= zeigen + 2;
      const extra = g.key === 'aufgeteilt' && bearbeiten ? '<button class="g-knopf" data-aktion="wuerfeln"><svg><use href="#i-dice"/></svg>Automatisch aufteilen</button>'
        : g.key === 'abgelehnt' && bearbeiten && call && eintraege.length > 1 ? `<button class="g-knopf" data-aktion="alle-neu-ansuchen"><svg><use href="#i-restore"/></svg>Alle im Call ${esc(datumDE(call))} neu ansuchen</button>` : '';
      const hilfe = g.warten ? 'wartet auf die Förderstelle' : (g.hilfe || '');
      // Gleiche Frist für die ganze Gruppe (z. B. Ticket am Calltag): einmal oben statt in jeder Zeile
      const fristen = eintraege.map(x => E.fristen(x.d, heute())[0] || null);
      const f0 = fristen[0];
      const gemeinsam = eintraege.length > 1 && f0 && fristen.every(f => f && f.art === f0.art && f.datum === f0.datum);
      return `<section class="g" id="gruppe-${g.key}">
        <header class="g-kopf"><span class="z-punkt p-${g.phase}" aria-hidden="true"></span><h2>${esc(g.todo)}</h2><span class="g-n">${eintraege.length}</span>${gemeinsam ? `<span class="g-frist">${fristBadge(f0, true)}</span>` : ''}${hilfe ? `<span class="g-hilfe">${esc(hilfe)}</span>` : ''}${extra}</header>
        <div class="g-karte">${(offen ? eintraege : eintraege.slice(0, zeigen)).map(x => zeileHtml(x.d, x.st, bearbeiten, gemeinsam)).join('')}
          ${offen ? '' : `<button class="mehr" data-mehr="${g.key}">Alle ${eintraege.length} anzeigen</button>`}</div>
      </section>`;
    }).join('');
    const leer = (S.filter.suche || S.extra || S.phase) ? 'Nichts gefunden – Filter oder Suche ändern.'
      : S.ansicht === 'todo' ? 'Nichts zu tun. Alles, was offen ist, wartet auf die Förderstelle.'
      : S.ansicht === 'warten' ? 'Nichts wartet auf die Förderstelle.'
      : S.ansicht === 'beendet' ? 'Keine abgelehnten oder zurückgezogenen Förderungen.' : 'Noch keine Förderung ausgezahlt.';
    $('#liste').innerHTML = html.trim() ? html : `<div class="leer-hinweis">${leer}</div>`;
  }

  function fortschritt(d, st) {
    return `<div class="balken" style="grid-template-columns:repeat(${SCHRITTE.length},1fr)" aria-label="Fortschritt">${SCHRITTE.map((x, i) => {
      const w = E.schrittWert(d, x.key);
      const cls = st.erledigt[i] ? 'ok' : (st.luecken.includes(i) ? 'luecke' : (i === st.naechster ? 'naechst' : ''));
      return `<i class="p-${x.phase} ${cls}" title="${esc(x.label)}${w ? ': ' + esc(w === '✓' ? 'erledigt' : datumDE(w)) : st.luecken.includes(i) ? ': übersprungen?' : ''}"></i>`;
    }).join('')}</div>`;
  }

  function zeichneListe(liste, basisAnzahl) {
    const kwpSumme = liste.reduce((s, x) => s + (Number(x.d.kwp) || 0), 0);
    $('#liste-info').innerHTML = `<b>${liste.length}</b> ${liste.length === 1 ? 'Förderung' : 'Förderungen'}${liste.length !== basisAnzahl ? ` <span class="grau">von ${basisAnzahl}</span>` : ''}${kwpSumme ? ` · <span class="grau">${zahlDE(kwpSumme)} kWp</span>` : ''}${S.filter.papierkorb ? ' · <b class="rot">Papierkorb</b>' : ''}`;
    if (!liste.length) {
      $('#liste').innerHTML = `<div class="leer-hinweis">${S.daten.length ? 'Keine Förderung passt zu den Filtern.' : (darf('admin') ? 'Noch keine Förderungen. Lege eine neue an oder importiere deine Excel-Liste (oben rechts: Import).' : 'Noch keine Förderungen erfasst.')}</div>`;
      return;
    }
    const kopf = (k, t, cls) => `<th class="${cls || ''}"><button class="sortier ${S.sort.k === k ? 'aktiv ' + (S.sort.auf ? 'auf' : 'ab') : ''}" data-sort="${k}">${t}</button></th>`;
    const bearbeiten = darf('bearbeiten') && !S.filter.papierkorb;
    $('#liste').innerHTML = `<table class="tabelle">
      <thead><tr>
        ${kopf('kunde', 'Kunde')}${kopf('call', 'Call')}${kopf('mitarbeiter', 'Mitarbeiter', 'sp-m')}${kopf('zieher', 'Zieher', 'sp-m')}
        ${kopf('kwp', 'Anlage', 'sp-r')}<th class="sp-l">Ticket / FPJ</th>${kopf('status', 'Stand')}<th class="sp-aktion"></th>
      </tr></thead>
      <tbody>${liste.map(({ d, st }) => {
        const n = E.aufgabe(d, st);
        const fr = E.fristen(d, heute())[0];
        const fehlt = E.fehlendeDaten(d);
        const anlage = [d.kwp ? zahlDE(d.kwp) + ' kWp' : '', d.speicher ? d.speicher : ''].filter(Boolean).join(' · ');
        return `<tr data-id="${d.id}" tabindex="0">
          <td class="sp-kunde"><div class="kunde">${esc(d.kunde || '(ohne Namen)')}</div>
            <div class="klein grau">${esc([d.plz, d.ort].filter(Boolean).join(' '))}${d.projekt_nr ? ' · ' + esc(d.projekt_nr) : ''}${d.art ? ' · ' + esc(d.art) : ''}</div>
            ${(d.offene_punkte || '').trim() ? `<div class="hinweis-zeile"><svg><use href="#i-flag"/></svg>${esc(d.offene_punkte)}</div>` : ''}
            ${fehlt.length && st.hoechster < E.IDX.ticket && !st.ende ? `<div class="hinweis-zeile warn"><svg><use href="#i-alert"/></svg>fehlt: ${esc(fehlt.join(', '))}</div>` : ''}</td>
          <td data-l="Call">${d.foerdercall ? datumDE(d.foerdercall) : '<span class="grau">–</span>'}</td>
          <td data-l="Mitarbeiter" class="sp-m">${esc(d.mitarbeiter) || '<span class="grau">–</span>'}</td>
          <td data-l="Zieher" class="sp-m">${esc(d.zieher) || '<span class="grau">–</span>'}</td>
          <td data-l="Anlage" class="sp-r">${esc(anlage) || '<span class="grau">–</span>'}</td>
          <td data-l="Ticket / FPJ" class="sp-l mono klein">${esc(d.ticket) || '<span class="grau">–</span>'}${d.fpj ? '<br>' + esc(d.fpj) : ''}</td>
          <td class="sp-stand">${fortschritt(d, st)}
            <div class="stand-text">${st.fertig ? '<span class="gruen">Ausgezahlt</span>' : st.ende ? `<span class="rot">${esc(st.ende.label)}</span>` : `<span class="grau">Als Nächstes:</span> ${esc(n.todo)}`}</div>${fr && fr.stufe !== 'ruhig' ? fristBadge(fr, false) : ''}</td>
          <td class="sp-aktion">${bearbeiten && st.ende && st.ende.key === 'abgelehnt' && E.offenerCall(heute()) ? '<button class="btn btn-mini" data-neu-ansuchen><svg><use href="#i-restore"/></svg><span>Neu ansuchen</span></button>' : ''}${bearbeiten && n && !n.auto ? `<button class="btn btn-mini" data-schnell="${n.key}" title="${esc(n.label)} – heute erledigt"><svg><use href="#i-check"/></svg><span>${esc(n.kurz)}</span></button>` : ''}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  async function schnellErledigt(id, key) {
    const d = S.daten.find(x => x.id === id);
    if (!d) return;
    try {
      const neu = await Q.aendern(id, { schritte: Object.assign({}, d.schritte || {}, { [key]: heute() }) }, d.geaendert_am);
      Object.assign(d, neu);
      toast(`${d.kunde}: ${ALLE_LABEL[key] || key} ✓`, 'ok');
      zeichne();
    } catch (e) {
      if (e.konflikt) { toast('Der Eintrag wurde gerade von jemand anderem geändert – Liste neu geladen.', 'fehler'); laden(); }
      else toast(E.fehlerText(e), 'fehler');
    }
  }

  // Abgelehnt → im offenen Call neu ansuchen (Ticket weg, Projekt bleibt, Herkunft gemerkt)
  async function schnellNeuAnsuchen(id) {
    const d = S.daten.find(x => x.id === id);
    if (!d) return;
    try {
      const patch = E.neuAnsuchen(d, heute());
      Object.assign(d, await Q.aendern(id, patch, d.geaendert_am));
      toast(`${d.kunde}: neu im Call ${datumDE(patch.foerdercall)} – als Nächstes Ticket ziehen`, 'ok');
      zeichne();
    } catch (e) {
      if (e.konflikt) { toast('Der Eintrag wurde gerade von jemand anderem geändert – Liste neu geladen.', 'fehler'); laden(); }
      else toast(E.fehlerText(e), 'fehler');
    }
  }

  async function alleNeuAnsuchen() {
    const call = E.offenerCall(heute());
    const liste = aktuelleListe().filter(x => x.st.ende && x.st.ende.key === 'abgelehnt');
    if (!call || !liste.length) return;
    if (!(await frage(`${liste.length} abgelehnte Förderungen im Call ${datumDE(call)} neu ansuchen? Ticket und Einreichung werden zurückgesetzt, das Portal-Projekt bleibt.`, 'Neu ansuchen'))) return;
    let ok = 0, fehler = 0;
    for (const x of liste) {
      try { Object.assign(x.d, await Q.aendern(x.d.id, E.neuAnsuchen(x.d, heute()), x.d.geaendert_am)); ok++; } catch (e) { fehler++; }
    }
    toast(`${ok} neu angesucht${fehler ? `, ${fehler} Fehler – bitte Liste neu laden` : ''}.`, fehler ? 'fehler' : 'ok');
    zeichne();
  }

  // ---------------------------------------------------------------
  // Detail
  // ---------------------------------------------------------------
  function leererDatensatz() {
    const f = S.filter;
    return {
      jahr: +(f.jahr || new Date().getFullYear()), programm: 'EAG', art: 'PV + Speicher', foerdercall: f.call && f.call !== 'ohne' ? f.call : null,
      mitarbeiter: '', zieher: '', kunde: '', geburtsdatum: null, vollmacht: 'Nein', strasse: '', plz: '', ort: '', kg_gst: '', zaehlpunkt: '',
      mail: '', projekt_nr: '', kwp: null, modulflaeche: null, einspeisung: 'Überschuss', wr_leistung: '', speicher: '', anbringung: 'Dach',
      zeitplan: '', ticket: '', fpj: '', schritte: {}, offene_punkte: '', info: ''
    };
  }

  function oeffne(d) {
    const rec = JSON.parse(JSON.stringify(d || leererDatensatz()));
    rec.schritte = rec.schritte || {};
    S.detail = { rec, orig: JSON.parse(JSON.stringify(rec)), neu: !d };
    zeichneDetail();
    $('#detail').hidden = false;
    document.body.classList.add('modal-offen');
    if (!d) setTimeout(() => { const k = $('#d-inhalt [name="kunde"]'); k && k.focus(); }, 50);
  }

  function feldHtml(f, rec, nurLesen) {
    const k = f.k, v = rec[k];
    const label = f.label || FELD_LABEL[k] || k;
    const dis = nurLesen ? 'disabled' : '';
    let inp;
    if (f.typ === 'select') {
      const opts = f.optionen.slice();
      if (v && !opts.includes(v)) opts.push(v);
      inp = `<select name="${k}" ${dis}>${opts.map(o => `<option value="${esc(o)}" ${o === (v || '') ? 'selected' : ''}>${esc(o || '–')}</option>`).join('')}</select>`;
    } else if (f.typ === 'textarea') {
      inp = `<textarea name="${k}" rows="2" ${dis}>${esc(v)}</textarea>`;
    } else {
      const liste = f.liste ? `list="dl-${k}"` : '';
      const dl = f.liste ? `<datalist id="dl-${k}">${(Array.isArray(f.liste) ? f.liste : (k === 'zieher' ? zieherWerte() : werte(f.liste))).map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : '';
      const typ = f.typ === 'number' ? 'text" inputmode="decimal' : (f.typ || 'text');
      const wert = f.typ === 'number' && v !== null && v !== undefined ? String(v).replace('.', ',') : (v || '');
      inp = `<input type="${typ}" name="${k}" value="${esc(wert)}" ${liste} ${dis} ${f.mono ? 'class="mono"' : ''} autocomplete="off">${dl}`;
    }
    return `<label class="feld ${f.breit ? 'breit' : ''} ${f.klein ? 'schmal' : ''}"><span>${esc(label)}</span>${inp}<small class="feld-hinweis" id="h-${k}">${feldHinweis(k, rec)}</small></label>`;
  }

  // Prüf-Hinweise direkt unter einem Feld
  function feldHinweis(k, rec) {
    if (k === 'zaehlpunkt') {
      const p = E.zpPruefung(rec.zaehlpunkt);
      return p === 'ohneAT' ? '31 Stellen ohne „AT“ – im EAG-Portal mit AT davor eintragen'
        : p === 'ungueltig' ? '<b class="rot">Format prüfen: AT + 31 Zeichen</b>' : '';
    }
    if (k === 'kwp' && (rec.programm || 'EAG') === 'EAG') {
      const z = E.zuschuss(rec);
      if (!z) return '';
      return `Kategorie ${z.kat} · ca. ${z.gesamt.toLocaleString('de-AT')} € Zuschuss (Sätze 2026${z.kat >= 'C' ? ', Höchstsatz' : ''})`
        + (z.speicherOk === false ? ' · <b class="rot">Speicher nicht förderfähig: 0,5 kWh je kWp bis 50 kWh</b>' : '');
    }
    return '';
  }

  function fristenHtml(rec) {
    const fr = E.fristen(rec, heute());
    if (!fr.length) return '';
    return `<div class="fristen">${fr.map(f => `<div class="frist-zeile fz-${f.stufe}"><b>${esc(f.label)}</b><span>${f.datum ? datumDE(f.datum) : 'unbekannt'}</span>
      <small>${esc(f.tage === null ? f.hinweis : (f.tage < 0 ? `${-f.tage} Tage überfällig` : f.tage === 0 ? 'heute' : `noch ${f.tage} Tage`) + (f.hinweis ? ' · ' + f.hinweis : ''))}</small></div>`).join('')}</div>`;
  }

  function schrittZeile(rec, st, x, i, nurLesen) {
    const w = E.schrittWert(rec, x.key);
    const cls = st.erledigt[i] ? 'ok' : (i === st.naechster ? 'naechst' : (st.luecken.includes(i) ? 'luecke' : ''));
    const hilfe = i === st.naechster && x.hilfe ? `<span class="ablauf-auto">${esc(x.hilfe)}</span>` : '';
    if (x.auto) {
      let txt;
      if (x.key === 'daten') { const fehlt = E.fehlendeDaten(rec); txt = fehlt.length ? 'fehlt: ' + fehlt.join(', ') : 'vollständig'; }
      else txt = rec.zieher ? 'an ' + rec.zieher : 'Ticket-Zieher unten bei „Förderung“ eintragen';
      return `<li class="${cls}"><span class="punkt">${st.erledigt[i] ? '<svg><use href="#i-check"/></svg>' : i + 1}</span>
        <span class="ablauf-titel">${esc(x.label)}</span><span class="ablauf-auto">${esc(txt)}</span></li>`;
    }
    const datum = E.istDatum(w) ? w : '';
    return `<li class="${cls}"><label class="punkt punkt-klick"><input type="checkbox" data-schritt="${x.key}" ${w ? 'checked' : ''} ${nurLesen ? 'disabled' : ''}>
        <span>${st.erledigt[i] ? '<svg><use href="#i-check"/></svg>' : i + 1}</span></label>
      <span class="ablauf-titel">${esc(x.label)}${st.luecken.includes(i) ? ' <span class="luecke-text">übersprungen?</span>' : ''}</span>
      <input type="date" class="ablauf-datum" data-schritt-datum="${x.key}" value="${esc(datum)}" ${nurLesen ? 'disabled' : ''} title="Datum">
      ${w === '✓' ? `<span class="ablauf-auto">${x.key === 'vertrag_erhalten' ? '<b class="rot">Datum fehlt – ohne Datum keine Fristen</b>' : 'erledigt, Datum unbekannt'}</span>` : hilfe}</li>`;
  }

  // Ablauf nach Phasen, mit Nebenschritten an der Stelle, an der sie passieren
  function ablaufHtml(rec, nurLesen) {
    const st = E.status(rec);
    const s = rec.schritte || {};
    const neben = (key, titel) => `<li class="neben"><span class="punkt punkt-neben">+</span><span class="ablauf-titel">${esc(titel)}</span>
      <input type="date" class="ablauf-datum" data-schritt-datum="${key}" value="${esc(E.istDatum(s[key]) ? s[key] : '')}" ${nurLesen ? 'disabled' : ''} title="Datum"></li>`;
    let html = '';
    E.PHASEN.forEach(ph => {
      const idx = SCHRITTE.map((x, i) => x.phase === ph.key ? i : -1).filter(i => i >= 0);
      const fertig = idx.filter(i => st.erledigt[i]).length;
      const zu = fertig === idx.length && !(ph.key === 'call' && st.nachforderungOffen);
      if (html) html += '</ol></details>';
      html += `<details class="ph ph-${ph.key}" ${zu ? '' : 'open'}><summary><span class="z-punkt p-${ph.key}"></span>${esc(ph.label)}<span class="ph-n">${fertig}/${idx.length}</span></summary><ol class="ablauf">`;
      SCHRITTE.forEach((x, i) => {
        if (x.phase !== ph.key) return;
        html += schrittZeile(rec, st, x, i, nurLesen);
        if (x.key === 'eingereicht' && ((st.erledigt[i] && !st.erledigt[E.IDX.vertrag_erhalten]) || s.nachforderung)) {
          html += neben('nachforderung', 'Nachforderung erhalten');
          if (s.nachforderung) html += neben('nachgereicht', 'Unterlagen nachgereicht');
        }
        if (x.key === 'inbetriebnahme' && ((st.erledigt[E.IDX.vertrag_erhalten] && !st.erledigt[i]) || s.verlaengert_bis)) {
          html += neben('verlaengert_bis', 'Frist verlängert bis');
        }
      });
    });
    const ende = nurLesen ? '' : `<div class="ergebnis"><span class="grau klein">Endet ohne Auszahlung?</span><div class="ergebnis-knoepfe">${E.ENDE.map(e =>
      `<button type="button" class="btn btn-mini-leise ${s[e.key] ? 'aktiv' : ''}" data-ende="${e.key}">${s[e.key] ? '✓ ' : ''}${esc(e.label)}</button>`).join('')}</div></div>`;
    const frueher = s.frueher_abgelehnt ? `<p class="klein grau">Abgelehnt im Call ${esc(callsText(s.frueher_abgelehnt))}, danach neu angesucht.</p>` : '';
    return fristenHtml(rec) + html + '</ol></details>' + frueher + ende;
  }

  function jetztHtml(rec, nurLesen, neu) {
    const punkte = (rec.offene_punkte || '').trim();
    const punkteHtml = !neu && punkte ? `<div class="jetzt-punkte"><svg><use href="#i-flag"/></svg><div><b>Offene Punkte</b><span>${esc(punkte)}</span></div><button class="btn btn-leise" data-zu-punkten>Bearbeiten</button></div>` : '';
    return jetztKasten(rec, nurLesen, neu) + punkteHtml;
  }

  function jetztKasten(rec, nurLesen, neu) {
    if (neu) return '<div class="jetzt jetzt-neu"><div class="jetzt-text"><small>Neuer Kunde</small><b>Daten eintragen und speichern</b></div></div>';
    const st = E.status(rec);
    if (st.fertig) return '<div class="jetzt jetzt-fertig"><div class="jetzt-text"><small>Stand</small><b>Komplett erledigt – ausgezahlt</b></div></div>';
    if (st.ende) {
      const w = (rec.schritte || {})[st.ende.key];
      const call = E.offenerCall(heute());
      const text = st.ende.key !== 'abgelehnt' ? 'Keine weiteren Schritte.'
        : call ? `Neu ansuchen geht bis ${datumDE(E.callEnde(call))}: Ticket am ${datumDE(call)} ab 17:00 Uhr.` : 'Kein Fördercall mehr offen – 2027 gibt es keinen.';
      return `<div class="jetzt jetzt-ende"><div class="jetzt-text"><small>Beendet</small><b>${esc(st.ende.label)}${w && w !== '✓' ? ' am ' + datumDE(w) : ''}</b><span>${esc(text)}</span></div>
        ${st.ende.key === 'abgelehnt' && call && !nurLesen ? `<button class="erledigt erledigt-gross" data-neu-ansuchen-detail><svg><use href="#i-restore"/></svg>Im Call ${esc(datumDE(call))} neu ansuchen</button>` : ''}</div>`;
    }
    const n = E.aufgabe(rec, st);
    const fr = E.fristen(rec, heute())[0];
    const hinweis = n.key === 'daten' ? 'Unten die fehlenden Angaben ergänzen: ' + E.fehlendeDaten(rec).join(', ')
      : n.key === 'aufgeteilt' ? 'Unten bei „Förderung“ den Ticket-Zieher eintragen' : (n.hilfe || '');
    const laut = fr && ['unbekannt', 'ueberfaellig', 'dringend'].includes(fr.stufe);
    return `<div class="jetzt ${laut ? 'jetzt-dringend' : ''}"><div class="jetzt-text"><small>Als Nächstes · ${n.neben ? 'Nebenschritt' : `Schritt ${st.naechster + 1} von ${SCHRITTE.length}`}</small><b>${esc(n.todo)}</b>${n.warten ? '<span>Wartet auf die Förderstelle – abhaken, sobald es da ist.</span>' : ''}${hinweis ? `<span>${esc(hinweis)}</span>` : ''}${fr ? `<span class="jetzt-frist">${fristBadge(fr, true)}</span>` : ''}</div>
      ${!nurLesen && !n.auto ? `<button class="erledigt erledigt-gross" data-jetzt="${n.key}"><svg><use href="#i-check"/></svg>${esc(n.knopf)} – speichern</button>` : ''}</div>`;
  }

  function ablaufNeu() {
    const D = S.detail;
    $('#d-ablauf').innerHTML = ablaufHtml(D.rec, false);
    $('#d-jetzt').innerHTML = jetztHtml(D.rec, false, D.neu);
  }

  function zeichneDetail() {
    const { rec, neu } = S.detail;
    const nurLesen = !darf('bearbeiten') || !!rec.geloescht_am;
    $('#d-titel').textContent = neu ? 'Neue Förderung' : (rec.kunde || '(ohne Namen)');
    const stK = E.status(rec), aK = E.aufgabe(rec, stK);
    const etikett = neu ? '' : stK.fertig ? '<span class="d-etikett p-fertig">Ausgezahlt</span>' : stK.ende ? `<span class="d-etikett p-ende">${esc(stK.ende.label)}</span>`
      : `<span class="d-etikett p-${aK.phase}">${esc((E.PHASEN.find(p => p.key === aK.phase) || {}).label || '')} · ${esc(aK.kurz || aK.todo)}</span>`;
    $('#d-sub').innerHTML = neu ? '' : etikett + ' ' + esc([rec.plz, rec.ort].filter(Boolean).join(' ')) +
      (rec.geaendert_von ? ` <span class="grau">· zuletzt ${esc(rec.geaendert_von)}, ${new Date(rec.geaendert_am).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</span>` : '') +
      (rec.geloescht_am ? ' · <b class="rot">im Papierkorb</b>' : '');
    $('#d-inhalt').innerHTML = `
      <div id="d-jetzt">${jetztHtml(rec, nurLesen, neu)}</div>
      <div class="detail-raster">
        <section class="karte karte-ablauf"><h3><svg><use href="#i-bolt"/></svg>Ablauf</h3><div id="d-ablauf">${ablaufHtml(rec, nurLesen)}</div></section>
        <div class="detail-felder">
          ${FORM.map(sec => `<section class="karte"><h3>${esc(sec.titel)}</h3><div class="felder">${sec.felder.map(f => feldHtml(f, rec, nurLesen)).join('')}</div></section>`).join('')}
          ${neu ? '' : `<section class="karte"><h3><svg><use href="#i-history"/></svg>Verlauf</h3><div id="d-verlauf" class="verlauf grau">wird geladen …</div></section>`}
        </div>
      </div>`;
    const loeschBtn = $('#d-loeschen');
    loeschBtn.hidden = neu || !darf('bearbeiten');
    if (!neu) {
      loeschBtn.innerHTML = rec.geloescht_am
        ? '<svg><use href="#i-restore"/></svg><span>Wiederherstellen</span>'
        : '<svg><use href="#i-trash"/></svg><span>In Papierkorb</span>';
      loeschBtn.className = 'btn ' + (rec.geloescht_am ? '' : 'btn-gefahr-leise');
      const endg = document.getElementById('d-endgueltig');
      if (endg) endg.remove();
      if (rec.geloescht_am && darf('admin')) {
        loeschBtn.insertAdjacentHTML('afterend', '<button class="btn btn-gefahr-leise" id="d-endgueltig"><svg><use href="#i-trash"/></svg><span>Endgültig löschen</span></button>');
      }
    }
    $('#d-speichern').hidden = nurLesen;
    aktualisiereStatus();
    if (!neu) ladeVerlauf(rec.id);
  }

  function formWert(el) {
    const k = el.name;
    const f = FORM.flatMap(s => s.felder).find(x => x.k === k);
    let v = el.value;
    if (f && f.typ === 'number') {
      v = v.trim() === '' ? null : Number(v.replace(/\s/g, '').replace(',', '.'));
      if (v !== null && !isFinite(v)) v = S.detail.rec[k];
      if (k === 'jahr' && v) v = Math.round(v);
    } else if (f && f.typ === 'date') v = v || null;
    else v = v.trim();
    return v;
  }

  function aenderungen() {
    const { rec, orig } = S.detail;
    const patch = {};
    E.FELDER.forEach(k => { if (JSON.stringify(rec[k] === undefined ? null : rec[k]) !== JSON.stringify(orig[k] === undefined ? null : orig[k])) patch[k] = rec[k]; });
    return patch;
  }

  function aktualisiereStatus() {
    const n = Object.keys(aenderungen()).length;
    $('#d-status').textContent = n ? 'Ungespeicherte Änderungen' : '';
    $('#d-status').classList.toggle('warn', !!n);
  }

  function aufFormEingabe(e) {
    if (!S.detail) return;
    const el = e.target;
    const rec = S.detail.rec;
    if (el.dataset.schritt) {
      const key = el.dataset.schritt;
      const s = Object.assign({}, rec.schritte);
      if (el.checked) s[key] = heute(); else delete s[key];
      rec.schritte = s;
      ablaufNeu();
    } else if (el.dataset.schrittDatum) {
      if (e.type !== 'change') return;
      const key = el.dataset.schrittDatum;
      const s = Object.assign({}, rec.schritte);
      if (el.value) s[key] = el.value; else delete s[key];
      rec.schritte = s;
      ablaufNeu();
    } else if (el.name) {
      rec[el.name] = formWert(el);
      if (el.name === 'offene_punkte' && e.type === 'change') $('#d-jetzt').innerHTML = jetztHtml(rec, false, S.detail.neu);
      if (['kunde', 'strasse', 'plz', 'ort', 'zaehlpunkt', 'mail', 'kwp', 'speicher', 'art', 'zieher', 'programm'].includes(el.name) && e.type === 'change') {
        ablaufNeu();
        ['zaehlpunkt', 'kwp'].forEach(k => { const h = document.getElementById('h-' + k); if (h) h.innerHTML = feldHinweis(k, rec); });
      }
    }
    aktualisiereStatus();
  }

  // Gleiche Projekt-Nr. oder FPJ = sicher doppelt (hart); gleicher Kunde/Zählpunkt im selben Jahr = wahrscheinlich (weich)
  function doppelte(rec, neu, orig) {
    const nr = v => (v || '').replace(/\s/g, '').toUpperCase();
    const andere = S.daten.filter(d => d.id !== rec.id && !d.geloescht_am);
    const nrGeaendert = neu || nr(rec.projekt_nr) !== nr(orig.projekt_nr) || nr(rec.fpj) !== nr(orig.fpj);
    const hart = !nrGeaendert ? [] : andere.filter(d =>
      (nr(rec.projekt_nr) && nr(d.projekt_nr) === nr(rec.projekt_nr)) || (nr(rec.fpj) && nr(d.fpj) === nr(rec.fpj)));
    const zp = E.zpNorm(rec.zaehlpunkt);
    const weich = !neu ? [] : andere.filter(d => !hart.includes(d) && d.jahr === rec.jahr &&
      (E.gleicherKunde(d, rec) || (zp.length >= 20 && E.zpNorm(d.zaehlpunkt) === zp && !/erweiterung/i.test(rec.kunde))));
    return { hart, weich };
  }

  function doppeltFrage({ hart, weich }) {
    return new Promise(res => {
      const t = hart[0] || weich[0];
      const was = hart.length
        ? (t.projekt_nr && t.projekt_nr.replace(/\s/g, '').toUpperCase() === (S.detail.rec.projekt_nr || '').replace(/\s/g, '').toUpperCase() ? 'Projekt-Nr. ' + t.projekt_nr : 'FPJ-Nr. ' + t.fpj)
        : 'diesen Kunden';
      const o = document.createElement('div');
      o.className = 'overlay overlay-frage';
      o.innerHTML = `<div class="panel panel-klein" role="alertdialog" aria-modal="true"><div class="panel-inhalt">
          <p><b>${hart.length ? 'Dieses Projekt gibt es schon.' : 'Diesen Kunden gibt es vermutlich schon.'}</b></p>
          <p class="grau">Es gibt bereits einen Eintrag mit ${esc(was)}:</p>
          <div class="doppelt-karte"><b>${esc(t.kunde)}</b><span class="grau">${esc([[t.plz, t.ort].filter(Boolean).join(' '), t.projekt_nr, t.jahr].filter(Boolean).join(' · '))}</span></div>
          ${hart.length ? '<p class="klein grau">Ein Projekt darf nur einmal angelegt werden.</p>' : '<p class="klein grau">Nur „trotzdem anlegen“, wenn es wirklich ein eigenes Projekt ist (z. B. eine Erweiterung).</p>'}
        </div>
        <footer class="panel-fuss"><button class="btn" data-a="nein">Abbrechen</button>
          ${hart.length ? '' : '<button class="btn" data-a="trotzdem">Trotzdem anlegen</button>'}
          <button class="btn btn-primaer" data-a="oeffnen">Vorhandenen öffnen</button></footer></div>`;
      const zu = v => { o.remove(); document.removeEventListener('keydown', taste, true); res(v); };
      const taste = e => { if (e.key === 'Escape') { e.stopPropagation(); zu(false); } };
      o.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (a) zu(a.dataset.a); else if (e.target === o) zu(false); });
      document.addEventListener('keydown', taste, true);
      document.body.appendChild(o);
      $('[data-a="oeffnen"]', o).focus();
    });
  }

  async function speichern() {
    const D = S.detail;
    if (!D) return;
    // Formularwerte übernehmen (falls "change" noch nicht gefeuert hat)
    $$('#d-inhalt [name]').forEach(el => { D.rec[el.name] = formWert(el); });
    const rec = D.rec;
    if (!rec.kunde) { toast('Bitte einen Kunden eintragen.', 'fehler'); $('#d-inhalt [name="kunde"]').focus(); return; }
    // Doppelte Projekte verhindern
    const dopp = doppelte(rec, D.neu, D.orig);
    if (dopp.hart.length || dopp.weich.length) {
      const antwort = await doppeltFrage(dopp);
      if (antwort === 'oeffnen') { schliesseDetail(true); oeffne(dopp.hart[0] || dopp.weich[0]); return; }
      if (antwort !== 'trotzdem') return;
    }
    // Ticket / FPJ eingetragen → Schritt automatisch abhaken
    const s = Object.assign({}, rec.schritte);
    if (rec.ticket && !s.ticket) s.ticket = heute();
    if (rec.fpj && !s.projekt) s.projekt = heute();
    rec.schritte = s;
    const patch = D.neu ? E.FELDER.reduce((o, k) => { o[k] = rec[k] === undefined ? null : rec[k]; return o; }, {}) : aenderungen();
    if (!D.neu && !Object.keys(patch).length) { schliesseDetail(true); return; }
    $('#d-speichern').disabled = true;
    try {
      let neu;
      if (D.neu) {
        neu = await Q.anlegen(patch);
        S.daten.push(neu);
      } else {
        neu = await Q.aendern(rec.id, patch, D.orig.geaendert_am);
        const i = S.daten.findIndex(x => x.id === rec.id);
        if (i >= 0) S.daten[i] = neu;
      }
      toast('Gespeichert.', 'ok');
      fuelleFilter();
      zeichne();
      schliesseDetail(true);
    } catch (e) {
      if (e.konflikt) {
        toast('Jemand anderer hat diesen Eintrag inzwischen geändert. Bitte schließen und neu öffnen – deine Änderungen wurden nicht gespeichert.', 'fehler');
        laden(true);
      } else toast('Speichern fehlgeschlagen: ' + E.fehlerText(e), 'fehler');
    } finally {
      $('#d-speichern').disabled = false;
    }
  }

  async function schliesseDetail(ohneFrage) {
    if (!S.detail) return;
    if (!ohneFrage && Object.keys(aenderungen()).length && darf('bearbeiten')) {
      if (!(await frage('Es gibt ungespeicherte Änderungen. Trotzdem schließen?', 'Verwerfen', true))) return;
    }
    S.detail = null;
    $('#detail').hidden = true;
    document.body.classList.remove('modal-offen');
  }

  async function papierkorb() {
    const D = S.detail;
    if (!D || D.neu) return;
    const zurueck = !!D.rec.geloescht_am;
    if (!zurueck && !(await frage(`„${D.rec.kunde}“ in den Papierkorb verschieben?`, 'In Papierkorb', true))) return;
    try {
      const neu = await Q.aendern(D.rec.id, { geloescht_am: zurueck ? null : new Date().toISOString() }, D.orig.geaendert_am);
      const i = S.daten.findIndex(x => x.id === D.rec.id);
      if (i >= 0) S.daten[i] = neu;
      toast(zurueck ? 'Wiederhergestellt.' : 'In den Papierkorb verschoben.', 'ok');
      schliesseDetail(true); zeichne();
    } catch (e) {
      toast(e.konflikt ? 'Eintrag wurde inzwischen geändert – bitte neu öffnen.' : E.fehlerText(e), 'fehler');
    }
  }

  async function endgueltigLoeschen() {
    const D = S.detail;
    if (!D || !darf('admin')) return;
    if (!(await frage(`„${D.rec.kunde}“ endgültig löschen? Das kann nicht rückgängig gemacht werden.`, 'Endgültig löschen', true))) return;
    try {
      await Q.loeschen(D.rec.id);
      S.daten = S.daten.filter(x => x.id !== D.rec.id);
      toast('Endgültig gelöscht.', 'ok');
      schliesseDetail(true); fuelleFilter(); zeichne();
    } catch (e) { toast(E.fehlerText(e), 'fehler'); }
  }

  function wertText(k, v) {
    if (v === null || v === undefined || v === '') return '–';
    if (k === 'geloescht_am') return v ? 'verschoben' : 'wiederhergestellt';
    if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return datumDE(v);
    return String(v);
  }

  async function ladeVerlauf(id) {
    try {
      const rows = await Q.verlauf(id);
      const el = $('#d-verlauf');
      if (!el || !S.detail || S.detail.rec.id !== id) return;
      if (!rows.length) { el.textContent = 'Noch keine Einträge.'; return; }
      el.classList.remove('grau');
      el.innerHTML = rows.map(r => {
        const zeit = new Date(r.zeit).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' });
        const teile = [];
        Object.entries(r.aenderungen || {}).forEach(([k, [alt, neu]]) => {
          if (k === 'schritte') {
            const a = alt || {}, n = neu || {};
            Array.from(new Set(Object.keys(a).concat(Object.keys(n)))).forEach(key => {
              if ((a[key] || '') === (n[key] || '')) return;
              const label = esc(ALLE_LABEL[key] || key), v = n[key];
              teile.push(v ? `<b>${label}</b> ✓${v !== '✓' ? ' (' + esc(E.istDatum(v) ? datumDE(v) : callsText(v)) + ')' : ''}` : `<b>${label}</b> zurückgenommen`);
            });
          } else if (k === 'geloescht_am') {
            teile.push(neu ? '<b>in Papierkorb verschoben</b>' : '<b>wiederhergestellt</b>');
          } else {
            teile.push(`<b>${esc(FELD_LABEL[k] || k)}</b>: ${esc(wertText(k, alt))} → ${esc(wertText(k, neu))}`);
          }
        });
        return `<div class="verlauf-zeile"><span class="verlauf-zeit">${esc(zeit)} · ${esc(r.von || '?')}</span><span>${r.aktion === 'angelegt' ? 'angelegt' : teile.join('; ') || esc(r.aktion)}</span></div>`;
      }).join('');
    } catch (e) {
      const el = $('#d-verlauf'); if (el) el.textContent = 'Verlauf konnte nicht geladen werden.';
    }
  }

  // ---------------------------------------------------------------
  // Dialog-Helfer
  // ---------------------------------------------------------------
  function dialog(titel, inhalt, fuss) {
    $('#dlg-titel').textContent = titel;
    $('#dlg-inhalt').innerHTML = inhalt;
    $('#dlg-fuss').innerHTML = fuss || '<button class="btn" data-aktion="dialog-zu">Schließen</button>';
    $('#dialog').hidden = false;
    document.body.classList.add('modal-offen');
  }
  function dialogZu() {
    $('#dialog').hidden = true;
    if ($('#detail').hidden) document.body.classList.remove('modal-offen');
  }

  // ---------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------
  function exportieren() {
    if (!window.XLSX) { toast('Excel-Modul lädt noch – bitte gleich nochmal.', 'fehler'); return; }
    const liste = sortiere(aktuelleListe());
    const zeilen = liste.map(({ d, st }) => {
      const z = {
        'Jahr': d.jahr, 'Programm': d.programm, 'Fördercall': datumDE(d.foerdercall), 'Mitarbeiter': d.mitarbeiter, 'Ticket-Zieher': d.zieher,
        'Kunde': d.kunde, 'Geb. Dat': datumDE(d.geburtsdatum), 'Vollmacht': d.vollmacht, 'Straße': d.strasse, 'PLZ': d.plz, 'Ort': d.ort,
        'KG Grundstücksnummer': d.kg_gst, 'Einspeisezählpunkt': d.zaehlpunkt, 'Mail': d.mail, 'Projekt': d.projekt_nr,
        'Größe kWp': d.kwp, 'Modulfläche m²': d.modulflaeche, 'Einspeisung': d.einspeisung, 'WR Nennleistung': d.wr_leistung,
        'Speicher': d.speicher, 'Anbringung': d.anbringung, 'Zeitplan': d.zeitplan, 'Art': d.art, 'Ticket': d.ticket, 'FPJ': d.fpj
      };
      SCHRITTE.filter(s => !s.auto).forEach(s => { const w = (d.schritte || {})[s.key]; z[s.label] = w ? (w === '✓' ? '✓' : datumDE(w)) : ''; });
      Object.keys(E.NEBEN).forEach(k => { const w = (d.schritte || {})[k]; z[E.NEBEN[k]] = w ? (E.istDatum(w) ? datumDE(w) : callsText(w)) : ''; });
      const ew = st.ende ? (d.schritte || {})[st.ende.key] : '';
      const fr = E.fristen(d, heute())[0];
      z['Ergebnis'] = st.ende ? st.ende.label + (E.istDatum(ew) ? ' ' + datumDE(ew) : '') : '';
      z['Nächster Schritt'] = st.fertig ? 'fertig' : st.ende ? '' : E.aufgabe(d, st).todo;
      z['Nächste Frist'] = fr ? `${fr.label}: ${fr.datum ? datumDE(fr.datum) : 'unbekannt'}` : '';
      z['Offene Punkte'] = d.offene_punkte; z['Info'] = d.info;
      return z;
    });
    const X = window.XLSX;
    const ws = X.utils.json_to_sheet(zeilen);
    const spalten = Object.keys(zeilen[0] || { Kunde: '' });
    ws['!cols'] = spalten.map(k => ({ wch: Math.min(40, Math.max(k.length, ...zeilen.map(z => String(z[k] === null || z[k] === undefined ? '' : z[k]).length)) + 2) }));
    ws['!autofilter'] = { ref: ws['!ref'] };
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Förderungen');
    X.writeFile(wb, `EAG-Foerderungen_${heute()}.xlsx`);
  }

  // ---------------------------------------------------------------
  // Automatisch aufteilen ("Würfeln"): offene Kunden eines Fördercalls
  // zufällig und gleichmäßig auf die Ticket-Zieher verteilen
  // ---------------------------------------------------------------
  let wurf = null;

  function zufall(n) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  }
  function mischen(liste) {
    const a = liste.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = zufall(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function wuerfelKandidaten(call, alle) {
    return S.daten.filter(d => {
      if (d.geloescht_am) return false;
      if (call === 'ohne' ? !!d.foerdercall : d.foerdercall !== call) return false;
      if (E.status(d).hoechster >= E.IDX.ticket) return false; // Ticket schon gezogen
      return alle || !(d.zieher || '').trim();
    });
  }

  function wuerfelDialog() {
    wurf = null;
    const namen = speicherLokal.lesen('zieherliste', null) || zieherWerte();
    const offen = S.daten.filter(d => !d.geloescht_am && !(d.zieher || '').trim() && E.status(d).hoechster < E.IDX.ticket);
    const calls = werte('foerdercall').sort().reverse();
    const vorschlag = S.filter.call && S.filter.call !== 'ohne' ? S.filter.call
      : (calls.find(c => offen.some(d => d.foerdercall === c)) || calls[0] || 'ohne');
    const callOpt = calls.concat(S.daten.some(d => !d.foerdercall) ? ['ohne'] : [])
      .map(c => `<option value="${esc(c)}" ${c === vorschlag ? 'selected' : ''}>${c === 'ohne' ? 'ohne Fördercall' : 'Fördercall ' + datumDE(c)}</option>`).join('');
    dialog('Ticket-Zieher automatisch aufteilen', `
      <p class="grau">Die App verteilt die Kunden zufällig und gleichmäßig. Du siehst das Ergebnis, bevor etwas gespeichert wird.</p>
      <div class="wuerfel-raster">
        <label class="feld"><span>Ticket-Zieher (ein Name pro Zeile)</span>
          <textarea id="w-namen" rows="8" placeholder="Verena&#10;Thomas&#10;Bianca">${esc(namen.join('\n'))}</textarea></label>
        <div class="wuerfel-optionen">
          <label class="feld"><span>Welche Kunden?</span><select id="w-call">${callOpt}</select></label>
          <label class="feld"><span>Höchstens Kunden pro Person (leer = egal)</span><input id="w-max" type="text" inputmode="numeric" placeholder="z. B. 5"></label>
          <label class="haken-zeile"><input type="checkbox" id="w-alle"> Auch schon zugeteilte Kunden neu verteilen</label>
          <div id="w-anzahl" class="klein grau"></div>
        </div>
      </div>
      <div id="w-ergebnis"></div>`,
      `<button class="btn" data-aktion="dialog-zu">Abbrechen</button>
       <button class="btn" id="w-excel" disabled><svg><use href="#i-download"/></svg><span>Excel zum Versenden</span></button>
       <button class="btn btn-wuerfel" id="w-los"><svg><use href="#i-dice"/></svg><span>Würfeln</span></button>
       <button class="btn btn-primaer" id="w-uebernehmen" disabled><svg><use href="#i-check"/></svg><span>Übernehmen</span></button>`);
    wuerfelAnzahl();
  }

  function wuerfelAnzahl() {
    const el = $('#w-anzahl');
    if (!el) return;
    const k = wuerfelKandidaten($('#w-call').value, $('#w-alle').checked);
    el.textContent = `${k.length} ${k.length === 1 ? 'Kunde wird' : 'Kunden werden'} verteilt.`;
  }

  function wuerfeln() {
    const namen = Array.from(new Set($('#w-namen').value.split(/\n|,|;/).map(s => s.trim()).filter(Boolean)));
    if (!namen.length) { toast('Bitte mindestens einen Ticket-Zieher eintragen.', 'fehler'); return; }
    speicherLokal.schreiben('zieherliste', namen);
    const call = $('#w-call').value;
    const max = parseInt($('#w-max').value, 10) || Infinity;
    const kunden = mischen(wuerfelKandidaten(call, $('#w-alle').checked));
    if (!kunden.length) { toast('Für diese Auswahl gibt es keine offenen Kunden.', 'fehler'); return; }
    const reihe = mischen(namen);
    const verteilung = new Map(reihe.map(n => [n, []]));
    const rest = [];
    kunden.forEach(d => {
      // reihum, beginnend bei einer zufälligen Reihenfolge der Namen
      const frei = reihe.filter(n => verteilung.get(n).length < max);
      if (!frei.length) { rest.push(d); return; }
      const minimum = Math.min(...frei.map(n => verteilung.get(n).length));
      const kandidat = frei.find(n => verteilung.get(n).length === minimum);
      verteilung.get(kandidat).push(d);
    });
    wurf = { call, verteilung, rest };
    const karten = namen.map(n => {
      const l = verteilung.get(n);
      return `<div class="wurf-karte"><div class="wurf-kopf"><b>${esc(n)}</b><span>${l.length}</span></div>
        ${l.length ? `<ul>${l.map(d => `<li>${esc(d.kunde)}${d.ort ? `<span class="grau"> · ${esc(d.ort)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="grau klein">keine Kunden</p>'}</div>`;
    }).join('');
    $('#w-ergebnis').innerHTML = `<h4 class="wurf-titel">Ergebnis</h4><div class="wurf-raster">${karten}</div>
      ${rest.length ? `<p class="rot klein">${rest.length} Kunden bleiben übrig (Höchstzahl erreicht): ${esc(rest.map(d => d.kunde).join(', '))}</p>` : ''}`;
    $('#w-los span').textContent = 'Neu würfeln';
    $('#w-excel').disabled = false;
    $('#w-uebernehmen').disabled = false;
  }

  async function wuerfelUebernehmen() {
    if (!wurf) return;
    const btn = $('#w-uebernehmen');
    btn.disabled = true;
    let ok = 0, fehler = 0;
    for (const [name, liste] of wurf.verteilung) {
      for (const d of liste) {
        if (d.zieher === name) { ok++; continue; }
        try {
          const neu = await Q.aendern(d.id, { zieher: name }, d.geaendert_am);
          Object.assign(d, neu); ok++;
        } catch (e) { fehler++; }
      }
    }
    toast(`${ok} Kunden zugeteilt${fehler ? `, ${fehler} Fehler – bitte Liste neu laden` : ''}.`, fehler ? 'fehler' : 'ok');
    dialogZu();
    fuelleFilter(); zeichne();
  }

  // Spalten wie in der bisherigen Excel-Liste der Ticket-Zieher
  function zieherZeile(d, name) {
    return {
      'Ticket-Zieher': name, 'Mitarbeiter': d.mitarbeiter, 'Kunde': d.kunde, 'Geb. Dat bei nat. Person': datumDE(d.geburtsdatum),
      'Vollmacht': d.vollmacht, 'Straße': d.strasse, 'PLZ': d.plz, 'Ort': d.ort, 'KG Grundstücksnummer': d.kg_gst,
      'Einspeisezählpunktnummer': d.zaehlpunkt, 'Mail': d.mail, 'Projekt': d.projekt_nr, 'Größe kWp': d.kwp,
      'Modulgröße m²': d.modulflaeche, 'Überschusseinspeiser Volleinspeiser': d.einspeisung === 'Überschuss' ? 'Ü' : d.einspeisung === 'Volleinspeisung' ? 'V' : d.einspeisung,
      'WR Nennleistung': d.wr_leistung, 'Speicher Nettokapazität': d.speicher, 'Anbringung PV': d.anbringung, 'Zeitplan': d.zeitplan,
      'Art der Förderung': d.art, 'Ticket gezogen Datum': '', 'Ticket': d.ticket, 'Projekt angelegt': d.fpj
    };
  }

  function blattName(n, benutzt) {
    let b = n.replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31).trim() || 'Zieher';
    let i = 2;
    while (benutzt.has(b)) b = (b.slice(0, 28) + ' ' + i++);
    benutzt.add(b);
    return b;
  }

  function wuerfelExcel() {
    if (!wurf || !window.XLSX) return;
    const X = window.XLSX;
    const wb = X.utils.book_new();
    const breiten = z => Object.keys(z[0] || {}).map(k => ({ wch: Math.min(38, Math.max(k.length, ...z.map(r => String(r[k] === null || r[k] === undefined ? '' : r[k]).length)) + 2) }));
    const uebersicht = [];
    wurf.verteilung.forEach((l, n) => l.forEach(d => uebersicht.push({ 'Ticket-Zieher': n, 'Kunde': d.kunde, 'Ort': d.ort, 'Mitarbeiter': d.mitarbeiter, 'Projekt': d.projekt_nr })));
    const ws0 = X.utils.json_to_sheet(uebersicht);
    ws0['!cols'] = breiten(uebersicht);
    const benutzt = new Set(['Übersicht']);
    X.utils.book_append_sheet(wb, ws0, 'Übersicht');
    wurf.verteilung.forEach((l, n) => {
      const zeilen = l.map(d => zieherZeile(d, n));
      const ws = zeilen.length ? X.utils.json_to_sheet(zeilen) : X.utils.aoa_to_sheet([['keine Kunden']]);
      if (zeilen.length) ws['!cols'] = breiten(zeilen);
      X.utils.book_append_sheet(wb, ws, blattName(n, benutzt));
    });
    X.writeFile(wb, `Ticket-Aufteilung_${wurf.call === 'ohne' ? 'ohne-Call' : wurf.call}.xlsx`);
  }

  // ---------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------
  let importStand = null;
  function importDialog() {
    importStand = null;
    dialog('Excel-Liste importieren', `
      <p>Wähle deine bisherige Förderliste (z. B. <i>Förderungen EAG 2026.xlsx</i>). Die Datei wird nur hier im Browser gelesen.</p>
      <ul class="liste-punkte klein grau">
        <li>Übernommen werden die Blätter mit Titelzeile (2025, 2026, Speicherförderungen, …). Die Namens-Blätter (Verena, Thomas, …) ergeben den <b>Ticket-Zieher</b>.</li>
        <li>Doppelte Kunden werden zusammengeführt. Schon vorhandene Einträge werden nur <b>ergänzt</b>, nie überschrieben.</li>
        <li>Zugangsdaten aus der Liste (Portal-Login) werden <b>nicht</b> übernommen.</li>
      </ul>
      <label class="feld"><span>Standard-Jahr für Blätter ohne Jahreszahl</span><input type="number" id="imp-jahr" value="${new Date().getFullYear()}" class="schmal"></label>
      <label class="datei"><input type="file" id="imp-datei" accept=".xlsx,.xlsm,.xls"><svg><use href="#i-doc"/></svg><span>Excel-Datei auswählen …</span></label>
      <div id="imp-ergebnis"></div>`,
      '<button class="btn" data-aktion="dialog-zu">Abbrechen</button><button class="btn btn-primaer" id="imp-los" disabled><svg><use href="#i-upload"/></svg>Importieren</button>');
  }

  async function importDatei(file) {
    const erg = $('#imp-ergebnis');
    erg.innerHTML = '<p class="grau">Wird gelesen …</p>';
    try {
      if (!window.XLSX) throw new Error('Excel-Modul noch nicht geladen – bitte kurz warten.');
      const buf = await file.arrayBuffer();
      importAusBuffer(buf, file.name);
    } catch (e) {
      erg.innerHTML = `<p class="rot">${esc(e.message || e)}</p>`;
    }
  }

  function importAusBuffer(buf, dateiname) {
    const erg = $('#imp-ergebnis');
    const jahr = +($('#imp-jahr').value || new Date().getFullYear());
    const a = window.EAG_IMPORT.analysiere(buf, jahr);
    const ab = window.EAG_IMPORT.abgleich(a.eintraege, S.daten);
    importStand = ab;
    erg.innerHTML = `
      <h4>${esc(dateiname || '')}</h4>
      <table class="mini-tabelle"><thead><tr><th>Blatt</th><th>Art</th><th class="r">Zeilen</th></tr></thead><tbody>
        ${a.blaetter.map(b => `<tr><td>${esc(b.name)}${b.versteckt ? ' <span class="grau">(ausgeblendet)</span>' : ''}</td><td>${b.zuteilung ? 'Ticket-Zieher' : 'Liste ' + b.jahr}</td><td class="r">${b.anzahl}</td></tr>`).join('')}
      </tbody></table>
      <div class="imp-zahlen">
        <div><b>${ab.neu.length}</b><span>neu</span></div>
        <div><b>${ab.ergaenzen.length}</b><span>vorhandene ergänzen</span></div>
        <div><b>${ab.gleich.length}</b><span>schon aktuell</span></div>
        <div><b>${a.doppelt}</b><span>Doppelte zusammengeführt</span></div>
      </div>
      ${(() => { const n = ab.neu.filter(f => f._abgelehntIm).length + ab.ergaenzen.filter(e => e.neuAngesucht).length; const c = E.offenerCall(heute());
        return n ? `<div class="imp-hinweise"><b><svg><use href="#i-restore"/></svg>${n} in der Liste orange markiert (abgelehnt)</b><ul><li>${c ? `Werden in den Call ${esc(datumDE(c))} übernommen: Ticket und Einreichung zurückgesetzt, Portal-Projekt bleibt.` : 'Kein Call mehr offen – sie werden als abgelehnt gespeichert.'}</li></ul></div>` : ''; })()}
      ${a.hinweise.length ? `<div class="imp-hinweise"><b><svg><use href="#i-alert"/></svg>Bitte nach dem Import prüfen (${a.hinweise.length})</b><ul>${a.hinweise.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
      <details class="imp-vorschau"><summary>Vorschau der neuen Einträge</summary>
        <table class="mini-tabelle"><thead><tr><th>Kunde</th><th>Jahr</th><th>Call</th><th>Zieher</th><th>Stand</th><th>aus</th></tr></thead><tbody>
        ${ab.neu.map(f => { const st = E.status(f); return `<tr><td>${esc(f.kunde)}</td><td>${f.jahr}</td><td>${esc(datumDE(f.foerdercall))}</td><td>${esc(f.zieher)}</td><td>${st.fertig ? 'ausgezahlt' : esc(SCHRITTE[st.naechster].kurz)}</td><td class="grau klein">${esc(f._quellen.join(', '))}</td></tr>`; }).join('')}
        </tbody></table></details>`;
    $('#imp-los').disabled = !(ab.neu.length || ab.ergaenzen.length);
    return { analyse: a, abgleich: ab };
  }

  async function importAusfuehren() {
    if (!importStand) return;
    const btn = $('#imp-los');
    btn.disabled = true;
    const { neu, ergaenzen } = importStand;
    let ok = 0, fehler = 0;
    try {
      if (neu.length) { await Q.massenAnlegen(neu.map(window.EAG_IMPORT.sauber)); ok += neu.length; }
      for (const e of ergaenzen) {
        try { await Q.aendern(e.ziel.id, e.patch, e.ziel.geaendert_am); ok++; } catch (err) { fehler++; }
      }
      toast(`Import fertig: ${ok} übernommen${fehler ? `, ${fehler} Fehler` : ''}.`, fehler ? 'fehler' : 'ok');
      dialogZu();
      S.filter.jahr = ''; S.filter.schritt = '';
      await laden();
    } catch (e) {
      toast('Import fehlgeschlagen: ' + E.fehlerText(e), 'fehler');
      btn.disabled = false;
    }
  }

  // ---------------------------------------------------------------
  // Nutzer & Rollen
  // ---------------------------------------------------------------
  const ROLLEN = [['admin', 'Admin – alles'], ['bearbeiten', 'Bearbeiten'], ['lesen', 'Nur lesen']];
  async function nutzerDialog() {
    let liste = [], offen = [];
    try { [liste, offen] = await Promise.all([Q.nutzerListe(), Q.offeneKonten()]); } catch (e) { toast(E.fehlerText(e), 'fehler'); return; }
    const rolleSel = (v, dis) => `<select data-feld="rolle" ${dis ? 'disabled' : ''}>${ROLLEN.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    dialog('Nutzer & Rollen', `
      <h4 class="nutzer-titel">Warten auf Freischaltung</h4>
      ${offen.length ? `<table class="mini-tabelle nutzer-tabelle"><tbody>${offen.map(k => `<tr data-offen="${esc(k.email)}">
          <td class="mono klein">${esc(k.email)}<br><span class="grau">registriert ${esc(new Date(k.registriert_am).toLocaleDateString('de-AT'))}</span></td>
          <td><input data-feld="name" placeholder="Name"></td>
          <td>${rolleSel('bearbeiten')}</td>
          <td class="nutzer-knoepfe"><button class="btn btn-gefahr-leise" data-ablehnen><svg><use href="#i-close"/></svg>Ablehnen</button><button class="btn btn-primaer" data-freischalten><svg><use href="#i-check"/></svg>Freischalten</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="klein grau">Niemand. Neue Kolleg:innen registrieren sich zuerst selbst auf der Login-Seite („Registrieren“) und erscheinen dann hier. Bitte nur Personen freischalten, die du kennst.</p>'}
      <h4 class="nutzer-titel">Freigeschaltet</h4>
      <table class="mini-tabelle nutzer-tabelle"><thead><tr><th>E-Mail</th><th>Name</th><th>Rolle</th><th></th></tr></thead><tbody>
        ${liste.map(n => { const selbst = n.email === S.ich.email; return `<tr data-mail="${esc(n.email)}">
          <td class="mono klein">${esc(n.email)}</td>
          <td><input data-feld="name" value="${esc(n.name)}"></td>
          <td>${rolleSel(n.rolle, selbst)}</td>
          <td>${selbst ? '<span class="grau klein">du</span>' : '<button class="btn btn-leise btn-rund" data-nutzer-weg title="Zugang entfernen"><svg><use href="#i-trash"/></svg></button>'}</td></tr>`; }).join('')}
      </tbody></table>`);
  }

  async function nutzerAktion(e) {
    const zeile = e.target.closest('tr[data-mail]');
    const offenZeile = e.target.closest('tr[data-offen]');
    if (offenZeile && e.target.closest('[data-ablehnen]')) {
      const email = offenZeile.dataset.offen;
      if (!(await frage(`Registrierung von ${email} ablehnen? Das Konto wird gelöscht.`, 'Ablehnen', true))) return;
      try { await Q.kontoAblehnen(email); toast(email + ' wurde abgelehnt.', 'ok'); nutzerDialog(); pruefeFreischaltungen(); }
      catch (err) { toast(E.fehlerText(err), 'fehler'); }
      return;
    }
    if (offenZeile && e.target.closest('[data-freischalten]')) {
      const email = offenZeile.dataset.offen;
      try {
        await Q.nutzerSpeichern({ email, name: $('[data-feld="name"]', offenZeile).value.trim(), rolle: $('[data-feld="rolle"]', offenZeile).value });
        toast(email + ' ist freigeschaltet.', 'ok'); nutzerDialog(); pruefeFreischaltungen();
      } catch (err) { toast(E.fehlerText(err), 'fehler'); }
      return;
    }
    if (zeile && e.target.closest('[data-nutzer-weg]')) {
      const mail = zeile.dataset.mail;
      if (!(await frage(`Zugang für ${mail} entfernen?`, 'Entfernen', true))) return;
      try { await Q.nutzerLoeschen(mail); nutzerDialog(); pruefeFreischaltungen(); } catch (err) { toast(E.fehlerText(err), 'fehler'); }
    }
  }

  async function nutzerAendern(e) {
    const zeile = e.target.closest('tr[data-mail]');
    if (!zeile || !e.target.dataset.feld) return;
    try {
      await Q.nutzerSpeichern({ email: zeile.dataset.mail, name: $('[data-feld="name"]', zeile).value.trim(), rolle: $('[data-feld="rolle"]', zeile).value });
      toast('Gespeichert.', 'ok');
    } catch (err) { toast(E.fehlerText(err), 'fehler'); }
  }

  function passwortDialog(nachLink) {
    dialog(nachLink ? 'Neues Passwort festlegen' : 'Passwort ändern', `
      <label class="feld"><span>Neues Passwort (mind. 8 Zeichen)</span><input type="password" id="pw-neu" minlength="8" autocomplete="new-password"></label>
      <label class="feld"><span>Wiederholen</span><input type="password" id="pw-neu2" minlength="8" autocomplete="new-password"></label>`,
      '<button class="btn" data-aktion="dialog-zu">Abbrechen</button><button class="btn btn-primaer" id="pw-los">Speichern</button>');
    setTimeout(() => $('#pw-neu').focus(), 50);
  }
  async function passwortSpeichern() {
    const a = $('#pw-neu').value, b = $('#pw-neu2').value;
    if (a.length < 8) { toast('Mindestens 8 Zeichen.', 'fehler'); return; }
    if (a !== b) { toast('Die Passwörter stimmen nicht überein.', 'fehler'); return; }
    try { await Q.passwortSetzen(a); toast('Passwort geändert.', 'ok'); dialogZu(); } catch (e) { toast(E.fehlerText(e), 'fehler'); }
  }

  // ---------------------------------------------------------------
  // Ereignisse
  // ---------------------------------------------------------------
  function verbinden() {
    $('#login-form').addEventListener('submit', loginAbsenden);
    $('#login-modus').addEventListener('click', () => setzeLoginModus(loginModus === 'anmelden' ? 'registrieren' : 'anmelden'));
    $('#login-vergessen').addEventListener('click', () => setzeLoginModus('vergessen'));

    document.addEventListener('click', async e => {
      const a = e.target.closest('[data-aktion]');
      if (!$('#nutzer-menue').hidden && !e.target.closest('.kopf-nutzer')) $('#nutzer-menue').hidden = true;
      if (!a) return;
      if (a.closest('#nutzer-menue')) $('#nutzer-menue').hidden = true;
      switch (a.dataset.aktion) {
        case 'neu': oeffne(null); break;
        case 'export': exportieren(); break;
        case 'import': importDialog(); break;
        case 'nutzer': nutzerDialog(); break;
        case 'passwort': $('#nutzer-menue').hidden = true; passwortDialog(false); break;
        case 'abmelden': $('#nutzer-menue').hidden = true; await Q.abmelden(); S.ich = null; S.daten = []; zeige('login'); setzeLoginModus('anmelden'); break;
        case 'neu-laden': await laden(); toast('Aktualisiert.', 'ok'); break;
        case 'detail-zu': schliesseDetail(false); break;
        case 'dialog-zu': dialogZu(); break;
        case 'wuerfeln': wuerfelDialog(); break;
        case 'alle-neu-ansuchen': alleNeuAnsuchen(); break;
        case 'mehr-filter': $('#mehr-filter').hidden = !$('#mehr-filter').hidden; break;
        case 'filter-zurueck':
          Object.assign(S.filter, { suche: '', call: '', art: '', mitarbeiter: '', zieher: '', schritt: '', papierkorb: false });
          fuelleFilter(); zeichne(); break;
      }
    });
    $('#nutzer-btn').addEventListener('click', e => { e.stopPropagation(); $('#nutzer-menue').hidden = !$('#nutzer-menue').hidden; });

    $('#extra-filter').addEventListener('click', e => {
      const b = e.target.closest('[data-phase]');
      if (!b) return;
      S.phase = S.phase === b.dataset.phase ? '' : b.dataset.phase;
      S.aufgeklappt.clear();
      zeichne();
    });
    $('#reiter').addEventListener('click', e => {
      const x = e.target.closest('[data-extra]');
      if (x) { S.extra = S.extra === x.dataset.extra ? '' : x.dataset.extra; S.aufgeklappt.clear(); zeichne(); return; }
      const b = e.target.closest('[data-ansicht]');
      if (!b) return;
      S.ansicht = b.dataset.ansicht; S.aufgeklappt.clear();
      if (['todo', 'warten'].indexOf(S.ansicht) < 0) S.phase = '';
      zeichne();
    });

    let sucheTimer;
    $('#f-suche').addEventListener('input', e => { clearTimeout(sucheTimer); sucheTimer = setTimeout(() => { S.filter.suche = e.target.value.trim(); zeichne(); }, 150); });
    ['jahr', 'call', 'art', 'mitarbeiter', 'zieher'].forEach(k => $('#f-' + k).addEventListener('change', e => { S.filter[k] = e.target.value; zeichne(); }));
    $('#f-papierkorb').addEventListener('change', e => { S.filter.papierkorb = e.target.checked; zeichne(); });

    $('#liste').addEventListener('click', e => {
      const s = e.target.closest('[data-sort]');
      if (s) {
        S.sort = S.sort.k === s.dataset.sort ? { k: s.dataset.sort, auf: !S.sort.auf } : { k: s.dataset.sort, auf: true };
        speicherLokal.schreiben('sort', S.sort); zeichne(); return;
      }
      const mehr = e.target.closest('[data-mehr]');
      if (mehr) { S.aufgeklappt.add(mehr.dataset.mehr); zeichne(); return; }
      const q = e.target.closest('[data-schnell]');
      const tr = e.target.closest('tr[data-id], .zeile[data-id], .z[data-id]');
      if (q && tr) { e.stopPropagation(); schnellErledigt(tr.dataset.id, q.dataset.schnell); return; }
      if (e.target.closest('[data-neu-ansuchen]') && tr) { e.stopPropagation(); schnellNeuAnsuchen(tr.dataset.id); return; }
      if (tr) oeffne(S.daten.find(d => d.id === tr.dataset.id));
    });
    $('#liste').addEventListener('keydown', e => {
      const tr = e.target.closest('tr[data-id], .zeile[data-id], .z[data-id]');
      if (tr && e.key === 'Enter' && e.target === tr) oeffne(S.daten.find(d => d.id === tr.dataset.id));
    });

    $('#d-inhalt').addEventListener('input', aufFormEingabe);
    $('#d-inhalt').addEventListener('change', aufFormEingabe);
    $('#d-speichern').addEventListener('click', speichern);
    $('#d-inhalt').addEventListener('click', e => {
      if (e.target.closest('[data-zu-punkten]')) {
        const f = $('#d-inhalt [name="offene_punkte"]');
        f.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => f.focus(), 300);
        return;
      }
      const endeKnopf = e.target.closest('[data-ende]');
      if (endeKnopf && S.detail) {
        const sch = Object.assign({}, S.detail.rec.schritte);
        if (sch[endeKnopf.dataset.ende]) delete sch[endeKnopf.dataset.ende]; else sch[endeKnopf.dataset.ende] = heute();
        S.detail.rec.schritte = sch;
        ablaufNeu(); aktualisiereStatus();
        return;
      }
      if (e.target.closest('[data-neu-ansuchen-detail]') && S.detail) {
        try { Object.assign(S.detail.rec, E.neuAnsuchen(S.detail.rec, heute())); speichern(); } catch (err) { toast(err.message, 'fehler'); }
        return;
      }
      const b = e.target.closest('[data-jetzt]');
      if (!b || !S.detail) return;
      S.detail.rec.schritte = Object.assign({}, S.detail.rec.schritte, { [b.dataset.jetzt]: heute() });
      speichern();
    });
    $('#detail').addEventListener('click', e => {
      if (e.target.closest('#d-loeschen')) papierkorb();
      else if (e.target.closest('#d-endgueltig')) endgueltigLoeschen();
      else if (e.target.id === 'detail') schliesseDetail(false);
    });

    $('#dialog').addEventListener('change', e => {
      if (e.target.id === 'imp-datei' && e.target.files[0]) importDatei(e.target.files[0]);
      else if (e.target.id === 'w-call' || e.target.id === 'w-alle') wuerfelAnzahl();
      else nutzerAendern(e);
    });
    $('#dialog').addEventListener('click', e => {
      if (e.target.id === 'dialog') { dialogZu(); return; }
      if (e.target.closest('#imp-los')) importAusfuehren();
      else if (e.target.closest('#w-los')) wuerfeln();
      else if (e.target.closest('#w-excel')) wuerfelExcel();
      else if (e.target.closest('#w-uebernehmen')) wuerfelUebernehmen();
      else if (e.target.closest('#pw-los')) passwortSpeichern();
      else nutzerAktion(e);
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!$('#dialog').hidden) dialogZu();
        else if (!$('#detail').hidden) schliesseDetail(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.detail) { e.preventDefault(); speichern(); }
    });
    window.addEventListener('beforeunload', e => {
      if (S.detail && Object.keys(aenderungen()).length) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && S.ich && !S.detail && Date.now() - S.geladenUm > 60000) laden(true);
    });
  }

  // ---------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------
  async function start() {
    verbinden();
    if (Q.demo) document.body.classList.add('demo');
    Q.onAuth((ev, session) => {
      if (ev === 'PASSWORD_RECOVERY') { nachAnmeldung(session).then(() => passwortDialog(true)); return; }
      if (ev === 'SIGNED_IN' && !S.ich) nachAnmeldung(session);
      if (ev === 'SIGNED_OUT') { S.ich = null; zeige('login'); }
    });
    try {
      await nachAnmeldung(await Q.session());
    } catch (e) {
      zeige('login'); setzeLoginModus('anmelden');
    }
  }

  window.EAG_APP = { importAusBuffer, zustand: S };
  start();
})();
