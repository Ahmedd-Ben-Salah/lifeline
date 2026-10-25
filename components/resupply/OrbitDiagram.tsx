'use client';
/**
 * True-scale heliocentric view of the transfer (positions in AU from the JPL ephemeris,
 * trajectory from the Lambert solution propagated with RK4). Looking down on the ecliptic,
 * vernal equinox to the right. Planets are drawn bigger than life so you can see them.
 */
import { useId, useMemo } from 'react';

type P = { x: number; y: number };
export interface OrbitData { earthNow: P; marsNow: P; earthDep: P; marsArr: P; earthOrbit: P[]; marsOrbit: P[]; traj: P[] }

const W = 560, H = 360;

export default function OrbitDiagram({ o, tofDays, depUtc, arrUtc }: { o: OrbitData; tofDays: number; depUtc: string; arrUtc: string }) {
  const uid = useId().replace(/:/g, '');
  const g = useMemo(() => {
    const maxR = Math.max(...o.marsOrbit.map(p => Math.hypot(p.x, p.y)));
    const s = (H / 2 - 34) / maxR;
    const cx = W / 2 + 10, cy = H / 2;
    const T = (p: P) => ({ x: cx + p.x * s, y: cy - p.y * s });
    const path = (pts: P[], close = false) => pts.map((p, i) => { const q = T(p); return `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`; }).join(' ') + (close ? 'Z' : '');
    const traj = o.traj.length ? path(o.traj) : '';
    const mid = o.traj.length ? T(o.traj[Math.floor(o.traj.length / 2)]) : T(o.earthDep);
    // nudge the label outward from the Sun
    const mdx = mid.x - cx, mdy = mid.y - cy, ml = Math.hypot(mdx, mdy) || 1;
    return { cx, cy, s, T, earth: path(o.earthOrbit, true), mars: path(o.marsOrbit, true), traj, pill: { x: mid.x + (mdx / ml) * 26, y: mid.y + (mdy / ml) * 26 }, auR: s };
  }, [o]);
  const eN = g.T(o.earthNow), mN = g.T(o.marsNow), eD = g.T(o.earthDep), mA = g.T(o.marsArr);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  // lit side faces the Sun: gradient focus offset toward the Sun
  const shade = (p: { x: number; y: number }, id: string) => {
    const dx = g.cx - p.x, dy = g.cy - p.y, l = Math.hypot(dx, dy) || 1;
    return <radialGradient id={id} cx={0.5 + (dx / l) * 0.28} cy={0.5 + (dy / l) * 0.28} r="0.75"><stop offset="0" stopColor="#000" stopOpacity="0" /><stop offset="0.55" stopColor="#000" stopOpacity="0.1" /><stop offset="1" stopColor="#000" stopOpacity="0.82" /></radialGradient>;
  };
  const planet = (p: { x: number; y: number }, r: number, tex: string, id: string, atm: string) => (
    <g>
      <circle cx={p.x} cy={p.y} r={r + 3.5} fill={atm} opacity="0.18" />
      <circle cx={p.x} cy={p.y} r={r} fill={`url(#${tex})`} />
      <circle cx={p.x} cy={p.y} r={r} fill={`url(#${id})`} />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Transfer orbit from Earth (${fmt(depUtc)}) to Mars (${fmt(arrUtc)}), ${Math.round(tofDays)} days`} style={{ display: 'block' }}>
      <defs>
        <radialGradient id={`sun${uid}`}><stop offset="0" stopColor="#FFF8E6" /><stop offset="0.35" stopColor="#FFE2A8" /><stop offset="1" stopColor="#FFB45C" /></radialGradient>
        <radialGradient id={`glow${uid}`}><stop offset="0" stopColor="#FFD38A" stopOpacity="0.55" /><stop offset="0.4" stopColor="#FFB45C" stopOpacity="0.14" /><stop offset="1" stopColor="#FFB45C" stopOpacity="0" /></radialGradient>
        <pattern id={`et${uid}`} patternUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><image href="/textures/earth-day.jpg" x="-30" y="0" width="200" height="100" preserveAspectRatio="none" /></pattern>
        <pattern id={`mt${uid}`} patternUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><image href="/textures/mars-color-2k.jpg" x="-80" y="0" width="200" height="100" preserveAspectRatio="none" /></pattern>
        <linearGradient id={`tr${uid}`} gradientUnits="userSpaceOnUse" x1={eD.x} y1={eD.y} x2={mA.x} y2={mA.y}><stop offset="0" stopColor="#7FB0FF" /><stop offset="1" stopColor="#F2A47E" /></linearGradient>
        {shade(eD, `se${uid}`)}{shade(mA, `sm${uid}`)}
        <filter id={`bl${uid}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      <rect width={W} height={H} fill="#05070B" />
      <image href="/textures/stars.jpg" x="-200" y="-120" width="1100" height="560" preserveAspectRatio="xMidYMid slice" opacity="0.55" />
      {/* 1 AU reference ring + ecliptic axis */}
      <line x1={g.cx} y1={12} x2={g.cx} y2={H - 12} stroke="#fff" strokeOpacity="0.05" />
      <line x1={14} y1={g.cy} x2={W - 14} y2={g.cy} stroke="#fff" strokeOpacity="0.05" />
      <path d={g.mars} fill="none" stroke="#B5583B" strokeOpacity="0.55" strokeWidth="1.1" />
      <path d={g.earth} fill="none" stroke="#6FA4E6" strokeOpacity="0.55" strokeWidth="1.1" />
      {/* Sun */}
      <circle cx={g.cx} cy={g.cy} r={46} fill={`url(#glow${uid})`} />
      <circle cx={g.cx} cy={g.cy} r={10} fill={`url(#sun${uid})`} />
      {/* transfer arc */}
      {g.traj && <>
        <path d={g.traj} fill="none" stroke={`url(#tr${uid})`} strokeWidth="6" strokeOpacity="0.35" filter={`url(#bl${uid})`} />
        <path id={`tp${uid}`} d={g.traj} fill="none" stroke={`url(#tr${uid})`} strokeWidth="2.2" strokeLinecap="round" />
        <circle r="3.2" fill="#fff"><animateMotion dur="7s" repeatCount="indefinite" rotate="auto"><mpath href={`#tp${uid}`} /></animateMotion></circle>
      </>}
      {/* now markers */}
      <circle cx={eN.x} cy={eN.y} r="4" fill="none" stroke="#9DBCF7" strokeWidth="1.4" strokeDasharray="2 2" />
      <text x={eN.x} y={eN.y + 16} textAnchor="middle" fontSize="9.5" fill="#9AA4B2">Earth now</text>
      <circle cx={mN.x} cy={mN.y} r="4" fill="none" stroke="#E7A07F" strokeWidth="1.4" strokeDasharray="2 2" />
      <text x={mN.x} y={mN.y + 16} textAnchor="middle" fontSize="9.5" fill="#9AA4B2">Mars now</text>
      {planet(eD, 9, `et${uid}`, `se${uid}`, '#6FA4E6')}
      {planet(mA, 7.5, `mt${uid}`, `sm${uid}`, '#E7A07F')}
      <g fontFamily="var(--font)" fontWeight="600" fontSize="11.5">
        <text x={eD.x} y={eD.y + 26} textAnchor="middle" fill="#9DBCF7">Earth at launch</text>
        <text x={eD.x} y={eD.y + 39} textAnchor="middle" fill="#8A919C" fontWeight="400" fontSize="10" fontFamily="var(--mono)">{fmt(depUtc)}</text>
        <text x={mA.x} y={mA.y - 22} textAnchor="middle" fill="#F2A47E">Mars at landing</text>
        <text x={mA.x} y={mA.y - 10} textAnchor="middle" fill="#8A919C" fontWeight="400" fontSize="10" fontFamily="var(--mono)">{fmt(arrUtc)}</text>
      </g>
      <g transform={`translate(${g.pill.x},${g.pill.y})`}>
        <rect x="-36" y="-11" width="72" height="22" rx="11" fill="#fff" />
        <text y="4" textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="#0E1116">{Math.round(tofDays)} days</text>
      </g>
      {/* scale bar: 1 AU */}
      <g transform={`translate(30,${H - 18})`}>
        <line x1="0" x2={g.auR * 0.5} y1="0" y2="0" stroke="#8A919C" strokeWidth="1.2" />
        <line x1="0" x2="0" y1="-3" y2="3" stroke="#8A919C" /><line x1={g.auR * 0.5} x2={g.auR * 0.5} y1="-3" y2="3" stroke="#8A919C" />
        <text x="0" y="-6" textAnchor="start" fontSize="9.5" fill="#8A919C" fontFamily="var(--mono)">75 million km</text>
      </g>
      <text x={W - 16} y={H - 14} textAnchor="end" fontSize="9.5" fill="#6B7280">Real orbits, drawn to scale</text>
    </svg>
  );
}
