'use client';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Art = 'primaer' | 'normal' | 'leise' | 'gefahr';
const ARTEN: Record<Art, string> = {
  primaer: 'bg-pri text-pri-fg border-pri hover:bg-pri-hover hover:border-pri-hover',
  normal: 'bg-fl text-ink border-line hover:border-line-3 hover:bg-fl-2 shadow-1',
  leise: 'bg-transparent text-mute border-transparent hover:bg-fl-3 hover:text-ink',
  gefahr: 'bg-fl text-krit border-line hover:bg-krit-soft hover:border-krit-line',
};
export const Knopf = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { art?: Art; klein?: boolean }>(
  function Knopf({ art = 'normal', klein, className, ...rest }, ref) {
    return <button ref={ref} {...rest} className={cn('inline-flex items-center justify-center gap-1.5 rounded-[7px] border font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none',
      klein ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]', ARTEN[art], className)} />;
  });

export function Taste({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('inline-grid h-[18px] min-w-[18px] place-content-center rounded border border-b-2 border-line bg-fl px-1 font-sans text-[11px] font-medium text-mute', className)}>{children}</kbd>;
}

export function Skelett({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-fl-3', className)} />;
}

export function Marke({ children, ton = 'neutral', className }: { children: ReactNode; ton?: 'neutral' | 'ok' | 'warn' | 'krit' | 'voll'; className?: string }) {
  const t = { neutral: 'bg-fl-3 text-mute border-line', ok: 'bg-ok-soft text-ok border-ok-line', warn: 'bg-warn-soft text-warn border-warn-line',
    krit: 'bg-krit-soft text-krit border-krit-line', voll: 'bg-krit text-white border-krit' }[ton];
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11.5px] font-medium whitespace-nowrap tabular', t, className)}>{children}</span>;
}
