'use client';
// Kurze Meldungen unten; mit „Rückgängig“ 8 Sekunden (auch ⌘Z / Strg+Z)
import { AnimatePresence, motion } from 'framer-motion';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Taste } from './ui';

interface Meldung { id: number; text: string; art: 'ok' | 'fehler' | 'info'; rueckgaengig?: () => void }
const Ctx = createContext<(text: string, art?: Meldung['art'], rueckgaengig?: () => void) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [m, setM] = useState<Meldung | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const zeige = useCallback((text: string, art: Meldung['art'] = 'info', rueckgaengig?: () => void) => {
    clearTimeout(timer.current);
    const neu = { id: Date.now(), text, art, rueckgaengig };
    setM(neu);
    timer.current = setTimeout(() => setM(x => (x?.id === neu.id ? null : x)), rueckgaengig ? 8000 : art === 'fehler' ? 6000 : 3000);
  }, []);
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && m?.rueckgaengig && !(e.target as HTMLElement).closest('textarea, input:not([type=checkbox]):not([type=radio])')) {
        e.preventDefault(); m.rueckgaengig(); setM(null);
      }
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [m]);
  return (
    <Ctx.Provider value={zeige}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1.5rem+var(--leiste,0px))] z-[90] flex justify-center px-4 transition-[bottom]" aria-live="polite">
        <AnimatePresence>
          {m && (
            <motion.div key={m.id} initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }}
              transition={{ duration: .16 }}
              className={`pointer-events-auto flex max-w-xl items-center gap-3 rounded-[10px] px-3.5 py-2 text-[13.5px] shadow-3 ${m.art === 'fehler' ? 'bg-krit text-white' : 'bg-pri text-pri-fg'}`}>
              {m.art === 'ok' && <span className="size-[7px] shrink-0 rounded-full bg-ok" />}
              <span>{m.text}</span>
              {m.rueckgaengig && (
                <button onClick={() => { m.rueckgaengig!(); setM(null); }}
                  className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-current/30 px-2 text-[12.5px] font-medium hover:bg-current/10">
                  Rückgängig <Taste className="border-current/30 bg-transparent text-current">⌘Z</Taste>
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
