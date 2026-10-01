'use client';
// Das EAG-Timeline-Dashboard: Fristen-Zeitachse oben, darunter die Liste nach Zustand, Akte als Seitenschublade.
// Server-Zustand: TanStack Query (lib/hooks.ts). Oberflächen-Zustand: hier, bewusst flach.
import { AnimatePresence, motion } from 'framer-motion';
import { LogOut, Moon, RefreshCw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CONFIG } from '@/lib/config';
import { cn } from '@/lib/cn';
import { fehlerText, heuteText, holeQuelle } from '@/lib/daten';
import { SCHLUESSEL, useAntraege, useFristen, useSchrittEntfernen, useSchrittSetzen } from '@/lib/hooks';
import { sperre, STATUS, STATUS_REIHE, STUFE_RANG } from '@/lib/meta';
import type { Antrag, Ich } from '@/lib/types';
import { Akte } from './akte';
import { Aktionsleiste } from './aktionsleiste';
import { Anmelden } from './anmelden';
import { Befehle, type Ansicht } from './befehle';
import { Fehlergrenze } from './fehlergrenze';
import { Pipeline } from './pipeline';
import { Providers } from './providers';
import { Radar } from './radar';
import { useToast } from './toast';
import { Knopf, Skelett, Taste } from './ui';

const ANSICHTEN: (Ansicht & { passt: (a: Antrag) => boolean })[] = [
  { key: 'zutun', label: 'Zu tun', passt: a => !STATUS[a.status].ende && !STATUS[a.status].wartet },
  { key: 'wartet', label: 'Wartet', passt: a => !!STATUS[a.status].wartet },
  { key: 'beendet', label: 'Beendet', passt: a => ['abgelehnt', 'zurueckgezogen', 'erloschen'].includes(a.status) },
  { key: 'fertig', label: 'Ausgezahlt', passt: a => a.status === 'ausgezahlt' },
  { key: 'alle', label: 'Alle', passt: () => true },
];

export function App() {
  return <Providers><Dashboard /></Providers>;
}

function Dashboard() {
  const quelle = holeQuelle();
  const [ich, setIch] = useState<Ich | null | undefined>(undefined);
  const pruefen = useCallback(async () => {
    try { setIch((await quelle.angemeldet()) ? await quelle.ich() : null); } catch { setIch(null); }
  }, [quelle]);
  useEffect(() => { pruefen(); }, [pruefen]);

  if (ich === undefined) return <div className="grid min-h-dvh place-items-center text-mute">Wird geladen …</div>;
  if (ich === null) return <Anmelden onAngemeldet={pruefen} />;
  return <Arbeitsflaeche ich={ich} onAbmelden={async () => { await quelle.abmelden(); setIch(null); }} />;
}

