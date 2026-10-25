'use client';
/** Hidden demo controls — press D (ADMIN) or add ?demo=1. */
import { useEffect, useState } from 'react';
import { useLive, post } from '@/lib/client/live';
import { useToast } from '@/lib/client/toast';

const ACTIONS: { id: string; label: string; hint: string; body?: unknown }[] = [
  { id: 'reset', label: 'Start over', hint: 'Back to the start' },
  { id: 'replay', label: 'Start the storm (live)', hint: 'Watch the AIs talk' },
  { id: 'fail-rover', label: 'Break Rover 3', hint: 'Make the problem happen now' },
  { id: 'advance', label: 'Skip 1 day', hint: 'Supplies and rovers move', body: { sols: 1 } },
  { id: 'earth-confirm', label: 'Earth says yes', hint: 'Earth control approves' },
];

export default function DemoPanel() {
  const { state, bump } = useLive();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isAdmin = state?.me?.role === 'ADMIN';
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') === '1') setOpen(true);
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || e.metaKey || e.ctrlKey) return;
      if (e.key === 'd' || e.key === 'D') setOpen(o => !o);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  if (!open || !isAdmin) return null;
  async function run(a: typeof ACTIONS[number]) {
    setBusy(a.id);
    try {
      const r = await post<{ llmMessages?: number; total?: number }>(`/api/demo/${a.id}`, a.body ?? {});
      toast(a.id === 'replay' ? `Storm started · Claude wrote ${r.llmMessages ?? 0} of ${r.total ?? 0} messages` : `${a.label} ✓`);
      bump();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  }
  return (
    <div className="ring lift demo-panel fade-in" role="region" aria-label="Demo controls">
      <div className="in">
        <div className="head"><b>Demo controls</b><span className="chip chip-info" style={{ marginLeft: 'auto' }}>{state?.agents?.startsWith('llm') ? 'Claude on' : 'Claude off'}</span><button className="btn btn-sm icon-btn" style={{ width: 28 }} aria-label="Close demo controls" onClick={() => setOpen(false)}>×</button></div>
        <div className="body" style={{ gap: 6 }}>
          {ACTIONS.map(a => (
            <button key={a.id} className={`btn btn-sm${a.id === 'replay' ? ' btn-dark' : ''}`} style={{ justifyContent: 'space-between' }} disabled={!!busy} onClick={() => run(a)}>
              <span>{busy === a.id ? (a.id === 'replay' ? 'The AIs are writing…' : 'Working…') : a.label}</span><span className="faint" style={{ fontSize: 11 }}>{a.hint}</span>
            </button>
          ))}
        </div>
        <div className="sect"><span className="k">{state?.store === 'memory' ? 'Warning: shared storage is off · ' : ''}Press D to hide</span></div>
      </div>
    </div>
  );
}
