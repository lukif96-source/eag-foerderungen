'use client';
// Schwebende Leiste, sobald etwas ausgewählt ist: Massenaktionen ohne Dialog
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Download, X } from 'lucide-react';
import { useEffect } from 'react';
import { heuteText } from '@/lib/daten';
import { sperre } from '@/lib/meta';
import type { Antrag } from '@/lib/types';
import { Knopf, Taste } from './ui';

export function Aktionsleiste({ gewaehlt, darfSchreiben, onErledigt, onCsv, onLeeren }:
  { gewaehlt: Antrag[]; darfSchreiben: boolean; onErledigt: (liste: Antrag[]) => void; onCsv: () => void; onLeeren: () => void }) {
  const heute = heuteText();
  const machbar = gewaehlt.filter(a => !sperre(a, heute));
  const sichtbar = gewaehlt.length > 0;
  // Meldungen rutschen über die Leiste (toast.tsx liest --leiste)
  useEffect(() => {
    document.documentElement.style.setProperty('--leiste', sichtbar ? '64px' : '0px');
    return () => { document.documentElement.style.removeProperty('--leiste'); };
  }, [sichtbar]);
  return (
    <AnimatePresence>
      {gewaehlt.length > 0 && (
        <motion.div role="toolbar" aria-label="Auswahl"
          initial={{ opacity: 0, y: 24, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: .97 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className="fixed inset-x-0 bottom-5 z-40 mx-auto flex w-fit max-w-[calc(100%-24px)] flex-wrap items-center gap-2 rounded-[12px] border border-line bg-fl px-2 py-2 shadow-3">
          <span className="px-2 text-[13px] font-medium tabular">{gewaehlt.length} ausgewählt</span>
          <span className="h-5 w-px bg-line" />
          {darfSchreiben && (
            <Knopf art="primaer" disabled={!machbar.length} onClick={() => onErledigt(machbar)}
              title="Bei allen Ausgewählten den nächsten Schritt mit heutigem Datum setzen">
              <Check className="size-4" strokeWidth={2.4} />Nächsten Schritt erledigen{machbar.length !== gewaehlt.length ? ` (${machbar.length})` : ''}
            </Knopf>
          )}
          <Knopf onClick={onCsv}><Download className="size-4" />CSV</Knopf>
          <Knopf art="leise" onClick={onLeeren} title="Auswahl aufheben (Esc)"><X className="size-4" /><Taste>Esc</Taste></Knopf>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
