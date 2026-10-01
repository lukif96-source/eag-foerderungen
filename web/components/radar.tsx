'use client';
// Fristen-Zeitachse: wann wird es eng – über alle Förderungen, nach Art der Frist in Spuren.
// Links von „Heute“ liegt Überfälliges (rot), rechts das, was kommt. Ein Punkt = alle Fristen eines Tages
// in dieser Spur; Klick filtert die Liste auf genau diese Förderungen.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useMemo, useState } from 'react';
import A from '@/lib/regeln/ablauf.js';
import { cn } from '@/lib/cn';
import { datumDE, FRIST_ART, RADAR_SPUREN, restText, STUFE_RANG } from '@/lib/meta';
import type { Frist, FristStufe } from '@/lib/types';

const VERGANGEN = 30;
const HORIZONTE = [30, 90, 180] as const;
const tageZwischen = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
const MONATE = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

interface Punkt { schluessel: string; datum: string; tage: number; fristen: Frist[]; stufe: FristStufe; geschaetzt: boolean }

export function Radar({ fristen, heute, aktiv, onWaehle }: { fristen: Frist[]; heute: string; aktiv: string[] | null; onWaehle: (ids: string[] | null, titel?: string) => void }) {
  const [horizont, setHorizont] = useState<(typeof HORIZONTE)[number]>(90);
  const [zeige, setZeige] = useState<Punkt | null>(null);
  const ruhig = useReducedMotion();
  const spanne = VERGANGEN + horizont;
  const x = (tage: number) => ((Math.max(-VERGANGEN, Math.min(horizont, tage)) + VERGANGEN) / spanne) * 100;

  const spuren = useMemo(() => RADAR_SPUREN.map(sp => {
    const eigene = fristen.filter(f => sp.arten.includes(f.art));
    const mitDatum = eigene.filter(f => f.datum);
    const gruppen = new Map<string, Frist[]>();
    for (const f of mitDatum) {
      const tage = tageZwischen(heute, f.datum!);
      if (tage > horizont) continue;
      // ältere Überfällige sammeln sich am linken Rand
      const k = tage < -VERGANGEN ? 'aelter' : f.datum!;
      gruppen.set(k, [...(gruppen.get(k) ?? []), f]);
    }
    const punkte: Punkt[] = [...gruppen.entries()].map(([k, fs]) => {
      const tage = k === 'aelter' ? -VERGANGEN - 1 : tageZwischen(heute, k);
      const stufe = fs.map(f => f.stufe).sort((a, b) => STUFE_RANG[a] - STUFE_RANG[b])[0];
      return { schluessel: sp.key + k, datum: k === 'aelter' ? fs.map(f => f.datum!).sort()[0] : k, tage, fristen: fs, stufe, geschaetzt: fs.every(f => f.geschaetzt) };
    }).sort((a, b) => a.tage - b.tage);
    const spaeter = mitDatum.filter(f => tageZwischen(heute, f.datum!) > horizont);
    const ohne = eigene.filter(f => !f.datum);
    return { ...sp, punkte, spaeter, ohne };
  }), [fristen, heute, horizont]);

  // Achse: Monatsanfänge und Wochen
  const marken = useMemo(() => {
    const aus: { tage: number; text: string; monat: boolean }[] = [];
    for (let t = -VERGANGEN; t <= horizont; t++) {
      const d = A.plusTage(heute, t);
      if (d.endsWith('-01')) aus.push({ tage: t, text: MONATE[+d.slice(5, 7) - 1] + (d.slice(5, 7) === '01' ? ' ' + d.slice(0, 4) : ''), monat: true });
      else if (horizont <= 90 && new Date(d + 'T12:00:00Z').getUTCDay() === 1) aus.push({ tage: t, text: '', monat: false });
    }
    return aus;
  }, [heute, horizont]);

  const anzahl = { ueberfaellig: fristen.filter(f => f.stufe === 'ueberfaellig').length, dringend: fristen.filter(f => f.stufe === 'dringend').length };

  return (
    <section className="rounded-[10px] border border-line bg-fl shadow-1" aria-label="Fristen-Zeitachse">
      <header className="flex flex-wrap items-center gap-3 border-b border-line-2 px-4 py-3">
        <h2 className="text-[13.5px] font-semibold">Fristen</h2>
        <span className="text-[12.5px] text-mute tabular">
          {anzahl.ueberfaellig > 0 && <b className="font-semibold text-krit">{anzahl.ueberfaellig} überfällig</b>}
          {anzahl.ueberfaellig > 0 && anzahl.dringend > 0 && ' · '}
          {anzahl.dringend > 0 && <b className="font-semibold text-krit">{anzahl.dringend} in 7 Tagen</b>}
          {anzahl.ueberfaellig + anzahl.dringend === 0 && 'nichts Dringendes'}
        </span>
        <div className="ml-auto flex rounded-[8px] border border-line bg-fl-3 p-0.5" role="tablist" aria-label="Zeitraum">
          {HORIZONTE.map(h => (
            <button key={h} role="tab" aria-selected={h === horizont} onClick={() => setHorizont(h)}
              className={cn('h-6 rounded-[6px] px-2.5 text-[12px] font-medium tabular', h === horizont ? 'bg-fl text-ink shadow-1' : 'text-mute hover:text-ink')}>
              {h} Tage
            </button>
          ))}
        </div>
      </header>

      <div className="relative px-3 pb-3 pt-2 [--lab:84px] [--re:64px] sm:px-4 sm:[--lab:128px] sm:[--re:92px]">
        {/* Achse */}
        <div className="relative ml-[var(--lab)] mr-[var(--re)] h-5 text-[10.5px] text-dim">
          {marken.filter(m => m.monat && Math.abs(x(m.tage) - x(0)) > 6).map(m => (
            <span key={m.tage} className="absolute -translate-x-1/2 whitespace-nowrap font-medium uppercase tracking-wide" style={{ left: `${x(m.tage)}%` }}>{m.text}</span>
          ))}
          <span className="absolute -translate-x-1/2 whitespace-nowrap font-semibold text-ink" style={{ left: `${x(0)}%` }}>Heute</span>
        </div>

        <div className="relative">
          {/* Hintergrund: Überfällig-Zone, Wochenlinien, Heute-Linie */}
          <div className="pointer-events-none absolute inset-y-0 left-[var(--lab)] right-[var(--re)]">
            <div className="absolute inset-y-0 left-0 rounded-l-md bg-krit-soft/60" style={{ width: `${x(0)}%` }} />
            {marken.map(m => <div key={m.tage} className={cn('absolute inset-y-0 w-px', m.monat ? 'bg-line' : 'bg-line-2')} style={{ left: `${x(m.tage)}%` }} />)}
            <div className="absolute -top-1.5 bottom-0 w-[1.5px] bg-ink" style={{ left: `${x(0)}%` }} />
          </div>

          {spuren.map(sp => (
            <div key={sp.key} className="relative flex h-[38px] items-center border-t border-line-2 first:border-t-0">
              <div className="w-[var(--lab)] shrink-0 pr-2 text-[11.5px] font-medium leading-tight text-ink-2 sm:pr-3 sm:text-[12px]"><span className="sm:hidden">{sp.kurz}</span><span className="hidden sm:inline">{sp.label}</span></div>
              <div className="relative h-full flex-1">
                <AnimatePresence>
                  {sp.punkte.map((p, i) => {
                    const n = p.fristen.length;
                    const ids = p.fristen.map(f => f.antrag_id);
                    const gewaehlt = aktiv && ids.every(id => aktiv.includes(id));
                    const groesse = n === 1 ? 12 : Math.min(26, 14 + n * 2);
                    return (
                      <motion.button key={p.schluessel} type="button"
                        initial={ruhig ? false : { opacity: 0, scale: .4 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .4 }}
                        transition={{ duration: .25, delay: ruhig ? 0 : Math.min(i * .015, .3) }}
                        onMouseEnter={() => setZeige(p)} onMouseLeave={() => setZeige(z => (z === p ? null : z))}
                        onFocus={() => setZeige(p)} onBlur={() => setZeige(null)}
                        onClick={() => onWaehle(gewaehlt ? null : ids, `${FRIST_ART[p.fristen[0].art]} ${p.tage < -VERGANGEN ? 'älter' : datumDE(p.datum)}`)}
                        aria-label={`${n} Frist${n > 1 ? 'en' : ''} ${datumDE(p.datum)}, ${restText(p.tage)}`}
                        className={cn('absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-content-center rounded-full text-[10.5px] font-semibold tabular transition-shadow',
                          p.stufe === 'ueberfaellig' && 'bg-krit text-white',
                          p.stufe === 'dringend' && 'bg-fl text-krit shadow-[inset_0_0_0_2px_var(--krit)]',
                          p.stufe === 'bald' && 'bg-warn text-white',
                          (p.stufe === 'ruhig' || p.stufe === 'unbekannt') && (p.geschaetzt ? 'bg-fl text-mute shadow-[inset_0_0_0_1.5px_var(--dim)] [border:1px_dashed_var(--dim)]' : 'bg-ink-2 text-fl'),
                          gewaehlt && 'ring-2 ring-ink ring-offset-2 ring-offset-fl')}
                        style={{ left: `${x(p.tage)}%`, width: groesse, height: groesse }}>
                        {n > 1 ? n : ''}
                        {p.stufe === 'ueberfaellig' && !ruhig && <span className="absolute inset-0 animate-ping rounded-full bg-krit/40" />}
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
              </div>
              <div className="flex w-[var(--re)] shrink-0 flex-col items-end gap-0.5 pl-2 text-right text-[11px] leading-tight text-mute">
                {sp.spaeter.length > 0 && <button className="hover:text-ink" onClick={() => onWaehle(sp.spaeter.map(f => f.antrag_id), `${sp.label} später`)}>+{sp.spaeter.length}<span className="hidden sm:inline"> später</span></button>}
                {sp.ohne.length > 0 && <button className="hover:text-ink" onClick={() => onWaehle(sp.ohne.map(f => f.antrag_id), `${sp.label} ohne Datum`)}>{sp.ohne.length}<span className="hidden sm:inline"> ohne Datum</span><span className="sm:hidden"> o. D.</span></button>}
              </div>
            </div>
          ))}

          {/* Tooltip */}
          <AnimatePresence>
            {zeige && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .12 }}
                className="pointer-events-none absolute z-10 w-64 -translate-x-1/2 rounded-[10px] border border-line bg-fl p-3 text-[12.5px] shadow-3"
                style={{ left: `clamp(8rem, calc(var(--lab) + (100% - var(--lab) - var(--re)) * ${x(zeige.tage) / 100}), calc(100% - 8rem))`, top: `${RADAR_SPUREN.findIndex(s => zeige.schluessel.startsWith(s.key)) * 38 + 40}px` }}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <b className="font-semibold">{FRIST_ART[zeige.fristen[0].art]} · {zeige.tage < -VERGANGEN ? 'ab ' : ''}{datumDE(zeige.datum)}</b>
                  <span className={cn('tabular', zeige.tage < 0 ? 'text-krit' : zeige.tage <= 7 ? 'text-krit' : zeige.tage <= 30 ? 'text-warn' : 'text-mute')}>{restText(zeige.tage)}</span>
                </div>
                <ul className="grid gap-0.5 text-ink-2">
                  {zeige.fristen.slice(0, 6).map(f => <li key={f.antrag_id + f.art} className="truncate">{f.kunde}{f.geschaetzt ? <span className="text-mute"> · frühestens</span> : ''}</li>)}
                  {zeige.fristen.length > 6 && <li className="text-mute">+{zeige.fristen.length - 6} weitere</li>}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
