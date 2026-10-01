// Beschriftungen und Zuordnungen der Zustandsmaschine – eine Stelle für die ganze Oberfläche
import type { Antrag, FristArt, FristStufe, Phase, Schritt, Status } from './types';

export const SCHRITTE_KURZ = ['Daten', 'Projekt', 'Ticket', 'Eingereicht', 'Vertrag da', 'Vertrag versendet', 'In Betrieb',
  'E-Control', 'Rechnung', 'Zahlung', 'Endabrechnung', 'Ausgezahlt'] as const;
// Phase je Hauptschritt (Index wie SCHRITTE_KURZ)
export const SCHRITT_PHASE: Phase[] = ['vorbereitung', 'vorbereitung', 'call', 'call', 'zusage', 'zusage', 'umsetzung', 'umsetzung',
  'abrechnung', 'abrechnung', 'abrechnung', 'abrechnung'];
export const PHASEN: { key: Phase; label: string; kurz: string }[] = [
  { key: 'vorbereitung', label: 'Vorbereitung', kurz: 'Vorber.' }, { key: 'call', label: 'Call', kurz: 'Call' },
  { key: 'zusage', label: 'Zusage', kurz: 'Zusage' }, { key: 'umsetzung', label: 'Umsetzung', kurz: 'Umsetz.' },
  { key: 'abrechnung', label: 'Abrechnung', kurz: 'Abrechnung' },
];

interface StatusMeta { todo: string; knopf?: string; setzt?: Schritt; wartet?: boolean; ende?: boolean }
// Reihenfolge = Reihenfolge der Gruppen im Dashboard
export const STATUS: Record<Status, StatusMeta> = {
  daten_fehlen: { todo: 'Name und Zählpunkt eintragen' },
  projekt_anlegen: { todo: 'Projekt im EAG-Portal anlegen', knopf: 'Projekt angelegt', setzt: 'projekt' },
  ticket_ziehen: { todo: 'Ticket ziehen', knopf: 'Ticket gezogen', setzt: 'ticket' },
  antrag_einreichen: { todo: 'Antrag im Portal einreichen', knopf: 'Eingereicht', setzt: 'eingereicht' },
  nachreichen: { todo: 'Unterlagen nachreichen', knopf: 'Nachgereicht', setzt: 'nachgereicht' },
  warten_vertrag: { todo: 'Fördervertrag abwarten', knopf: 'Vertrag erhalten', setzt: 'vertrag_erhalten', wartet: true },
  vertrag_versenden: { todo: 'Vertrag an Kunden versenden', knopf: 'Versendet', setzt: 'vertrag_versendet' },
  in_betrieb_nehmen: { todo: 'Anlage in Betrieb nehmen', knopf: 'In Betrieb', setzt: 'inbetriebnahme' },
  econtrol_registrieren: { todo: 'Bei der E-Control registrieren', knopf: 'Registriert', setzt: 'herkunftsnachweis' },
  rechnung_hochladen: { todo: 'Rechnung hochladen', knopf: 'Hochgeladen', setzt: 'rechnung' },
  zahlung_hochladen: { todo: 'Zahlungsnachweis hochladen', knopf: 'Hochgeladen', setzt: 'zahlung' },
  endabrechnung_einreichen: { todo: 'Endabrechnung einreichen', knopf: 'Eingereicht', setzt: 'abgeschlossen' },
  nachreichen_abrechnung: { todo: 'Unterlagen zur Endabrechnung nachreichen', knopf: 'Nachgereicht', setzt: 'nachgereicht_abrechnung' },
  warten_auszahlung: { todo: 'Auszahlung abwarten', knopf: 'Ausgezahlt', setzt: 'ausgezahlt', wartet: true },
  ausgezahlt: { todo: 'Ausgezahlt', ende: true },
  abgelehnt: { todo: 'Abgelehnt / nicht gereiht', ende: true },
  zurueckgezogen: { todo: 'Zurückgezogen', ende: true },
  erloschen: { todo: 'Zusage erloschen', ende: true },
};
export const STATUS_REIHE = Object.keys(STATUS) as Status[];

export const FRIST_ART: Record<FristArt, string> = {
  ticket: 'Ticket', antrag: 'Antrag', nachforderung: 'Nachreichen', nachforderung_abrechnung: 'Nachreichen (Abr.)',
  inbetriebnahme: 'Inbetriebnahme', endabrechnung: 'Endabrechnung',
};
// Zeilen der Zeitachse
export const RADAR_SPUREN: { key: string; label: string; kurz: string; arten: FristArt[] }[] = [
  { key: 'call', label: 'Ticket · Antrag', kurz: 'Call', arten: ['ticket', 'antrag'] },
  { key: 'nach', label: 'Nachreichen', kurz: 'Nachreichen', arten: ['nachforderung', 'nachforderung_abrechnung'] },
  { key: 'ibn', label: 'Inbetriebnahme', kurz: 'In Betrieb', arten: ['inbetriebnahme'] },
  { key: 'abr', label: 'Endabrechnung', kurz: 'Abrechnung', arten: ['endabrechnung'] },
];
export const STUFE_RANG: Record<FristStufe, number> = { ueberfaellig: 0, dringend: 1, bald: 2, ruhig: 3, unbekannt: 4 };

export const datumDE = (d: string | null | undefined, kurz = false) => {
  if (!d) return '–';
  const [y, m, t] = d.slice(0, 10).split('-');
  return kurz ? `${t}.${m}.` : `${t}.${m}.${y}`;
};
export const restText = (tage: number | null) =>
  tage === null ? 'ohne Datum' : tage < 0 ? `${-tage} T überfällig` : tage === 0 ? 'heute' : tage === 1 ? 'morgen' : `in ${tage} T`;
export const zpOhneAT = (zp: string) => zp.replace(/\s/g, '').toUpperCase().replace(/^AT(?=\d{11}[0-9A-Z]{20}$)/, '');

// Warum der nächste Schritt heute (noch) nicht erledigt werden kann – dieselben Regeln, die die Datenbank prüft
// (eag.schritt_setzen). So bietet die Oberfläche gar nicht erst an, was abgelehnt würde.
export function sperre(a: Pick<Antrag, 'status' | 'call_start' | 'call_ende' | 'daten_fehlen' | '_speichert'>, heute: string): string | null {
  const s = STATUS[a.status].setzt;
  if (!s) return 'Hier ist nichts zu erledigen';
  if (a._speichert) return 'Wird gerade gespeichert';
  if (s === 'ticket' && a.daten_fehlen.length) return `Für das Ticket fehlt: ${a.daten_fehlen.join(', ')}`;
  if ((s === 'ticket' || s === 'eingereicht') && a.call_start && heute < a.call_start) return `Erst ab dem Calltag (${datumDE(a.call_start)})`;
  if (s === 'eingereicht' && a.call_ende && heute > a.call_ende) return `Der Call ist vorbei (bis ${datumDE(a.call_ende)}) – Datum in der App nachtragen`;
  return null;
}
