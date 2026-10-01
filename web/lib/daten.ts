// Datenzugriff: Supabase (Schema eag, RLS) oder Demo im Speicher (?demo in der Adresse).
// Gelesen wird aus den Sichten, geschrieben NUR über eag.schritt_setzen / eag.schritt_entfernen –
// die prüfen die Zustandsfolge in der Datenbank (Ticket nur am Calltag, keine Lücken …).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import A, { type LegacyFoerderung } from './regeln/ablauf.js';
import { CONFIG } from './config';
import { SCHRITT_PHASE } from './meta';
import type { Antrag, Ereignis, Frist, FristArt, FristStufe, Ich, Schritt, Status } from './types';

export interface Quelle {
  demo: boolean;
  angemeldet(): Promise<string | null>;
  anmelden(mail: string, passwort: string): Promise<void>;
  abmelden(): Promise<void>;
  ich(): Promise<Ich | null>;
  antraege(): Promise<Antrag[]>;
  fristen(): Promise<Frist[]>;
  ereignisse(antragId: string): Promise<Ereignis[]>;
  schrittSetzen(antragId: string, schritt: Schritt, datum: string | null): Promise<void>;
  schrittEntfernen(antragId: string, schritt: Schritt): Promise<void>;
}

// Fehler aus der Datenbank in Klartext (die Prüf-Funktionen liefern schon deutsche Sätze)
export function fehlerText(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/Invalid login credentials/i.test(m)) return 'E-Mail oder Passwort falsch.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Keine Verbindung zum Server.';
  if (/permission denied|row-level security|Keine Berechtigung/i.test(m)) return 'Dafür fehlt dir die Berechtigung.';
  if (/schema must be one of|Could not find the table|PGRST106|PGRST205/i.test(m)) return 'Das Datenmodell v2 ist noch nicht eingespielt oder das Schema „eag“ ist nicht freigegeben (docs/EINSPIELEN.md, Abschnitt C).';
  return m;
}

// ---------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------
function supabaseQuelle(): Quelle {
  const sb: SupabaseClient = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const eag = () => sb.schema('eag');
  const pruefe = <T,>({ data, error }: { data: T | null; error: unknown }): T => { if (error) throw new Error(fehlerText(error)); return data as T; };
  return {
    demo: false,
    async angemeldet() { return (await sb.auth.getSession()).data.session?.user.email ?? null; },
    async anmelden(mail, passwort) { const { error } = await sb.auth.signInWithPassword({ email: mail, password: passwort }); if (error) throw new Error(fehlerText(error)); },
    async abmelden() { await sb.auth.signOut(); },
    async ich() {
      const mail = (await sb.auth.getSession()).data.session?.user.email?.toLowerCase();
      if (!mail) return null;
      const rows = pruefe(await sb.from('foerder_nutzer').select('email, name, rolle').eq('email', mail)) as Ich[];
      return rows[0] ?? null;
    },
    async antraege() {
      return pruefe(await eag().from('antrag_stand').select('*').is('geloescht_am', null).order('kunde')) as Antrag[];
    },
    async fristen() { return pruefe(await eag().from('frist_offen').select('*')) as Frist[]; },
    async ereignisse(antragId) {
      return pruefe(await eag().from('ereignis').select('id, zeit, von, quelle, art, schritt, feld, alt, neu')
        .eq('antrag_id', antragId).order('id', { ascending: false }).limit(100)) as Ereignis[];
    },
    async schrittSetzen(antragId, schritt, datum) { pruefe(await eag().rpc('schritt_setzen', { p_antrag: antragId, p_schritt: schritt, p_datum: datum })); },
    async schrittEntfernen(antragId, schritt) { pruefe(await eag().rpc('schritt_entfernen', { p_antrag: antragId, p_schritt: schritt })); },
  };
}

// ---------------------------------------------------------------
// Demo: Förderungen im Speicher, Status und Fristen mit denselben Regeln (js/ablauf.js)
// ---------------------------------------------------------------
const STATUS_AUS_SCHRITT: Record<string, Status> = {
  daten: 'daten_fehlen', projekt: 'projekt_anlegen', ticket: 'ticket_ziehen', eingereicht: 'antrag_einreichen',
  vertrag_erhalten: 'warten_vertrag', vertrag_versendet: 'vertrag_versenden', inbetriebnahme: 'in_betrieb_nehmen',
  herkunftsnachweis: 'econtrol_registrieren', rechnung: 'rechnung_hochladen', zahlung: 'zahlung_hochladen',
  abgeschlossen: 'endabrechnung_einreichen', ausgezahlt: 'warten_auszahlung',
};

