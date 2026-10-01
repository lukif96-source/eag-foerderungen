'use client';
// Akte als Seitenschublade (kein Modal): Liste bleibt sichtbar, J/K wechseln weiter die Förderung
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, ExternalLink, History, X } from 'lucide-react';
import { useState } from 'react';
import { CONFIG } from '@/lib/config';
import { cn } from '@/lib/cn';
import { useEreignisse } from '@/lib/hooks';
import { heuteText } from '@/lib/daten';
import { datumDE, restText, sperre, STATUS, zpOhneAT } from '@/lib/meta';
import type { Antrag, Frist } from '@/lib/types';
import { FristMarke } from './frist';
import { Tracker } from './tracker';
import { Knopf, Skelett, Taste } from './ui';

const SCHRITT_LABEL: Record<string, string> = {
  projekt: 'Projekt im Portal angelegt', ticket: 'Ticket gezogen', eingereicht: 'Antrag eingereicht', nachforderung: 'Nachforderung erhalten',
  nachgereicht: 'Unterlagen nachgereicht', vertrag_erhalten: 'Fördervertrag erhalten', vertrag_versendet: 'Vertrag versendet',
  verlaengert_bis: 'Frist verlängert bis', inbetriebnahme: 'In Betrieb genommen', herkunftsnachweis: 'Bei der E-Control registriert',
  rechnung: 'Rechnung hochgeladen', zahlung: 'Zahlung hochgeladen', abgeschlossen: 'Endabrechnung eingereicht', ausgezahlt: 'Ausgezahlt',
  abgelehnt: 'Abgelehnt', zurueckgezogen: 'Zurückgezogen', erloschen: 'Zusage erloschen',
  nachforderung_abrechnung: 'Nachforderung zur Endabrechnung', nachgereicht_abrechnung: 'Endabrechnung: nachgereicht',
};

