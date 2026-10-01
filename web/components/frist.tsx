'use client';
import { Clock } from 'lucide-react';
import { datumDE, restText } from '@/lib/meta';
import type { FristStufe } from '@/lib/types';
import { Marke } from './ui';

// Frist als Marke: Farbe nur nach Dringlichkeit; überfällig voll rot
export function FristMarke({ stufe, datum, tage, label, geschaetzt, lang = false }:
  { stufe: FristStufe | null; datum: string | null; tage: number | null; label?: string | null; geschaetzt?: boolean | null; lang?: boolean }) {
  if (!stufe) return null;
  const ton = stufe === 'ueberfaellig' ? 'voll' : stufe === 'dringend' ? 'krit' : stufe === 'bald' ? 'warn' : 'neutral';
  return (
    <Marke ton={ton} className={geschaetzt ? 'border-dashed' : ''}>
      <Clock className="size-3" />
      {lang && label ? `${label}: ` : ''}{datum ? datumDE(datum, !lang) : 'ohne Datum'}{geschaetzt ? ' (frühestens)' : ''}
      <span className="opacity-80">· {restText(tage)}</span>
    </Marke>
  );
}