export function zuAntrag(f: LegacyFoerderung, heute: string): Antrag {
  const st = A.status(f, heute);
  const status: Status = st.fertig ? 'ausgezahlt' : st.ende ? (st.ende.key as Status) : st.nachforderungOffen ? 'nachreichen'
    : st.nachforderungAbrechnungOffen ? 'nachreichen_abrechnung' : STATUS_AUS_SCHRITT[A.SCHRITTE[st.naechster].key];
  const phase = st.fertig ? 'fertig' : st.ende ? 'beendet' : st.nachforderungOffen ? 'call'
    : st.nachforderungAbrechnungOffen ? 'abrechnung' : SCHRITT_PHASE[st.naechster];
  const fr = A.fristen(f, heute)[0];
  const s = f.schritte || {};
  return {
    id: f.id, projekt_id: 'p-' + f.id, versuch: s.frueher_abgelehnt ? 2 : 1, vorgaenger_id: null, programm: 'EAG',
    art: /speicher/i.test(f.art || '') ? (/pv/i.test(f.art || '') ? 'pv_speicher' : 'speicher') : 'pv',
    call_start: f.foerdercall, call_ende: f.foerdercall ? A.callEnde(f.foerdercall) : null,
    ticket_nr: f.ticket || '', fpj: f.fpj || '', eag_nr: f.eag_nr || '', zieher: f.zieher || '', zieher_geplant: s.zieher_geplant || '',
    ticket_uhrzeit: s.ticket_uhrzeit || null, offene_punkte: f.offene_punkte || '', info: f.info || '', geloescht_am: null,
    geaendert_am: new Date().toISOString(), kunde: f.kunde, mail: f.mail || '', projekt_nr: f.projekt_nr || '',
    strasse: f.strasse || '', plz: f.plz || '', ort: f.ort || '', zaehlpunkt: f.zaehlpunkt,
    zaehlpunkt_ok: /^AT\d{11}[0-9A-Z]{20}$/.test(f.zaehlpunkt), kwp: f.kwp, speicher: f.speicher || '', mitarbeiter: f.mitarbeiter || '',
    status, phase: phase as Antrag['phase'], erledigt: st.erledigt, naechster: st.naechster, hoechster: st.hoechster, luecken: st.luecken,
    nachforderung_offen: st.nachforderungOffen, nachforderung_abrechnung_offen: st.nachforderungAbrechnungOffen,
    daten_fehlen: A.datenFehlen(f, heute), antrag_daten_fehlen: A.antragDatenFehlen(f),
    schritte: Object.entries(s).filter(([k]) => !/^(frueher_|ticket_uhrzeit|zieher_geplant|nochmal)/.test(k))
      .map(([schritt, datum]) => ({ schritt: schritt as Schritt, datum: A.istDatum(datum) ? datum : null })),
    frist_art: (fr?.art as FristArt) ?? null, frist_label: fr?.label ?? null, frist_datum: fr?.datum ?? null, frist_tage: fr?.tage ?? null,
    frist_stufe: (fr?.stufe as FristStufe) ?? null, frist_geschaetzt: fr?.geschaetzt ?? null,
    messtool_abnahme_am: s.inbetriebnahme && A.istDatum(s.inbetriebnahme) ? s.inbetriebnahme + 'T10:00:00Z' : null,
    messtool_kwp: s.inbetriebnahme && f.kwp ? Math.round(f.kwp * 0.98 * 100) / 100 : null,
  };
}

