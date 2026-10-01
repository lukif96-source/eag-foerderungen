'use client';
// Die Liste: nach Zustand gruppiert (in Ablauf-Reihenfolge), dicht, mit Tastatur.
// J/K bewegen, X auswählen, E nächsten Schritt erledigen, Enter öffnet die Akte.
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Loader2 } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { heuteText } from '@/lib/daten';
import { datumDE, sperre, STATUS, STATUS_REIHE, zpOhneAT } from '@/lib/meta';
import type { Antrag, Status } from '@/lib/types';
import { FristMarke } from './frist';
import { Tracker } from './tracker';
import { Knopf, Taste } from './ui';

interface Props {
  antraege: Antrag[];
  auswahl: Set<string>;
  fokus: string | null;
  darfSchreiben: boolean;
  kompakt?: boolean;            // Akte offen: schmale Liste ohne Kennungen und Knopf
  onFokus: (id: string) => void;
  onAuswahl: (id: string, an?: boolean) => void;
  onOeffne: (id: string) => void;
  onErledigt: (a: Antrag) => void;
}

// Mittlere Spalte: vor dem Ticket der Zählpunkt ohne „AT“ (zum Kopieren ins Portal), danach die Kennungen
function Kennung({ a }: { a: Antrag }) {
  const [ok, setOk] = useState(false);
  const vorTicket = ['daten_fehlen', 'projekt_anlegen', 'ticket_ziehen'].includes(a.status);
  const zp = zpOhneAT(a.zaehlpunkt);
  const kennungen = [a.eag_nr, a.fpj && `FPJ ${a.fpj}`, a.ticket_nr && `Ticket ${a.ticket_nr}`].filter(Boolean).join(' · ');
  const unten = STATUS[a.status].wartet ? 'wartet auf die Förderstelle' : a.offene_punkte.split('\n')[0];
  return (
    <div className="min-w-0 text-[12.5px]">
      {vorTicket ? (zp ? (
        <button title="Zählpunkt ohne AT kopieren" onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(zp); setOk(true); setTimeout(() => setOk(false), 900); }}
          className={cn('group/zp flex max-w-full items-center gap-1.5 rounded px-1 -mx-1 font-mono text-[11.5px] hover:bg-fl-3', a.zaehlpunkt_ok ? 'text-ink-2' : 'text-krit')}>
          {/* Die ersten 20 Stellen sind bei allen gleich (AT003000 00000 …) – unterscheiden tut das Ende */}
          <span className="truncate">{zp.length > 14 ? '…' + zp.slice(-11) : zp}</span>
          {ok ? <Check className="size-3 shrink-0 text-ok" /> : <Copy className="size-3 shrink-0 opacity-0 group-hover/zp:opacity-60" />}
        </button>
      ) : <span className="text-krit">Zählpunkt fehlt</span>)
        : <div className="truncate text-ink-2 tabular">{kennungen || <span className="text-dim">–</span>}</div>}
      {unten && <div className="truncate text-[11.5px] text-mute">{unten}</div>}
    </div>
  );
}

