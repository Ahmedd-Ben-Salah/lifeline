'use client';
/** 60-day forecast of days left: median, 10–90% band (300 simulations), no-action line, storm, deliveries, run-out. */
import { useState } from 'react';
import type { StockForecast } from '@/lib/engine/resources';

interface Props { f: StockForecast; dailyUse: number; reserveDays: number; colonyName: string; resourceLabel: string }

export default function ForecastChart({ f, dailyUse, reserveDays, colonyName, resourceLabel }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 270, L = 50, R = 620, T = 22, B = 214;
  const toD = (kg: number) => kg / dailyUse;
  const all = [...f.p90.map(toD), ...f.noAction.map(toD), reserveDays + 10];
  const top = Math.max(20, Math.ceil(Math.max(...all) / 20) * 20);
  const n = f.sols.length - 1;
  const x = (s: number) => L + (s / n) * (R - L);
  const y = (d: number) => B - (Math.max(0, Math.min(top, d)) / top) * (B - T);
  const path = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(toD(v)).toFixed(1)}`).join(' ');
  const band = `${f.p90.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(toD(v)).toFixed(1)}`).join(' ')} ${f.p10.map((_, j) => { const i = n - j; return `L${x(i).toFixed(1)} ${y(toD(f.p10[i])).toFixed(1)}`; }).join(' ')} Z`;
  const ticks = Array.from({ length: top / 20 + 1 }, (_, i) => i * 20).filter(t => top <= 120 || t % 40 === 0);
  const runOutNo = f.runOutSol.noAction, runOutPlan = f.runOutSol.withPlan;
  const deliveries = f.events.filter(e => e.kind === 'delivery');
  const sw = f.stormWindow;
  const hi = hover !== null ? hover : null;
  const summary = `${resourceLabel} at ${colonyName}: ${runOutNo !== null ? `if we do nothing it runs out in ${runOutNo} days` : 'if we do nothing it still lasts 60 days'}; ${runOutPlan !== null ? `with deliveries it runs out in ${runOutPlan} days` : 'with deliveries it lasts 60 days'}.`;
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={summary}
        onMouseMove={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const s = Math.round(((px - L) / (R - L)) * n); setHover(s >= 0 && s <= n ? s : null); }}
        onMouseLeave={() => setHover(null)}>
        <g stroke="#EEF0F3">{ticks.map(t => <path key={t} d={`M${L} ${y(t)}H${R}`} />)}</g>
        <g fontFamily="var(--mono)" fontSize="10" fill="#8A919C" textAnchor="end">{ticks.map(t => <text key={t} x={L - 8} y={y(t) + 4}>{t}</text>)}</g>
        <text x={L - 8} y={T - 8} fontSize="10" fill="#8A919C" textAnchor="end" fontFamily="var(--font)">days left</text>
        {sw && <><rect x={x(sw.from)} y={T - 2} width={Math.max(2, x(Math.min(n, sw.to)) - x(sw.from))} height={B - T + 2} fill="#FEF3E2" opacity=".7" /><text x={x(sw.from) + 7} y={T + 12} fontSize="11" fill="#9A4A07" fontFamily="var(--font)">dust storm</text></>}
        <line x1={L} x2={R} y1={y(reserveDays)} y2={y(reserveDays)} stroke="#D97706" strokeDasharray="4 4" />
        <text x={R - 4} y={y(reserveDays) - 6} fontSize="11" fill="#9A4A07" textAnchor="end" fontFamily="var(--font)">safe level ({reserveDays} days)</text>
        <path d={band} fill="#2F6FEB" opacity=".13" />
        <path d={path(f.noAction)} fill="none" stroke="#DC2626" strokeWidth="2" strokeDasharray="5 4" />
        <path d={path(f.median)} fill="none" stroke="#2F6FEB" strokeWidth="2.2" strokeLinejoin="round" />
        {runOutNo !== null && <><circle cx={x(runOutNo)} cy={y(0)} r="4" fill="#DC2626" /><text x={x(runOutNo) + (runOutNo > n * 0.7 ? -8 : 8)} y={y(0) - 8} fontSize="11" fill="#B91C1C" textAnchor={runOutNo > n * 0.7 ? 'end' : 'start'} fontFamily="var(--font)">runs out in {runOutNo} days</text></>}
        {runOutPlan !== null && <><circle cx={x(runOutPlan)} cy={y(0)} r="4" fill="#1F56C7" /><text x={x(runOutPlan) - 8} y={y(0) - 22} fontSize="11" fill="#1F56C7" textAnchor="end" fontFamily="var(--font)">runs out in {runOutPlan} days</text></>}
        {deliveries.map((d, i) => { const s = Math.min(n, Math.max(0, Math.round(d.sol))); return <g key={i}><circle cx={x(s)} cy={y(toD(f.median[s]))} r="4.5" fill="#2F6FEB" stroke="#fff" strokeWidth="1.5" /><text x={x(s) - 8} y={y(toD(f.median[s])) + 16 + i * 13} textAnchor="end" fontSize="11" fill="#1F56C7" fontFamily="var(--font)">rover arrives</text></g>; })}
        <g fontFamily="var(--mono)" fontSize="10" fill="#5B6370" textAnchor="middle">{[0, 15, 30, 45, 60].filter(s => s <= n).map(s => <text key={s} x={x(s)} y={B + 18}>{s === 0 ? 'today' : `day ${s}`}</text>)}</g>
        {hi !== null && <g><line x1={x(hi)} x2={x(hi)} y1={T} y2={B} stroke="#0E1116" strokeOpacity=".25" /><circle cx={x(hi)} cy={y(toD(f.median[hi]))} r="3.5" fill="#2F6FEB" /></g>}
      </svg>
      {hi !== null && (
        <div className="mono" style={{ position: 'absolute', top: 6, left: `${(x(hi) / W) * 100}%`, transform: hi > n * 0.6 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)', background: 'var(--ink)', color: '#fff', fontSize: 11.5, padding: '6px 9px', borderRadius: 8, pointerEvents: 'none', whiteSpace: 'nowrap', lineHeight: 1.5 }}>
          day {hi}<br />with deliveries: {Math.round(toD(f.median[hi]))} days left<br />if we do nothing: {Math.round(toD(f.noAction[hi]))} days left
        </div>
      )}
      <div className="legend" style={{ marginTop: 4 }}>
        <span><i style={{ width: 18, borderTop: '2px solid #2F6FEB' }} />With deliveries</span>
        <span><i style={{ width: 14, height: 8, borderRadius: 3, background: 'rgba(47,111,235,.18)' }} />Could be anywhere here</span>
        <span><i style={{ width: 18, borderTop: '2px dashed #DC2626' }} />If we do nothing</span>
        {sw && <span><i style={{ width: 14, height: 8, borderRadius: 3, background: '#FEF3E2', border: '1px solid #F6DDB8' }} />Storm</span>}
      </div>
    </div>
  );
}
