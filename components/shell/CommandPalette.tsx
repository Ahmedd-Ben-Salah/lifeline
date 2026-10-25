'use client';
/** ⌘K: jump anywhere, or ask the agents a question. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const ITEMS = [
  { label: 'Overview', href: '/app', kw: 'home kpi' },
  { label: '3D view — planets and rockets', href: '/app/traffic', kw: 'orbit 3d planet ship' },
  { label: 'Storms — where the dust storm is going', href: '/app/forecasts', kw: 'storm dust ensemble cone weather' },
  { label: 'AI chat — talk to the colony AIs', href: '/app/comms', kw: 'message agent ask thread' },
  { label: 'Rovers — supplies moving on Mars', href: '/app/logistics', kw: 'rover convoy route transfer r-7 r-3' },
  { label: 'Earth orders — supplies from Earth', href: '/app/resupply', kw: 'launch window porkchop cargo order approve' },
  { label: 'Arcadia Station', href: '/app/colonies/arcadia', kw: 'colony arcadia' },
  { label: 'Jezero Base', href: '/app/colonies/jezero', kw: 'colony jezero' },
  { label: 'Utopia Outpost', href: '/app/colonies/utopia', kw: 'colony utopia' },
  { label: 'Valles Hub', href: '/app/colonies/valles', kw: 'colony valles' },
  { label: 'Automations — your own AI helpers', href: '/app/automations', kw: 'graph workflow' },
  { label: 'Rules — what the AI may do alone', href: '/app/policies', kw: 'policy threshold autonomy' },
  { label: 'Settings', href: '/app/settings', kw: 'profile sign out' },
];

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 10); } }, [open]);
  const list = useMemo(() => {
    const s = q.toLowerCase().trim();
    const hits = ITEMS.filter(i => !s || (i.label + ' ' + i.kw).toLowerCase().includes(s));
    return s.length > 3 ? [...hits, { label: `Ask the AIs: “${q}”`, href: `/app/comms?ask=${encodeURIComponent(q)}`, kw: '' }] : hits;
  }, [q]);
  if (!open) return null;
  const go = (href: string) => { onClose(); router.push(href); };
  return (
    <div className="cmdk" onClick={onClose} role="dialog" aria-modal="true" aria-label="Search">
      <div className="box fade-in" onClick={e => e.stopPropagation()}>
        <input ref={input} value={q} placeholder="Search pages, or ask the AIs a question…" onChange={e => { setQ(e.target.value); setSel(0); }}
          onKeyDown={e => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowDown') { e.preventDefault(); setSel(x => Math.min(list.length - 1, x + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setSel(x => Math.max(0, x - 1)); } if (e.key === 'Enter' && list[sel]) go(list[sel].href); }} />
        <div role="listbox" style={{ maxHeight: 360, overflow: 'auto', padding: 6 }}>
          {list.map((i, k) => <div key={i.href + i.label} role="option" aria-selected={k === sel} className="item" onMouseEnter={() => setSel(k)} onClick={() => go(i.href)}>{i.label}</div>)}
          {!list.length && <div className="item faint">No results</div>}
        </div>
      </div>
    </div>
  );
}
