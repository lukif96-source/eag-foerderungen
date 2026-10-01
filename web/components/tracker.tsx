'use client';
// Status-Tracker: je Phase ein Abschnitt, je Hauptschritt ein Strich (wie in der App)
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/cn';
import { PHASEN, SCHRITTE_KURZ, SCHRITT_PHASE, STATUS } from '@/lib/meta';
import type { Antrag } from '@/lib/types';

export function Tracker({ a, gross = false }: { a: Pick<Antrag, 'erledigt' | 'naechster' | 'luecken' | 'status' | 'phase'>; gross?: boolean }) {
  const ruhig = useReducedMotion();
  const gestoppt = a.phase === 'beendet';
  const erledigt = a.erledigt.filter(Boolean).length;
  const jetzt = PHASEN.find(p => p.key === a.phase);
  const balken = (
    <div className={cn('flex', gross ? 'gap-2' : 'gap-1')} aria-label={`${erledigt} von 12 Schritten erledigt`}>
      {PHASEN.map(p => {
        const idx = SCHRITT_PHASE.map((ph, i) => (ph === p.key ? i : -1)).filter(i => i >= 0);
        const aktiv = idx.includes(a.naechster) || (a.phase === p.key);
        return (
          <div key={p.key} className="grid min-w-0" style={{ flex: idx.length }}>
            <div className={cn('flex', gross ? 'gap-[3px]' : 'gap-[2px]')}>
              {idx.map(i => {
                const z = a.erledigt[i] ? 'ok' : a.luecken.includes(i) ? 'luecke' : i === a.naechster ? (STATUS[a.status].wartet ? 'wartet' : 'jetzt') : 'offen';
                return (
                  <motion.i key={i} title={SCHRITTE_KURZ[i]}
                    animate={z === 'jetzt' && !ruhig ? { opacity: [1, .4, 1] } : { opacity: 1 }}
                    transition={z === 'jetzt' ? { duration: 1.6, repeat: Infinity } : { duration: .2 }}
                    className={cn('block flex-1 rounded-full', gross ? 'h-[5px]' : 'h-1',
                      z === 'ok' && 'bg-ok', z === 'luecke' && 'bg-krit', z === 'wartet' && 'schraffur',
                      z === 'jetzt' && 'bg-fl shadow-[inset_0_0_0_1.5px_var(--ink)]',
                      z === 'offen' && (gestoppt ? 'shadow-[inset_0_0_0_1px_var(--line-3)]' : 'bg-line'))} />
                );
              })}
            </div>
            {gross && (
              <span title={`${p.label}: ${idx.filter(i => a.erledigt[i]).length} von ${idx.length}`}
                className={cn('mt-1.5 truncate text-[11px]', aktiv ? 'font-semibold text-ink' : idx.every(i => a.erledigt[i]) ? 'text-mute' : 'text-dim')}>
                {p.kurz}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
  if (!gross) return balken;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-[12px]">
        <span className="font-semibold">{gestoppt ? 'Beendet' : a.phase === 'fertig' ? 'Abgeschlossen' : `Phase: ${jetzt?.label ?? ''}`}</span>
        <span className="text-mute tabular">{erledigt} von 12 erledigt</span>
      </div>
      {balken}
    </div>
  );
}
