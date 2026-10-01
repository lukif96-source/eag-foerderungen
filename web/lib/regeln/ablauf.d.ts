// Typen für js/ablauf.js (Kopie in lib/regeln/ablauf.js – ein Test prüft, dass sie aktuell ist)
type Schritte = Record<string, string>;
export interface LegacyFoerderung {
  id: string; kunde: string; zaehlpunkt: string; kwp: number | null; foerdercall: string | null; art?: string;
  strasse?: string; plz?: string; ort?: string; mail?: string; speicher?: string; mitarbeiter?: string; zieher?: string;
  ticket?: string; fpj?: string; eag_nr?: string; projekt_nr?: string; offene_punkte?: string; info?: string; jahr?: number;
  schritte: Schritte; geloescht_am?: string | null;
}
export interface Status {
  erledigt: boolean[]; hoechster: number; naechster: number; luecken: number[];
  ende: { key: string; label: string } | null; nachforderungOffen: boolean; nachforderungAbrechnungOffen: boolean; fertig: boolean;
}
export interface Frist { art: string; label: string; datum: string | null; tage: number | null; stufe: string; hinweis: string; geschaetzt: boolean }
declare const A: {
  SCHRITTE: { key: string; label: string; kurz: string; todo: string; knopf: string; phase: string; auto?: boolean; warten?: string; neu?: boolean }[];
  status(f: LegacyFoerderung, heute?: string): Status;
  aufgabe(f: LegacyFoerderung, st?: Status): { key: string; todo: string; knopf: string; phase: string; warten?: string; neben?: boolean } | null;
  fristen(f: LegacyFoerderung, heute?: string): Frist[];
  datenFehlen(f: LegacyFoerderung, heute?: string): string[];
  antragDatenFehlen(f: LegacyFoerderung): string[];
  plusTage(d: string, n: number): string;
  plusMonate(d: string, n: number): string;
  callEnde(d: string): string;
  heuteText(d?: Date): string;
  istDatum(v: unknown): boolean;
};
export default A;
