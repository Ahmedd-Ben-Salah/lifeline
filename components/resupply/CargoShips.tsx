'use client';
/** Side profile of each Starship-class cargo lander with a cutaway cargo bay filled by the packer. */
import { useId } from 'react';
import type { PackedShip, Category } from '@/lib/engine/packer';
import st from './resupply.module.css';

export const CAT_COLOR: Record<Category, string> = { WATER: '#3A6EA5', O2: '#0E9F8E', FOOD: '#C28A12', SPARES: '#7357C9', ROVERS: '#64748B' };
const STACK: Category[] = ['ROVERS', 'SPARES', 'FOOD', 'WATER', 'O2']; // heavy at the bottom
const BAY = { x: 47, y: 74, w: 26, h: 150 }; // cargo bay window in the hull

export function Starship({ s }: { s: PackedShip }) {
  const uid = useId().replace(/:/g, '');
  const items = s.items.slice().sort((a, b) => STACK.indexOf(a.category) - STACK.indexOf(b.category));
  let y = BAY.y + BAY.h;
  const blocks = items.map(it => { const h = (it.massT / 100) * BAY.h; y -= h; return { ...it, y, h }; });
  const fillY = BAY.y + BAY.h * (1 - s.fillPct);
  return (
    <svg viewBox="0 0 120 300" width="100%" height="100%" role="img" aria-label={`${s.ship}: ${s.massT} tonnes, ${Math.round(s.fillPct * 100)}% full`}>
      <defs>
        <linearGradient id={`steel${uid}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#6E757E" /><stop offset="0.18" stopColor="#B9C0C8" /><stop offset="0.42" stopColor="#F1F4F7" />
          <stop offset="0.6" stopColor="#D3D8DE" /><stop offset="0.85" stopColor="#959CA5" /><stop offset="1" stopColor="#5E656D" />
        </linearGradient>
        <linearGradient id={`flap${uid}`} x1="0" x2="1"><stop offset="0" stopColor="#2A2E35" /><stop offset="1" stopColor="#4A5059" /></linearGradient>
        <linearGradient id={`bell${uid}`} x1="0" x2="1"><stop offset="0" stopColor="#3B3F46" /><stop offset="0.5" stopColor="#8D939B" /><stop offset="1" stopColor="#30343A" /></linearGradient>
        <linearGradient id={`glass${uid}`} x1="0" x2="1"><stop offset="0" stopColor="#0B0E13" /><stop offset="0.5" stopColor="#1A1F27" /><stop offset="1" stopColor="#0B0E13" /></linearGradient>
        <clipPath id={`bay${uid}`}><rect x={BAY.x} y={BAY.y} width={BAY.w} height={BAY.h} rx="4" /></clipPath>
      </defs>
      {/* aft flaps (behind hull) */}
      <path d="M40 206 L22 222 L22 258 L40 258 Z" fill={`url(#flap${uid})`} />
      <path d="M80 206 L98 222 L98 258 L80 258 Z" fill={`url(#flap${uid})`} />
      {/* forward flaps */}
      <path d="M41 44 L30 58 L30 80 L41 82 Z" fill={`url(#flap${uid})`} />
      <path d="M79 44 L90 58 L90 80 L79 82 Z" fill={`url(#flap${uid})`} />
      {/* hull: ogive nose + cylinder */}
      <path d="M60 4 C 74 14, 80 34, 80 56 L80 262 L40 262 L40 56 C 40 34, 46 14, 60 4 Z" fill={`url(#steel${uid})`} stroke="#5E656D" strokeWidth="0.6" />
      {/* heat-shield tiles on the windward side */}
      <path d="M40 56 C 40 34, 46 14, 60 4 C 52 14, 47 34, 47 56 L47 262 L40 262 Z" fill="#1E2228" opacity="0.92" />
      {/* hull ring lines */}
      {Array.from({ length: 15 }, (_, i) => 66 + i * 13.5).map(yy => <line key={yy} x1="47" x2="80" y1={yy} y2={yy} stroke="#5E656D" strokeOpacity="0.25" strokeWidth="0.6" />)}
      {/* cargo bay cutaway */}
      <rect x={BAY.x - 1.5} y={BAY.y - 1.5} width={BAY.w + 3} height={BAY.h + 3} rx="5" fill="#2B3038" />
      <rect x={BAY.x} y={BAY.y} width={BAY.w} height={BAY.h} rx="4" fill={`url(#glass${uid})`} />
      <g clipPath={`url(#bay${uid})`}>
        {blocks.map(b => (
          <g key={b.id}>
            <rect x={BAY.x + 1.5} y={b.y + 0.6} width={BAY.w - 3} height={Math.max(0.5, b.h - 1.2)} rx="1.5" fill={CAT_COLOR[b.category]} />
            <rect x={BAY.x + 1.5} y={b.y + 0.6} width={(BAY.w - 3) * 0.35} height={Math.max(0.5, b.h - 1.2)} rx="1.5" fill="#fff" opacity="0.12" />
          </g>
        ))}
        <line x1={BAY.x} x2={BAY.x + BAY.w} y1={fillY} y2={fillY} stroke="#fff" strokeDasharray="2 2" strokeOpacity="0.7" />
      </g>
      <text x={BAY.x + BAY.w + 9} y={Math.max(BAY.y + 8, fillY + 3)} fontSize="8.5" fontFamily="var(--mono)" fill="#5B6370">{Math.round(s.fillPct * 100)}%</text>
      {/* engine skirt + 3 sea-level Raptor-class bells */}
      <rect x="40" y="262" width="40" height="6" fill="#3A3F46" />
      {[44, 54, 64].map(x => <path key={x} d={`M${x + 2} 268 L${x + 10} 268 L${x + 12} 286 L${x} 286 Z`} fill={`url(#bell${uid})`} />)}
      <ellipse cx="60" cy="292" rx="34" ry="3" fill="#0E1116" opacity="0.08" />
    </svg>
  );
}

export default function CargoShips({ ships }: { ships: PackedShip[] }) {
  return (
    <div className={st.ships}>
      {ships.map(s => (
        <div key={s.ship} className={st.ship}>
          <div style={{ height: 230 }}><Starship s={s} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><b style={{ fontWeight: 600 }}>{s.ship}</b><span className="mono muted">{s.massT} t</span></div>
          <div className="bar" aria-hidden="true"><i style={{ width: `${Math.round(s.fillPct * 100)}%`, background: s.fillPct > 0.97 ? 'var(--warn-dot)' : 'var(--signal)' }} /></div>
        </div>
      ))}
    </div>
  );
}
