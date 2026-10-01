'use client';
import { useState } from 'react';
import { fehlerText, holeQuelle } from '@/lib/daten';
import { Knopf } from './ui';

export function Anmelden({ onAngemeldet }: { onAngemeldet: () => void }) {
  const [mail, setMail] = useState('');
  const [pw, setPw] = useState('');
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <form className="grid w-full max-w-[380px] gap-3.5 rounded-[14px] border border-line bg-fl p-7 shadow-3"
        onSubmit={async e => {
          e.preventDefault(); setLaeuft(true); setFehler('');
          try { await holeQuelle().anmelden(mail.trim(), pw); onAngemeldet(); } catch (err) { setFehler(fehlerText(err)); } finally { setLaeuft(false); }
        }}>
        <div className="flex items-center gap-2.5 text-[16px]"><span className="grid size-[34px] place-items-center rounded-[9px] bg-brand font-bold text-brand-ink">S</span><b>SOLPRO</b><span className="text-mute">EAG-Dashboard</span></div>
        <p className="text-[13px] text-mute">Gleiches Konto wie in der EAG-Förderliste.</p>
        <label className="grid gap-1 text-[12px] font-medium text-mute">E-Mail
          <input type="email" required autoComplete="username" value={mail} onChange={e => setMail(e.target.value)} className="h-10 rounded-[7px] border border-line bg-fl px-3 text-[14px] text-ink outline-none focus:border-ink-2" /></label>
        <label className="grid gap-1 text-[12px] font-medium text-mute">Passwort
          <input type="password" required autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} className="h-10 rounded-[7px] border border-line bg-fl px-3 text-[14px] text-ink outline-none focus:border-ink-2" /></label>
        {fehler && <p role="alert" className="rounded-[7px] border border-krit-line bg-krit-soft px-3 py-2 text-[13px] text-krit">{fehler}</p>}
        <Knopf art="primaer" type="submit" className="h-10" disabled={laeuft}>{laeuft ? 'Anmelden …' : 'Anmelden'}</Knopf>
      </form>
    </main>
  );
}
