// Typen der Lesesichten eag.antrag_stand und eag.frist_offen (sql/v2/eag.sql)

export type Status =
  | 'daten_fehlen' | 'projekt_anlegen' | 'ticket_ziehen' | 'antrag_einreichen' | 'nachreichen'
  | 'warten_vertrag' | 'vertrag_versenden' | 'in_betrieb_nehmen' | 'econtrol_registrieren'
  | 'rechnung_hochladen' | 'zahlung_hochladen' | 'endabrechnung_einreichen' | 'warten_auszahlung'
  | 'nachreichen_abrechnung' | 'ausgezahlt' | 'abgelehnt' | 'zurueckgezogen' | 'erloschen';
export type Phase = 'vorbereitung' | 'call' | 'zusage' | 'umsetzung' | 'abrechnung' | 'fertig' | 'beendet';
export type FristStufe = 'ueberfaellig' | 'dringend' | 'bald' | 'ruhig' | 'unbekannt';
export type FristArt = 'ticket' | 'antrag' | 'nachforderung' | 'inbetriebnahme' | 'endabrechnung' | 'nachforderung_abrechnung';
export type Schritt =
  | 'projekt' | 'ticket' | 'eingereicht' | 'nachforderung' | 'nachgereicht' | 'vertrag_erhalten' | 'vertrag_versendet'
  | 'verlaengert_bis' | 'inbetriebnahme' | 'herkunftsnachweis' | 'rechnung' | 'zahlung' | 'abgeschlossen' | 'ausgezahlt'
  | 'abgelehnt' | 'zurueckgezogen' | 'erloschen' | 'nachforderung_abrechnung' | 'nachgereicht_abrechnung';

export interface Antrag {
  id: string;
  projekt_id: string;
  versuch: number;
  vorgaenger_id: string | null;
  programm: string;
  art: 'pv' | 'pv_speicher' | 'speicher' | null;
  call_start: string | null;
  call_ende: string | null;
  ticket_nr: string;
  fpj: string;
  eag_nr: string;
  zieher: string;
  zieher_geplant: string;
  ticket_uhrzeit: string | null;
  offene_punkte: string;
  info: string;
  geloescht_am: string | null;
  geaendert_am: string;
  kunde: string;
  mail: string;
  projekt_nr: string;
  strasse: string;
  plz: string;
  ort: string;
  zaehlpunkt: string;
  zaehlpunkt_ok: boolean;
  kwp: number | null;
  speicher: string;
  mitarbeiter: string;
  status: Status;
  phase: Phase;
  erledigt: boolean[];          // 12 Hauptschritte
  naechster: number;            // Index oder -1
  hoechster: number;
  luecken: number[];
  nachforderung_offen: boolean;
  nachforderung_abrechnung_offen: boolean;
  daten_fehlen: string[];
  antrag_daten_fehlen: string[];
  schritte: { schritt: Schritt; datum: string | null }[] | null;
  frist_art: FristArt | null;
  frist_label: string | null;
  frist_datum: string | null;
  frist_tage: number | null;
  frist_stufe: FristStufe | null;
  frist_geschaetzt: boolean | null;
  messtool_abnahme_am: string | null;
  messtool_kwp: number | null;
  _speichert?: boolean;        // nur im Browser: wird gerade gespeichert
}

export interface Frist {
  antrag_id: string;
  kunde: string;
  art: FristArt;
  label: string;
  datum: string | null;
  tage: number | null;
  stufe: FristStufe;
  hinweis: string;
  geschaetzt: boolean;
}

export interface Ereignis {
  id: number;
  zeit: string;
  von: string;
  quelle: string;
  art: string;
  schritt: Schritt | null;
  feld: string;
  alt: unknown;
  neu: unknown;
}

export interface Ich { email: string; name: string; rolle: 'admin' | 'bearbeiten' | 'lesen' | 'vertrieb' }
