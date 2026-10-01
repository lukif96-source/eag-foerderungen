'use client';
// Server-Zustand mit TanStack Query: laden, im Hintergrund aktuell halten, Schritte optimistisch setzen.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fehlerText, heuteText, holeQuelle } from './daten';
import type { Antrag, Schritt } from './types';

export const SCHLUESSEL = { antraege: ['antraege'], fristen: ['fristen'], ereignisse: (id: string) => ['ereignisse', id] };

export function useAntraege() {
  return useQuery({ queryKey: SCHLUESSEL.antraege, queryFn: () => holeQuelle().antraege(), refetchInterval: 60_000 });
}
export function useFristen() {
  return useQuery({ queryKey: SCHLUESSEL.fristen, queryFn: () => holeQuelle().fristen(), refetchInterval: 60_000 });
}
export function useEreignisse(id: string | null) {
  return useQuery({ queryKey: SCHLUESSEL.ereignisse(id ?? ''), queryFn: () => holeQuelle().ereignisse(id!), enabled: !!id });
}

// Index des Hauptschritts, den ein gesetzter Schritt erledigt (für die sofortige Anzeige)
const NR: Partial<Record<Schritt, number>> = { projekt: 1, ticket: 2, eingereicht: 3, vertrag_erhalten: 4, vertrag_versendet: 5,
  inbetriebnahme: 6, herkunftsnachweis: 7, rechnung: 8, zahlung: 9, abgeschlossen: 10, ausgezahlt: 11 };

export interface SetzenArgs { antrag: Antrag; schritt: Schritt; datum?: string | null }

// Schritt setzen: sofort sichtbar (optimistisch), bei Fehler zurück, danach echter Stand aus der Datenbank
export function useSchrittSetzen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ antrag, schritt, datum }: SetzenArgs) => {
      // Ticket immer mit dem Calltag – Tickets gibt es nur da
      const tag = datum !== undefined ? datum : schritt === 'ticket' && antrag.call_start && antrag.call_start <= heuteText() ? antrag.call_start : heuteText();
      return holeQuelle().schrittSetzen(antrag.id, schritt, tag);
    },
    onMutate: async ({ antrag, schritt }) => {
      await qc.cancelQueries({ queryKey: SCHLUESSEL.antraege });
      const vorher = qc.getQueryData<Antrag[]>(SCHLUESSEL.antraege);
      const nr = NR[schritt];
      qc.setQueryData<Antrag[]>(SCHLUESSEL.antraege, alt => alt?.map(a => {
        if (a.id !== antrag.id) return a;
        const erledigt = a.erledigt.slice();
        if (nr !== undefined) erledigt[nr] = true;
        const naechster = erledigt.findIndex((e, i) => !e && i > (nr ?? a.naechster));
        return { ...a, erledigt, naechster, frist_stufe: null, frist_datum: null, frist_label: null, frist_tage: null, _speichert: true };
      }));
      return { vorher };
    },
    onError: (_e, _v, ctx) => { if (ctx?.vorher) qc.setQueryData(SCHLUESSEL.antraege, ctx.vorher); },
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: SCHLUESSEL.antraege });
      qc.invalidateQueries({ queryKey: SCHLUESSEL.fristen });
      qc.invalidateQueries({ queryKey: SCHLUESSEL.ereignisse(v.antrag.id) });
    },
  });
}

export function useSchrittEntfernen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ antrag, schritt }: { antrag: Antrag; schritt: Schritt }) => holeQuelle().schrittEntfernen(antrag.id, schritt),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: SCHLUESSEL.antraege });
      qc.invalidateQueries({ queryKey: SCHLUESSEL.fristen });
      qc.invalidateQueries({ queryKey: SCHLUESSEL.ereignisse(v.antrag.id) });
    },
  });
}

export { fehlerText };
