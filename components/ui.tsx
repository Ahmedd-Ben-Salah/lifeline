'use client';
/** Design-system components (lifeline.css classes → React). */
import Link from 'next/link';
import type { ReactNode } from 'react';

export function Chip({ tone = 'neutral', children, dot = true }: { tone?: 'ok' | 'warn' | 'crit' | 'info' | 'neutral' | 'off'; children: ReactNode; dot?: boolean }) {
  return <span className={`chip chip-${tone}`}>{dot && tone !== 'info' && tone !== 'neutral' && tone !== 'off' && <span className="d" />}{children}</span>;
}

export function StatusChip({ status }: { status: string }) {
  const tone = status === 'CRITICAL' ? 'crit' : status === 'WATCH' ? 'warn' : 'ok';
  return <Chip tone={tone}>{status === 'CRITICAL' ? 'Urgent' : status === 'WATCH' ? 'Watch' : 'OK'}</Chip>;
}

/** Plain names for the agent message types. */
export const KIND_NAME: Record<string, string> = {
  WARN: 'Warning', NEED: 'Needs help', OFFER: 'Offer', ACCEPT: 'Accepted', TIMEOUT: 'No reply', ORDER: 'Earth order',
  FAULT: 'Problem', INFO: 'Update', ASK: 'Question', ANSWER: 'Answer',
};
export function ProtocolTag({ kind }: { kind: string }) {
  return <span className={`tag t-${kind.toLowerCase()}`} style={{ fontFamily: 'var(--font)', fontSize: 11.5, whiteSpace: 'nowrap' }}>{KIND_NAME[kind] ?? kind}</span>;
}

/** Plain names for agents and people. */
const AGENT_NAME: Record<string, string> = {
  'weather-agent': 'Weather AI', 'jezero-agent': 'Jezero AI', 'arcadia-agent': 'Arcadia AI', 'utopia-agent': 'Utopia AI',
  'valles-agent': 'Valles AI', 'logistics-agent': 'Rover AI', 'earth-supply-agent': 'Earth supply AI', 'earth-control': 'Earth control',
  system: 'System', supplier: 'Supplier', network: 'everyone',
};
export function agentName(id?: string | null) {
  if (!id) return '';
  if (AGENT_NAME[id]) return AGENT_NAME[id];
  if (id.startsWith('ops:')) { const n = id.slice(4); return n.charAt(0).toUpperCase() + n.slice(1); }
  const words = id.replace(/-agent$/, '').split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1) + (id.endsWith('-agent') ? ' AI' : '');
}
/** "r-7" → "Rover 7" */
export const roverName = (code?: string | null) => (code ? `Rover ${code.replace(/^r-/, '')}` : '');

export function KV({ k, v, vStyle }: { k: ReactNode; v: ReactNode; vStyle?: React.CSSProperties }) {
  return <div className="kv"><span className="k">{k}</span><span className="ln" /><span className="v" style={vStyle}>{v}</span></div>;
}

export function RingCard({ title, right, children, sect, lift, style, className }: { title: ReactNode; right?: ReactNode; children?: ReactNode; sect?: ReactNode; lift?: boolean; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={`ring${lift ? ' lift' : ''}${className ? ' ' + className : ''}`} style={style}>
      <div className="in">
        <div className="head"><b>{title}</b>{right && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{right}</span>}</div>
        {children && <div className="body">{children}</div>}
        {sect}
      </div>
    </div>
  );
}

export function Spark({ values, color = '#2F6FEB', w = 80, h = 32 }: { values: number[]; color?: string; w?: number; h?: number }) {
  if (!values.length) return <svg width={w} height={h} aria-hidden="true" />;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * (w - 4) + 1, h - 4 - ((v - min) / span) * (h - 8) + 1]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx={last[0]} cy={last[1]} r="2.5" fill={color} /></svg>;
}