function demoQuelle(): Quelle {
  const heute = A.heuteText();
  const t = (n: number) => A.plusTage(heute, n);
  const namen = ['Huber Sepp', 'Maier Anna', 'Berger Toni', 'Gruber Eva', 'Wagner Franz', 'Pichler Maria', 'Steiner Karl', 'Moser Julia',
    'Hofer Georg', 'Leitner Sabine', 'Fuchs Michael', 'Eder Petra', 'Schwarz Hans', 'Bauer Lisa', 'Reiter Martin', 'Winkler Clara',
    'Lehner Robert', 'Brunner Sonja', 'Aigner Peter', 'Wimmer Andrea', 'Haas Thomas', 'Ebner Kathrin', 'Baumgartner Stefan',
    'Lang Elisabeth', 'Schmid Florian', 'Holzer Barbara', 'Wallner Markus', 'Mayr Verena', 'Koller Bernhard', 'Fischer Nina',
    'Kogler Daniel', 'Hauser Monika', 'Strasser Lukas', 'Riegler Anja', 'Kaiser Gerhard', 'Zauner Birgit'];
  const orte: [string, string][] = [['Gmunden', '4810'], ['Bad Ischl', '4820'], ['Ebensee', '4802'], ['Vöcklabruck', '4840'], ['Lenzing', '4860'], ['Scharnstein', '4644']];
  const zieher = ['Verena', 'Bianca', 'Thomas', 'Marion'];
  const s = (o: Record<string, string>) => o;
  // [Call, Schritte] – bewusst alle Zustände und Fristen, relativ zu heute
  const faelle: [string | null, Record<string, string>][] = [
    ['2026-10-08', {}], ['2026-10-08', s({ projekt: t(-20) })], ['2026-10-08', s({ projekt: t(-15) })], ['2026-10-08', s({ projekt: t(-12) })],
    ['2026-10-08', s({ projekt: t(-9), frueher_abgelehnt: '2026-06-16' })], ['2026-10-08', s({ projekt: t(-30) })],
    ['2026-06-16', s({ projekt: '✓', ticket: '2026-06-16', eingereicht: '2026-06-18' })],
    ['2026-06-16', s({ projekt: '✓', ticket: '2026-06-16', eingereicht: '2026-06-17', nachforderung: t(-21) })],
    ['2026-06-16', s({ projekt: '✓', ticket: '2026-06-16', eingereicht: '2026-06-19', nachforderung: t(-6) })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(4), -6) })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(-3), -6), vertrag_versendet: '✓' })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(19), -6), vertrag_versendet: '✓' })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(45), -6), vertrag_versendet: '✓' })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(70), -6), vertrag_versendet: '✓' })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(28), -6), vertrag_versendet: '✓' })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(105), -6), vertrag_versendet: '✓' })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(105), -6), vertrag_versendet: '✓' })],
    ['2026-04-23', s({ projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '✓', vertrag_versendet: '✓' })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(-60), -6), vertrag_versendet: '✓', inbetriebnahme: t(-70) })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(-110), -12), vertrag_versendet: '✓', inbetriebnahme: t(-120), herkunftsnachweis: t(-100) })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(-150), -6), vertrag_versendet: '✓', inbetriebnahme: t(-160), herkunftsnachweis: t(-150), rechnung: t(-140) })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(-160), -6), vertrag_versendet: '✓', inbetriebnahme: t(-150), herkunftsnachweis: t(-140), rechnung: t(-130), zahlung: t(-130) })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: '2026-05-12', vertrag_versendet: '✓', inbetriebnahme: '2026-07-20', herkunftsnachweis: '2026-07-28', rechnung: '2026-08-02', zahlung: '2026-08-02', abgeschlossen: '2026-08-05' })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: '2026-05-12', vertrag_versendet: '✓', inbetriebnahme: '2026-07-20', herkunftsnachweis: '2026-07-28', rechnung: '2026-08-02', zahlung: '2026-08-02', abgeschlossen: '2026-08-05', nachforderung_abrechnung: t(-12) })],
    ['2025-10-08', s({ projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '✓', vertrag_versendet: '✓', inbetriebnahme: '✓', herkunftsnachweis: '✓', rechnung: '✓', zahlung: '✓', abgeschlossen: '✓', ausgezahlt: '2026-02-11' })],
    ['2026-06-16', s({ projekt: '✓', ticket: '2026-06-16', eingereicht: '2026-06-18', abgelehnt: '2026-07-08' })],
    ['2026-06-16', s({ projekt: '✓', zurueckgezogen: '2026-06-12' })],
    ['2026-10-08', s({ projekt: t(-5) })], ['2026-10-08', s({ projekt: t(-4) })], ['2026-10-08', {}],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(12), -6), vertrag_versendet: '✓' })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(58), -6), vertrag_versendet: '✓' })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(-30), -6), vertrag_versendet: '✓', inbetriebnahme: t(-35) })],
    ['2026-04-23', s({ projekt: '✓', ticket: '2026-04-23', eingereicht: '2026-04-24', vertrag_erhalten: A.plusMonate(t(2), -6), vertrag_versendet: '✓' })],
  ];
  const daten: LegacyFoerderung[] = faelle.map(([call, schritte], i) => {
    const [ort, plz] = orte[i % orte.length];
    return {
      id: `demo-${String(i + 1).padStart(3, '0')}`, kunde: namen[i % namen.length], foerdercall: call,
      zaehlpunkt: i === 0 ? '' : 'AT00300000000000000000000301' + String(10000 + i * 37).slice(0, 5),
      kwp: [9.9, 12.4, 8.6, 14.3, 22.1, 101, 7.8, 18.9, 10.1, 6.4][i % 10], art: i % 3 ? 'PV + Speicher' : 'PV',
      strasse: i % 5 ? 'Musterweg ' + (i + 1) : '', plz, ort, mail: i % 4 ? `kunde${i}@example.at` : '', speicher: i % 3 ? '10 kWh' : '',
      mitarbeiter: ['Manfred', 'Patrick', 'Thomas', 'Hermann'][i % 4], zieher: call === '2026-10-08' ? zieher[i % 4] : zieher[(i + 1) % 4],
      ticket: schritte.ticket ? (0xa00000 + i * 4099).toString(16).slice(-6) : '', fpj: schritte.projekt ? 'FPJ00' + (140000 + i) : '',
      eag_nr: schritte.eingereicht ? 'EAG000' + (51000 + i * 13) : '', projekt_nr: 'P26' + String(100 + i).padStart(4, '0'),
      offene_punkte: i === 7 ? 'Vollmacht neu unterschreiben lassen' : i === 24 ? 'Nachreichen: Leasingvertrag; Nachweis der Nettokapazität Stromspeicher' : '',
      info: '', schritte,
    };
  });
  const log = new Map<string, Ereignis[]>();
  let nr = 1;
  const merke = (id: string, e: Omit<Ereignis, 'id' | 'zeit'>) => {
    const l = log.get(id) ?? [];
    l.unshift({ id: nr++, zeit: new Date().toISOString(), ...e });
    log.set(id, l);
  };
  daten.forEach(f => Object.entries(f.schritte).forEach(([k, v]) => {
    if (/^(frueher_|nochmal)/.test(k)) return;
    merke(f.id, { von: 'Import', quelle: 'legacy', art: 'schritt_gesetzt', schritt: k as Schritt, feld: '', alt: null, neu: { datum: A.istDatum(v) ? v : null } });
  }));
  const warte = () => new Promise(r => setTimeout(r, 250));
  return {
    demo: true,
    async angemeldet() { return 'demo@solpro.at'; },
    async anmelden() { /* Demo */ },
    async abmelden() { /* Demo */ },
    async ich() { return { email: 'demo@solpro.at', name: 'Demo', rolle: 'admin' }; },
    async antraege() { await warte(); return daten.map(f => zuAntrag(f, heute)); },
    async fristen() {
      await warte();
      return daten.flatMap(f => A.fristen(f, heute).map(fr => ({ antrag_id: f.id, kunde: f.kunde, ...fr, art: fr.art as FristArt, stufe: fr.stufe as FristStufe })));
    },
    async ereignisse(id) { await warte(); return log.get(id) ?? []; },
    async schrittSetzen(id, schritt, datum) {
      await warte();
      const f = daten.find(x => x.id === id);
      if (!f) throw new Error('Antrag nicht gefunden');
      // dieselben Prüfungen wie eag.schritt_setzen (Auswahl)
      if (datum && datum > heute && schritt !== 'verlaengert_bis') throw new Error('Datum liegt in der Zukunft');
      if (schritt === 'ticket' && f.foerdercall && datum && datum !== f.foerdercall) throw new Error(`Tickets gibt es nur am Calltag (${f.foerdercall.split('-').reverse().join('.')})`);
      if (schritt === 'ticket' && !f.zaehlpunkt) throw new Error('Für das Ticket fehlt: Zählpunkt');
      merke(id, { von: 'Demo', quelle: 'app', art: 'schritt_gesetzt', schritt, feld: '', alt: f.schritte[schritt] ? { datum: f.schritte[schritt] } : null, neu: { datum } });
      f.schritte = { ...f.schritte, [schritt]: datum ?? '✓' };
    },
    async schrittEntfernen(id, schritt) {
      await warte();
      const f = daten.find(x => x.id === id);
      if (!f) throw new Error('Antrag nicht gefunden');
      merke(id, { von: 'Demo', quelle: 'app', art: 'schritt_entfernt', schritt, feld: '', alt: { datum: f.schritte[schritt] }, neu: null });
      const rest = { ...f.schritte }; delete rest[schritt]; f.schritte = rest;
    },
  };
}

let quelle: Quelle | null = null;
export function holeQuelle(): Quelle {
  if (!quelle) quelle = typeof window !== 'undefined' && /[?&]demo\b/.test(window.location.search) ? demoQuelle() : supabaseQuelle();
  return quelle;
}
export const heuteText = () => A.heuteText();
