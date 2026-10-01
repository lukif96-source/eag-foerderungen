'use client';
// ⌘K: Förderung finden, nächsten Schritt erledigen, Ansicht wechseln
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, FileText, Filter, Moon, RefreshCw, Search } from 'lucide-react';
import { heuteText } from '@/lib/daten';
import { datumDE, sperre, STATUS } from '@/lib/meta';
import type { Antrag } from '@/lib/types';
import { Taste } from './ui';

export interface Ansicht { key: string; label: string }

export function Befehle({ offen, onZu, antraege, ansichten, darfSchreiben, onOeffne, onErledigt, onAnsicht, onNeuLaden, onDarstellung }:
  { offen: boolean; onZu: () => void; antraege: Antrag[]; ansichten: Ansicht[]; darfSchreiben: boolean;
    onOeffne: (id: string) => void; onErledigt: (a: Antrag) => void; onAnsicht: (k: string) => void; onNeuLaden: () => void; onDarstellung: () => void }) {
  const tun = (f: () => void) => { onZu(); f(); };
  const heute = heuteText();
  const eintrag = 'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink-2 data-[selected=true]:bg-fl-3 data-[selected=true]:text-ink';
  const gruppe = '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-dim';
  return (
    <AnimatePresence>
      {offen && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--overlay)] px-4 pt-[12vh]" onMouseDown={e => e.target === e.currentTarget && onZu()}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .1 }}>
          <motion.div initial={{ y: 8, scale: .985 }} animate={{ y: 0, scale: 1 }} transition={{ duration: .14 }} className="w-full max-w-[640px]">
            <Command label="Suchen und Befehle" loop className="overflow-hidden rounded-[14px] border border-line bg-fl shadow-3"
              filter={(wert, suche) => (suche.toLowerCase().split(/\s+/).every(t => wert.toLowerCase().includes(t)) ? 1 : 0)}
              onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onZu(); } }}>
              <div className="flex items-center gap-2.5 border-b border-line px-4 text-mute">
                <Search className="size-4" />
                <Command.Input autoFocus placeholder="Kunde, Ort, Zählpunkt, EAG-Nr. … oder Befehl" className="h-[52px] flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-dim focus-visible:shadow-none" />
                <Taste>Esc</Taste>
              </div>
              <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
                <Command.Empty className="px-4 py-7 text-center text-[13px] text-mute">Nichts gefunden.</Command.Empty>
                <Command.Group heading="Förderungen" className={gruppe}>
                  {antraege.slice(0, 400).map(a => (
                    <Command.Item key={a.id} value={`${a.kunde} ${a.ort} ${a.plz} ${a.zaehlpunkt} ${a.eag_nr} ${a.fpj} ${a.ticket_nr} ${a.zieher} ${a.id}`} onSelect={() => tun(() => onOeffne(a.id))} className={eintrag}>
                      <FileText className="size-4 text-mute" />
                      <span className="grid min-w-0 flex-1"><b className="truncate font-medium text-ink">{a.kunde}</b><small className="truncate text-[12px] text-mute">{[a.ort, STATUS[a.status].todo].filter(Boolean).join(' · ')}</small></span>
                      {a.frist_datum && <span className="text-[12px] text-mute tabular">bis {datumDE(a.frist_datum, true)}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
                {darfSchreiben && (
                  <Command.Group heading="Nächsten Schritt erledigen" className={gruppe}>
                    {antraege.filter(a => !sperre(a, heute)).slice(0, 400).map(a => (
                      <Command.Item key={'e' + a.id} value={`erledigen ${a.kunde} ${a.ort} ${STATUS[a.status].knopf} ${a.id}`} onSelect={() => tun(() => onErledigt(a))} className={eintrag}>
                        <Check className="size-4 text-ok" /><span className="flex-1 truncate">{a.kunde}: {STATUS[a.status].knopf}</span><Taste>E</Taste>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                <Command.Group heading="Befehle" className={gruppe}>
                  {ansichten.map(v => (
                    <Command.Item key={v.key} value={`Ansicht ${v.label}`} onSelect={() => tun(() => onAnsicht(v.key))} className={eintrag}><Filter className="size-4 text-mute" />Ansicht: {v.label}</Command.Item>
                  ))}
                  <Command.Item value="Darstellung hell dunkel" onSelect={() => tun(onDarstellung)} className={eintrag}><Moon className="size-4 text-mute" />Darstellung wechseln</Command.Item>
                  <Command.Item value="Aktualisieren neu laden" onSelect={() => tun(onNeuLaden)} className={eintrag}><RefreshCw className="size-4 text-mute" />Aktualisieren</Command.Item>
                </Command.Group>
              </Command.List>
              <div className="flex gap-4 border-t border-line bg-fl-2 px-3.5 py-2 text-[12px] text-mute">
                <span className="flex items-center gap-1"><Taste>↑</Taste><Taste>↓</Taste> wählen</span>
                <span className="flex items-center gap-1"><Taste>↵</Taste> ausführen</span>
                <span className="flex items-center gap-1"><Taste>Esc</Taste> schließen</span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