const Zeile = memo(function Zeile({ a, gewaehlt, fokus, darfSchreiben, kompakt, heute, onFokus, onAuswahl, onOeffne, onErledigt }:
  { a: Antrag; gewaehlt: boolean; fokus: boolean; heute: string } & Omit<Props, 'antraege' | 'auswahl' | 'fokus'>) {
  const meta = STATUS[a.status];
  const grund = sperre(a, heute);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (fokus) ref.current?.scrollIntoView({ block: 'nearest' }); }, [fokus]);
  return (
    <motion.div layout="position" ref={ref} role="row" aria-selected={gewaehlt} tabIndex={-1}
      onClick={() => { onFokus(a.id); onOeffne(a.id); }}
      className={cn('group grid cursor-pointer grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line-2 px-3 py-2 first:border-t-0',
        kompakt ? 'md:grid-cols-[24px_minmax(0,1fr)_120px_auto]' : 'md:grid-cols-[24px_minmax(0,1.25fr)_132px_minmax(0,1fr)_178px_124px]',
        fokus ? 'bg-fl-2 shadow-[inset_2px_0_0_var(--ink)]' : 'hover:bg-fl-2', gewaehlt && 'bg-fl-3')}>
      <span onClick={e => e.stopPropagation()} className="grid place-items-center">
        <input type="checkbox" aria-label={`${a.kunde} auswählen`} checked={gewaehlt} onChange={e => onAuswahl(a.id, e.target.checked)}
          className="size-3.5 cursor-pointer accent-[var(--ink)]" />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-medium">
          <span className="truncate">{a.kunde || '(ohne Namen)'}</span>
          {a.versuch > 1 && <span className="shrink-0 rounded border border-warn-line bg-warn-soft px-1 text-[10.5px] font-medium text-warn">Versuch {a.versuch}</span>}
          {a.daten_fehlen.length > 0 && <span className="shrink-0 text-[11px] font-medium text-krit">fehlt: {a.daten_fehlen.join(', ')}</span>}
        </div>
        <div className="truncate text-[12px] text-mute tabular">
          {[[a.plz, a.ort].filter(Boolean).join(' '), a.kwp ? `${String(a.kwp).replace('.', ',')} kWp` : '', a.call_start ? `Call ${datumDE(a.call_start, true)}${a.call_start.slice(2, 4)}` : '', a.zieher].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="hidden md:block"><Tracker a={a} /></div>
      {!kompakt && <div className="hidden md:block"><Kennung a={a} /></div>}
      <div className="justify-self-end">
        {meta.ende
          ? <span className={cn('text-[12px] font-medium', a.status === 'ausgezahlt' ? 'text-ok' : 'text-krit')}>{meta.todo}</span>
          : <FristMarke stufe={a.frist_stufe} datum={a.frist_datum} tage={a.frist_tage} geschaetzt={a.frist_geschaetzt} />}
      </div>
      {!kompakt && <div className="hidden justify-self-end md:block" onClick={e => e.stopPropagation()}>
        {a._speichert ? <Loader2 className="size-4 animate-spin text-mute" aria-label="wird gespeichert" />
          : darfSchreiben && meta.knopf && !grund ? (
            <Knopf klein onClick={() => onErledigt(a)} title={`${meta.todo} – heute erledigt (E)`}
              className={cn('transition-opacity', fokus ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100')}>
              <Check className="size-3.5 text-ok" strokeWidth={2.6} />{meta.knopf}
            </Knopf>
          ) : null}
      </div>}
    </motion.div>
  );
});

export function Pipeline(p: Props) {
  const heute = heuteText();
  const gruppen = useMemo(() => {
    const m = new Map<Status, Antrag[]>();
    for (const a of p.antraege) m.set(a.status, [...(m.get(a.status) ?? []), a]);
    return STATUS_REIHE.filter(s => m.has(s)).map(s => ({ status: s, liste: m.get(s)! }));
  }, [p.antraege]);

  if (!p.antraege.length) {
    return <div className="rounded-[10px] border border-dashed border-line-3 bg-fl p-10 text-center text-mute">Nichts gefunden – Filter oder Suche ändern.</div>;
  }
  return (
    <div className="grid gap-5" role="grid" aria-label="Förderungen">
      <AnimatePresence initial={false}>
        {gruppen.map(g => {
          const alleGleicheFrist = g.liste.length > 1 && g.liste.every(a => a.frist_datum && a.frist_datum === g.liste[0].frist_datum);
          return (
            <motion.section key={g.status} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <header className="sticky top-[57px] z-[5] mb-2 flex items-center gap-2 bg-bg/90 px-1 py-1 backdrop-blur">
                <h3 className="min-w-0 text-[13px] font-semibold">{STATUS[g.status].todo}</h3>
                <span className="rounded bg-fl-3 px-1.5 text-[11.5px] font-medium text-mute tabular">{g.liste.length}</span>
                {STATUS[g.status].wartet && <span className="text-[12px] text-mute">wartet auf die Förderstelle</span>}
                {alleGleicheFrist && <span className="ml-1 hidden sm:inline"><FristMarke stufe={g.liste[0].frist_stufe} datum={g.liste[0].frist_datum} tage={g.liste[0].frist_tage} label={g.liste[0].frist_label} lang /></span>}
                <button className="ml-auto shrink-0 whitespace-nowrap text-[12px] text-mute hover:text-ink" onClick={() => g.liste.forEach(a => p.onAuswahl(a.id, true))}>alle auswählen</button>
              </header>
              <div className="overflow-hidden rounded-[10px] border border-line bg-fl shadow-1">
                {g.liste.map(a => (
                  <Zeile key={a.id} a={a} gewaehlt={p.auswahl.has(a.id)} fokus={p.fokus === a.id} darfSchreiben={p.darfSchreiben} kompakt={p.kompakt} heute={heute}
                    onFokus={p.onFokus} onAuswahl={p.onAuswahl} onOeffne={p.onOeffne} onErledigt={p.onErledigt} />
                ))}
              </div>
            </motion.section>
          );
        })}
      </AnimatePresence>
      <p className="hidden text-center text-[12px] text-mute md:block">
        <Taste>J</Taste> <Taste>K</Taste> bewegen · <Taste>X</Taste> auswählen · <Taste>E</Taste> erledigen · <Taste>↵</Taste> öffnen · <Taste>⌘K</Taste> suchen
      </p>
    </div>
  );
}