export function Kpi({ label, value, unit, color, right }: { label: ReactNode; value: ReactNode; unit?: ReactNode; color?: string; right?: ReactNode }) {
  return (
    <div className="kpi">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="l">{label}</div>
        <div className="n" style={color ? { color } : undefined}>{value}{unit && <small> {unit}</small>}</div>
      </div>
      {right}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map(o => <button key={o.value} role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Skeleton({ h = 120, style }: { h?: number; style?: React.CSSProperties }) {
  return <div className="skel" style={{ height: h, ...style }} aria-hidden="true" />;
}

export function ErrorCard({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return <div className="err-card" role="alert"><span className="dot dot-crit" />Couldn&apos;t load {what}.{onRetry && <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={onRetry}>Retry</button>}</div>;
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Bar({ value, color }: { value: number; color?: string }) {
  return <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, background: color }} /></div>;
}

/** Countdown ring for light-delayed messages: fills as the message travels. */
export function DelayRing({ startMs, endMs, now, size = 16 }: { startMs: number; endMs: number; now: number; size?: number }) {
  const f = Math.max(0, Math.min(1, (now - startMs) / Math.max(1, endMs - startMs)));
  const r = size / 2 - 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF0F3" strokeWidth="2.5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2F6FEB" strokeWidth="2.5" strokeDasharray={`${f * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeLinecap="round" />
    </svg>
  );
}

export const AgentAvatar = ({ id }: { id: string }) => {
  const map: Record<string, [string, string, string]> = {
    'weather-agent': ['WX', '#FEF3E2', '#9A4A07'], 'jezero-agent': ['JZ', '#EEF4FF', '#1F56C7'], 'arcadia-agent': ['AR', '#FDECEC', '#B91C1C'],
    'utopia-agent': ['UT', '#EAF7EF', '#157A42'], 'valles-agent': ['VH', '#F6E9E3', '#8C3B22'], 'logistics-agent': ['LG', '#F1F3F5', '#3A414B'],
    'earth-supply-agent': ['ES', '#EEF4FF', '#1F56C7'], 'earth-control': ['EC', '#E8F0FA', '#3A6EA5'], system: ['SY', '#F1F3F5', '#5B6370'], supplier: ['SU', '#F1F3F5', '#3A414B'],
  };
  const [t, bg, fg] = map[id] ?? [id.replace('ops:', '').slice(0, 2).toUpperCase(), '#0E1116', '#FFFFFF'];
  return <span className="who" style={{ background: bg, color: fg }}>{t}</span>;
};

export function LinkBtn({ href, children, dark, small }: { href: string; children: ReactNode; dark?: boolean; small?: boolean }) {
  return <Link className={`btn${dark ? ' btn-dark' : ''}${small ? ' btn-sm' : ''}`} href={href}>{children}</Link>;
}

export const Icons = {
  overview: <svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="4" rx="2" /><rect x="13" y="10" width="7" height="10" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /></svg>,
  traffic: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><ellipse cx="12" cy="12" rx="9.5" ry="4" /></svg>,
  forecasts: <svg viewBox="0 0 24 24"><path d="M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1.5A3.3 3.3 0 0 0 7 18z" /></svg>,
  comms: <svg viewBox="0 0 24 24"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5V14a2.5 2.5 0 0 1-2.5 2.5H10L6 20v-3.5h-.5A1.5 1.5 0 0 1 4 15z" /></svg>,
  logistics: <svg viewBox="0 0 24 24"><rect x="4" y="9" width="16" height="6" rx="3" /><circle cx="8" cy="18" r="2" /><circle cx="16" cy="18" r="2" /></svg>,
  resupply: <svg viewBox="0 0 24 24"><path d="M12 3c3 3 4 7 3 12H9C8 10 9 6 12 3zM9 15l-2 4M15 15l2 4" /></svg>,
  colonies: <svg viewBox="0 0 24 24"><path d="M3 18a9 9 0 0 1 18 0zM3 18h18" /></svg>,
  automations: <svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="12" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8.5 6H12a3 3 0 0 1 3 3v.5M8.5 18H12a3 3 0 0 0 3-3v-.5" /></svg>,
  policies: <svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" /></svg>,
  settings: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
};