function Arbeitsflaeche({ ich, onAbmelden }: { ich: Ich; onAbmelden: () => void }) {
  const quelle = holeQuelle();
  const qc = useQueryClient();
  const toast = useToast();
  const antraegeQ = useAntraege();
  const fristenQ = useFristen();
  const setzen = useSchrittSetzen();
  const entfernen = useSchrittEntfernen();
  const darfSchreiben = ich.rolle === 'admin' || ich.rolle === 'bearbeiten';
  const heute = heuteText();

  const [ansicht, setAnsicht] = useState('zutun');
  const [suche, setSuche] = useState('');
  const [radarWahl, setRadarWahl] = useState<{ ids: string[]; titel: string } | null>(null);
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());
  const [fokus, setFokus] = useState<string | null>(null);
  const [akteId, setAkteId] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const sucheRef = useRef<HTMLInputElement>(null);

  const alle = useMemo(() => antraegeQ.data ?? [], [antraegeQ.data]);
  // Sichtbar = Ansicht + Suche + Auswahl aus der Zeitachse; Reihenfolge wie die Gruppen (für J/K)
  const sichtbar = useMemo(() => {
    const v = ANSICHTEN.find(x => x.key === ansicht)!;
    const q = suche.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return alle
      .filter(a => (radarWahl ? radarWahl.ids.includes(a.id) : v.passt(a)))
      .filter(a => !q.length || q.every(t => [a.kunde, a.ort, a.plz, a.zaehlpunkt, a.eag_nr, a.fpj, a.ticket_nr, a.zieher, a.mitarbeiter].join(' ').toLowerCase().includes(t)))
      .sort((x, y) => STATUS_REIHE.indexOf(x.status) - STATUS_REIHE.indexOf(y.status)
        || STUFE_RANG[x.frist_stufe ?? 'unbekannt'] - STUFE_RANG[y.frist_stufe ?? 'unbekannt']
        || String(x.frist_datum ?? '9').localeCompare(String(y.frist_datum ?? '9')) || x.kunde.localeCompare(y.kunde, 'de'));
  }, [alle, ansicht, suche, radarWahl]);
  const zahl = useMemo(() => Object.fromEntries(ANSICHTEN.map(v => [v.key, alle.filter(v.passt).length])), [alle]);
  const kennzahlen = useMemo(() => ({
    ueberfaellig: alle.filter(a => a.frist_stufe === 'ueberfaellig'),
    dringend: alle.filter(a => a.frist_stufe === 'dringend'),
    bald: alle.filter(a => a.frist_stufe === 'bald'),
  }), [alle]);
  const akte = alle.find(a => a.id === akteId) ?? null;

  // Erledigen mit „Rückgängig“; Fehler der Datenbank-Prüfung im Klartext
  const erledige = useCallback((a: Antrag) => {
    const s = STATUS[a.status].setzt;
    if (!s || !darfSchreiben) return;
    const grund = sperre(a, heuteText());
    if (grund) { toast(`${a.kunde}: ${grund}`); return; }
    setzen.mutate({ antrag: a, schritt: s }, {
      onSuccess: () => toast(`${a.kunde}: ${STATUS[a.status].knopf}`, 'ok', () => entfernen.mutate({ antrag: a, schritt: s }, {
        onSuccess: () => toast('Rückgängig gemacht.'), onError: e => toast(fehlerText(e), 'fehler'),
      })),
      onError: e => toast(`${a.kunde}: ${fehlerText(e)}`, 'fehler'),
    });
  }, [setzen, entfernen, toast, darfSchreiben]);

  const alleErledigen = useCallback(async (liste: Antrag[]) => {
    let ok = 0; const fehler: string[] = [];
    for (const a of liste.filter(x => !sperre(x, heuteText()))) {
      try { await setzen.mutateAsync({ antrag: a, schritt: STATUS[a.status].setzt! }); ok++; }
      catch (e) { fehler.push(`${a.kunde}: ${fehlerText(e)}`); }
    }
    setAuswahl(new Set());
    toast(fehler.length ? `${ok} erledigt, ${fehler.length} nicht: ${fehler[0]}${fehler.length > 1 ? ' …' : ''}` : `${ok} erledigt.`, fehler.length ? 'fehler' : 'ok');
  }, [setzen, toast]);

  const csv = useCallback(() => {
    const zeilen = alle.filter(a => auswahl.has(a.id));
    const zelle = (v: unknown) => { const t = String(v ?? ''); return /[";\n]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : t; };
    const kopf = ['Kunde', 'PLZ', 'Ort', 'Zählpunkt', 'EAG-Nr.', 'FPJ', 'Call', 'Als Nächstes', 'Frist', 'Frist bis'];
    const text = '﻿' + [kopf, ...zeilen.map(a => [a.kunde, a.plz, a.ort, a.zaehlpunkt, a.eag_nr, a.fpj, a.call_start, STATUS[a.status].todo, a.frist_label, a.frist_datum])]
      .map(z => z.map(zelle).join(';')).join('\r\n');
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: `EAG-Auswahl_${heute}.csv` });
    link.click(); URL.revokeObjectURL(link.href);
  }, [alle, auswahl, heute]);

  const darstellung = useCallback(() => {
    const jetzt = (() => { try { return JSON.parse(localStorage.getItem('eag_theme') || '"auto"'); } catch { return 'auto'; } })();
    const neu = ({ auto: 'hell', hell: 'dunkel', dunkel: 'auto' } as Record<string, string>)[jetzt] ?? 'auto';
    try { localStorage.setItem('eag_theme', JSON.stringify(neu)); } catch { /* egal */ }
    if (neu === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = neu === 'hell' ? 'light' : 'dark';
    toast(`Darstellung: ${neu === 'auto' ? 'automatisch' : neu}`);
  }, [toast]);

  const neuLaden = useCallback(() => { qc.invalidateQueries(); }, [qc]);

  // Tastatur
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); return; }
      if (palette || (e.target as HTMLElement).closest('textarea, select, input:not([type=checkbox]):not([type=radio])')) {
        if (e.key === 'Escape' && (e.target as HTMLElement) === sucheRef.current) sucheRef.current?.blur();
        return;
      }
      if (mod || e.altKey) return;
      const ids = sichtbar.map(a => a.id);
      const i = fokus ? ids.indexOf(fokus) : -1;
      const geh = (n: number) => { const ziel = ids[Math.max(0, Math.min(ids.length - 1, i < 0 ? 0 : i + n))]; if (ziel) { setFokus(ziel); if (akteId) setAkteId(ziel); } };
      switch (e.key) {
        case 'j': case 'ArrowDown': e.preventDefault(); geh(1); break;
        case 'k': case 'ArrowUp': e.preventDefault(); geh(-1); break;
        case 'x': if (fokus) { e.preventDefault(); setAuswahl(s => { const n = new Set(s); if (n.has(fokus)) n.delete(fokus); else n.add(fokus); return n; }); } break;
        case 'e': { const a = alle.find(x => x.id === (akteId ?? fokus)); if (a) { e.preventDefault(); erledige(a); } break; }
        case 'Enter': if (fokus) { e.preventDefault(); setAkteId(fokus); } break;
        case '/': e.preventDefault(); sucheRef.current?.focus(); break;
        case 'Escape':
          if (akteId) setAkteId(null); else if (auswahl.size) setAuswahl(new Set()); else if (radarWahl) setRadarWahl(null); else if (suche) setSuche('');
          break;
      }
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [sichtbar, fokus, akteId, auswahl, radarWahl, suche, palette, alle, erledige]);

  const laedt = antraegeQ.isLoading || fristenQ.isLoading;
  const fehler = antraegeQ.error || fristenQ.error;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:gap-3 sm:px-5">
        <span className="grid size-[26px] place-items-center rounded-[7px] bg-brand text-[13px] font-bold text-brand-ink">S</span>
        <b className="text-[14px] font-semibold tracking-wide">SOLPRO</b><span className="hidden text-[14px] text-mute sm:inline">EAG-Dashboard</span>
        {quelle.demo && <span className="rounded bg-warn px-1.5 py-px text-[11px] font-semibold text-white">Demo</span>}
        <button onClick={() => setPalette(true)} className="ml-auto flex h-8 min-w-0 items-center gap-2 rounded-[7px] border border-line bg-fl px-2.5 text-[13px] text-mute shadow-1 hover:border-line-3 sm:w-64">
          <Search className="size-4" /><span className="hidden flex-1 text-left sm:inline">Suchen oder Befehl …</span><Taste className="hidden sm:inline-grid">⌘K</Taste>
        </button>
        <a href={CONFIG.appUrl} className="hidden h-8 items-center rounded-[7px] px-2.5 text-[13px] text-mute hover:bg-fl-3 hover:text-ink md:flex">Förderliste</a>
        <Knopf art="leise" onClick={darstellung} title="Darstellung"><Moon className="size-4" /></Knopf>
        <Knopf art="leise" onClick={onAbmelden} title={`Abmelden (${ich.email})`}><LogOut className="size-4" /></Knopf>
      </header>

      <main className={cn('mx-auto grid max-w-[1280px] grid-cols-[minmax(0,1fr)] gap-4 px-4 pb-28 pt-4 transition-[padding] sm:px-5 sm:pt-5', akte && 'xl:pr-[476px]')}>
        {/* Kennzahlen: Klick filtert */}
        <section className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Kennzahlen">
          {laedt ? Array.from({ length: 4 }, (_, i) => <Skelett key={i} className="h-[66px]" />) : ([
            ['Überfällig', kennzahlen.ueberfaellig, 'text-krit'], ['In 7 Tagen', kennzahlen.dringend, 'text-krit'],
            ['In 30 Tagen', kennzahlen.bald, 'text-warn'], ['Wartet auf Förderstelle', alle.filter(a => STATUS[a.status].wartet), 'text-ink'],
          ] as [string, Antrag[], string][]).map(([titel, liste, farbe]) => (
            <button key={titel} onClick={() => setRadarWahl(liste.length ? { ids: liste.map(a => a.id), titel } : null)}
              className="rounded-[10px] border border-line bg-fl px-4 py-3 text-left shadow-1 transition-colors hover:border-line-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-mute">{titel}</div>
              <div className={cn('text-[24px] font-semibold tracking-tight tabular', liste.length ? farbe : 'text-dim')}>{liste.length}</div>
            </button>
          ))}
        </section>

        {fehler && (
          <div role="alert" className="flex items-center gap-3 rounded-[10px] border border-krit-line bg-krit-soft px-4 py-3 text-[13px] text-krit">
            {fehlerText(fehler)}<Knopf klein className="ml-auto" onClick={neuLaden}><RefreshCw className="size-3.5" />Nochmal</Knopf>
          </div>
        )}

        <Fehlergrenze bereich="Zeitachse" onNeu={neuLaden}>
          {fristenQ.isLoading ? <Skelett className="h-[230px]" /> : fristenQ.data && (
            <Radar fristen={fristenQ.data} heute={heute} aktiv={radarWahl?.ids ?? null}
              onWaehle={(ids, titel) => { setRadarWahl(ids ? { ids, titel: titel ?? 'Auswahl' } : null); }} />
          )}
        </Fehlergrenze>

        {/* Werkzeugleiste */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex max-w-full overflow-x-auto rounded-[9px] border border-line bg-fl-3 p-0.5 [scrollbar-width:none]" role="tablist" aria-label="Ansicht">
            {ANSICHTEN.map(v => (
              <button key={v.key} role="tab" aria-selected={ansicht === v.key && !radarWahl} onClick={() => { setAnsicht(v.key); setRadarWahl(null); }}
                className={cn('flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 text-[13px] font-medium sm:px-3', ansicht === v.key && !radarWahl ? 'bg-fl text-ink shadow-1' : 'text-mute hover:text-ink')}>
                {v.label}<span className="text-[11.5px] text-dim tabular">{zahl[v.key]}</span>
              </button>
            ))}
          </div>
          <AnimatePresence>
            {radarWahl && (
              <motion.button initial={{ opacity: 0, scale: .95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .95 }}
                onClick={() => setRadarWahl(null)} className="flex h-8 items-center gap-1.5 rounded-[7px] border border-ink-2 bg-fl px-2.5 text-[13px] font-medium">
                {radarWahl.titel} · {radarWahl.ids.length}<X className="size-3.5" />
              </motion.button>
            )}
          </AnimatePresence>
          <label className="ml-auto flex h-8 w-full items-center gap-2 rounded-[7px] border border-line bg-fl px-2.5 text-dim shadow-1 focus-within:border-line-3 sm:w-72">
            <Search className="size-4" />
            <input ref={sucheRef} value={suche} onChange={e => setSuche(e.target.value)} placeholder="Filtern: Name, Ort, Zählpunkt, EAG-Nr. …"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-dim focus-visible:shadow-none" />
            <Taste>/</Taste>
          </label>
        </div>

        <Fehlergrenze bereich="Liste" onNeu={neuLaden}>
          {antraegeQ.isLoading
            ? <div className="grid gap-2">{Array.from({ length: 8 }, (_, i) => <Skelett key={i} className="h-[52px]" />)}</div>
            : <Pipeline antraege={sichtbar} auswahl={auswahl} fokus={fokus} darfSchreiben={darfSchreiben} kompakt={!!akte}
                onFokus={setFokus} onOeffne={setAkteId} onErledigt={erledige}
                onAuswahl={(id, an) => setAuswahl(s => { const n = new Set(s); if (an ?? !n.has(id)) n.add(id); else n.delete(id); return n; })} />}
        </Fehlergrenze>
      </main>

      <Fehlergrenze bereich="Akte">
        <Akte a={akte} fristen={(fristenQ.data ?? []).filter(f => f.antrag_id === akteId)} darfSchreiben={darfSchreiben} onZu={() => setAkteId(null)} onErledigt={erledige} />
      </Fehlergrenze>
      <Aktionsleiste gewaehlt={alle.filter(a => auswahl.has(a.id))} darfSchreiben={darfSchreiben} onErledigt={alleErledigen} onCsv={csv} onLeeren={() => setAuswahl(new Set())} />
      <Befehle offen={palette} onZu={() => setPalette(false)} antraege={alle} ansichten={ANSICHTEN} darfSchreiben={darfSchreiben}
        onOeffne={id => { setFokus(id); setAkteId(id); }} onErledigt={erledige} onAnsicht={k => { setAnsicht(k); setRadarWahl(null); }} onNeuLaden={neuLaden} onDarstellung={darstellung} />
    </div>
  );
}
