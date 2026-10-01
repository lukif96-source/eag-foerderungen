'use client';
// Fängt Fehler eines Bereichs ab: der Rest des Dashboards bleibt bedienbar, „Neu laden“ setzt den Bereich zurück
import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props { children: ReactNode; bereich: string; onNeu?: () => void }
export class Fehlergrenze extends Component<Props, { fehler: Error | null }> {
  state = { fehler: null as Error | null };
  static getDerivedStateFromError(fehler: Error) { return { fehler }; }
  componentDidCatch(fehler: Error) { console.error(`[${this.props.bereich}]`, fehler); }
  render() {
    if (!this.state.fehler) return this.props.children;
    return (
      <div role="alert" className="flex items-start gap-3 rounded-[10px] border border-krit-line bg-krit-soft p-4 text-[13px] text-krit">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="grid gap-1">
          <b className="font-semibold">{this.props.bereich} konnte nicht angezeigt werden.</b>
          <span className="text-ink-2">{this.state.fehler.message}</span>
          <button className="justify-self-start text-[12.5px] font-medium underline underline-offset-2"
            onClick={() => { this.setState({ fehler: null }); this.props.onNeu?.(); }}>Neu laden</button>
        </div>
      </div>
    );
  }
}