function Kennung({ label, wert, kopie }: { label: string; wert: string; kopie?: string }) {
  const [ok, setOk] = useState(false);
  if (!wert) return null;
  return (
    <button onClick={() => { navigator.clipboard?.writeText(kopie ?? wert); setOk(true); setTimeout(() => setOk(false), 900); }}
      className="group flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left hover:bg-fl-3" title="Kopieren">
      <span className="shrink-0 text-[12px] text-mute">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 break-all text-right font-mono text-[12px]">{wert}
        {ok ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5 text-dim opacity-0 group-hover:opacity-100" />}</span>
    </button>
  );
}

export function Akte({ a, fristen, darfSchreiben, onZu, onErledigt }:
  { a: Antrag | null; fristen: Frist[]; darfSchreiben: boolean; onZu: () => void; onErledigt: (a: Antrag) => void }) {
  const ereignisse = useEreignisse(a?.id ?? null);
  const grund = a ? sperre(a, heuteText()) : null;
  return (
    <AnimatePresence>
      {a && (
        <motion.aside key="akte" role="complementary" aria-label={`Akte ${a.kunde}`}
          initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }} transition={{ duration: .2, ease: [.2, .8, .2, 1] }}
          className="fixed inset-y-0 right-0 z-30 flex w-full max-w-[460px] flex-col border-l border-line bg-bg shadow-3">
          <header className="flex items-start gap-3 border-b border-line bg-fl px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[17px] font-semibold tracking-tight">{a.kunde || '(ohne Namen)'}</h2>
              <p className="mt-0.5 text-[12.5px] text-mute">{[a.plz, a.ort].filter(Boolean).join(' ')}{a.versuch > 1 ? ` · Versuch ${a.versuch}` : ''}</p>
            </div>
            <a href={CONFIG.appUrl} target="_blank" rel="noreferrer" className="mt-1 text-mute hover:text-ink" title="In der App öffnen"><ExternalLink className="size-4" /></a>
            <button onClick={onZu} className="mt-0.5 text-mute hover:text-ink" aria-label="Schließen (Esc)"><X className="size-5" /></button>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <section className={cn('relative overflow-hidden rounded-[10px] border border-line bg-fl p-4 shadow-1',
              (a.frist_stufe === 'ueberfaellig' || a.frist_stufe === 'dringend') && 'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-krit')}>
              <Tracker a={a} gross />
              <div className="mt-4 border-t border-line-2 pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-mute">
                  {STATUS[a.status].ende ? 'Stand' : `Als Nächstes${STATUS[a.status].wartet ? ' · Förderstelle ist dran' : ' · Wir sind dran'}`}
                </div>
                <div className="mt-0.5 text-[17px] font-semibold tracking-tight">{STATUS[a.status].todo}</div>
                {a.daten_fehlen.length > 0 && <p className="mt-1 text-[12.5px] text-krit">Für das Ticket fehlt: {a.daten_fehlen.join(', ')}</p>}
                {a.status === 'antrag_einreichen' && a.antrag_daten_fehlen.length > 0 && <p className="mt-1 text-[12.5px] text-warn">Für den Antrag ergänzen: {a.antrag_daten_fehlen.join(', ')}</p>}
                <div className="mt-2"><FristMarke stufe={a.frist_stufe} datum={a.frist_datum} tage={a.frist_tage} label={a.frist_label} geschaetzt={a.frist_geschaetzt} lang /></div>
                {darfSchreiben && STATUS[a.status].knopf && STATUS[a.status].setzt && (
                  <>
                    <Knopf art="primaer" className="mt-3 h-9 w-full" disabled={!!grund} onClick={() => onErledigt(a)}>
                      <Check className="size-4" strokeWidth={2.4} />{STATUS[a.status].knopf} – heute <Taste className="ml-1 hidden border-white/30 bg-transparent text-current sm:inline-grid">E</Taste>
                    </Knopf>
                    {grund && !a._speichert && <p className="mt-1.5 text-center text-[12px] text-mute">{grund}</p>}
                  </>
                )}
              </div>
            </section>

            {a.offene_punkte && (
              <section className="rounded-[10px] border border-line border-l-[3px] border-l-warn bg-fl p-3 text-[13px]">
                <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-warn">Offene Punkte</div>{a.offene_punkte}
              </section>
            )}

            {fristen.length > 0 && (
              <section className="rounded-[10px] border border-line bg-fl p-3">
                <h3 className="mb-2 text-[12px] font-semibold">Fristen</h3>
                <ul className="grid gap-1.5">
                  {fristen.map(f => (
                    <li key={f.art} className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span>{f.label}<span className="block text-[11.5px] text-mute">{f.hinweis}</span></span>
                      <span className={cn('whitespace-nowrap font-medium tabular', f.stufe === 'ueberfaellig' || f.stufe === 'dringend' ? 'text-krit' : f.stufe === 'bald' ? 'text-warn' : 'text-ink-2')}>
                        {f.datum ? datumDE(f.datum) : '–'} <span className="font-normal text-mute">· {restText(f.tage)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-[10px] border border-line bg-fl p-2">
              <h3 className="mb-1 px-2 pt-1 text-[12px] font-semibold">Kennungen <span className="font-normal text-mute">· Klick kopiert</span></h3>
              <Kennung label="Zählpunkt" wert={a.zaehlpunkt} />
              {zpOhneAT(a.zaehlpunkt) !== a.zaehlpunkt && <Kennung label="fürs Ticket (ohne AT)" wert={zpOhneAT(a.zaehlpunkt)} />}
              <Kennung label="EAG-Nr." wert={a.eag_nr} />
              <Kennung label="FPJ-Nr." wert={a.fpj} />
              <Kennung label="Ticket" wert={a.ticket_nr ? a.ticket_nr + (a.ticket_uhrzeit ? ` · ${a.ticket_uhrzeit.slice(0, 8)}` : '') : ''} kopie={a.ticket_nr} />
              <Kennung label="Projekt-Nr." wert={a.projekt_nr} />
            </section>

            {(a.messtool_abnahme_am || a.messtool_kwp) && (
              <section className="rounded-[10px] border border-line bg-fl p-3 text-[13px]">
                <h3 className="mb-1 text-[12px] font-semibold">Messtool</h3>
                <p>Abnahme {datumDE(a.messtool_abnahme_am)} · gemessen {String(a.messtool_kwp ?? '–').replace('.', ',')} kWp
                  {a.kwp && a.messtool_kwp && Math.abs(a.kwp - a.messtool_kwp) > .05
                    ? <span className="text-warn"> · beantragt {String(a.kwp).replace('.', ',')} kWp – vor der Endabrechnung prüfen</span> : null}</p>
              </section>
            )}

            <section className="rounded-[10px] border border-line bg-fl p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold"><History className="size-3.5 text-mute" />Protokoll</h3>
              {ereignisse.isLoading ? <div className="grid gap-2"><Skelett className="h-8" /><Skelett className="h-8" /><Skelett className="h-8" /></div>
                : ereignisse.isError ? <p className="text-[12.5px] text-krit">Protokoll konnte nicht geladen werden.</p>
                : (
                  <ol className="relative grid gap-2.5 border-l border-line pl-3">
                    {(ereignisse.data ?? []).slice(0, 30).map(e => (
                      <li key={e.id} className="text-[12.5px]">
                        <span className={cn('absolute -left-[4.5px] mt-1.5 size-2 rounded-full', e.art === 'schritt_entfernt' ? 'bg-krit' : e.art === 'schritt_gesetzt' ? 'bg-ok' : 'bg-dim')} />
                        <div>{e.schritt ? (SCHRITT_LABEL[e.schritt] ?? e.schritt) : e.feld || e.art}
                          {e.art === 'schritt_entfernt' && <span className="text-krit"> – zurückgenommen</span>}
                          {e.art === 'schritt_gesetzt' && e.neu && typeof e.neu === 'object' && 'datum' in (e.neu as object) && (e.neu as { datum: string | null }).datum
                            ? <span className="text-mute"> · {datumDE((e.neu as { datum: string }).datum)}</span> : null}</div>
                        <div className="text-[11.5px] text-mute tabular">{new Date(e.zeit).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })} · {e.von}{e.quelle !== 'app' ? ` · ${e.quelle}` : ''}</div>
                      </li>
                    ))}
                    {!ereignisse.data?.length && <li className="text-[12.5px] text-mute">Noch keine Einträge.</li>}
                  </ol>
                )}
            </section>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
