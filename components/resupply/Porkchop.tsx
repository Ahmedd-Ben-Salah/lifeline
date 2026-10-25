'use client';
/**
 * Porkchop plot: launch energy C3 (km²/s²) for every departure date × time of flight,
 * each cell one Lambert solution. Rendered with bilinear interpolation at device resolution,
 * banded palette + contour lines (marching squares) at C3 = best + 1, 2, 4, 8, 16, 32.
 */
import { useEffect, useRef, useState } from 'react';

export interface PorkchopData { depStartJd: number; depStepDays: number; nDep: number; tofStartDays: number; tofStepDays: number; nTof: number; c3: (number | null)[]; best: { depJd: number; tofDays: number; c3: number } }

const M = { l: 48, r: 14, t: 12, b: 34 };
const OFFSETS = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48];
// deep → light blue, ending in the card surface (high energy)
const STOPS = ['#123A8C', '#1A4BB0', '#1F56C7', '#2F6FEB', '#4A86F0', '#6A9CF3', '#8BB3F6', '#AECBF9', '#CCDDFB', '#E2ECFD', '#EEF4FF', '#F6F8FC', '#FBFBFC'];
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const PAL = STOPS.map(hex);
const CONTOURS = [1, 2, 4, 8, 16, 32];
const jdToDate = (jd: number) => new Date((jd - 2440587.5) * 86400000);
const fmtD = (jd: number, y = false) => jdToDate(jd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(y ? { year: 'numeric' } : {}), timeZone: 'UTC' });

export default function Porkchop({ d }: { d: PorkchopData }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 560, h: 330 });
  const [hover, setHover] = useState<{ x: number; y: number; dep: number; tof: number; c3: number } | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => { const w = el.clientWidth; setSize({ w, h: Math.round(Math.max(260, Math.min(380, w * 0.6))) }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const val = (u: number, v: number) => {
    const i0 = Math.max(0, Math.min(d.nDep - 2, Math.floor(u))), j0 = Math.max(0, Math.min(d.nTof - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i0)), fv = Math.max(0, Math.min(1, v - j0));
    const g = (i: number, j: number) => { const x = d.c3[j * d.nDep + i]; return x === null || x === undefined || isNaN(x as number) ? 400 : Math.min(400, x as number); };
    return (g(i0, j0) * (1 - fu) + g(i0 + 1, j0) * fu) * (1 - fv) + (g(i0, j0 + 1) * (1 - fu) + g(i0 + 1, j0 + 1) * fu) * fv;
  };

  useEffect(() => {
    const c = cv.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { w, h } = size;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = w + 'px'; c.style.height = h + 'px';
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height);
    const pw = Math.round((w - M.l - M.r) * dpr), ph = Math.round((h - M.t - M.b) * dpr);
    const img = ctx.createImageData(pw, ph);
    const best = d.best.c3;
    const levels = OFFSETS.map(o => best + o);
    for (let y = 0; y < ph; y++) {
      const v = (1 - (y + 0.5) / ph) * (d.nTof - 1);
      for (let x = 0; x < pw; x++) {
        const u = ((x + 0.5) / pw) * (d.nDep - 1);
        const c3 = val(u, v);
        // band index with a soft 8 % edge for anti-aliasing
        let k = 0; while (k < levels.length && c3 > levels[k]) k++;
        let col = PAL[k];
        if (k > 0 && k < levels.length) {
          const lo = levels[k - 1], hi = levels[k], f = (c3 - lo) / (hi - lo);
          if (f < 0.08) { const t = 0.5 + f / 0.16; const a = PAL[k - 1]; col = [a[0] + (col[0] - a[0]) * t, a[1] + (col[1] - a[1]) * t, a[2] + (col[2] - a[2]) * t]; }
        }
        const p = (y * pw + x) * 4;
        img.data[p] = col[0]; img.data[p + 1] = col[1]; img.data[p + 2] = col[2]; img.data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, Math.round(M.l * dpr), Math.round(M.t * dpr));
    ctx.scale(dpr, dpr);
    const PW = w - M.l - M.r, PH = h - M.t - M.b;
    const X = (u: number) => M.l + (u / (d.nDep - 1)) * PW;
    const Y = (v: number) => M.t + (1 - v / (d.nTof - 1)) * PH;

    // contour lines — marching squares on the raw grid
    ctx.lineWidth = 1;
    ctx.font = '500 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (const off of CONTOURS) {
      const L = best + off;
      ctx.strokeStyle = off <= 4 ? 'rgba(255,255,255,0.75)' : 'rgba(14,17,22,0.28)';
      ctx.beginPath();
      let labelAt: { x: number; y: number } | null = null;
      for (let j = 0; j < d.nTof - 1; j++) for (let i = 0; i < d.nDep - 1; i++) {
        const g = (a: number, b: number) => { const x = d.c3[b * d.nDep + a]; return x === null || isNaN(x as number) ? 400 : (x as number); };
        const a = g(i, j), b = g(i + 1, j), cc = g(i + 1, j + 1), dd = g(i, j + 1);
        const idx = (a > L ? 1 : 0) | (b > L ? 2 : 0) | (cc > L ? 4 : 0) | (dd > L ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        const lerp = (p: number, q: number) => (L - p) / (q - p);
        const e: Record<string, [number, number]> = { b: [i + lerp(a, b), j], r: [i + 1, j + lerp(b, cc)], t: [i + lerp(dd, cc), j + 1], l: [i, j + lerp(a, dd)] };
        const segs: Record<number, string[][]> = { 1: [['l', 'b']], 2: [['b', 'r']], 3: [['l', 'r']], 4: [['r', 't']], 5: [['l', 't'], ['b', 'r']], 6: [['b', 't']], 7: [['l', 't']], 8: [['t', 'l']], 9: [['t', 'b']], 10: [['t', 'r'], ['l', 'b']], 11: [['t', 'r']], 12: [['r', 'l']], 13: [['r', 'b']], 14: [['b', 'l']] };
        for (const [p, q] of segs[idx]) {
          ctx.moveTo(X(e[p][0]), Y(e[p][1])); ctx.lineTo(X(e[q][0]), Y(e[q][1]));
          const yy = Y(e[p][1]);
          if (!labelAt || yy < labelAt.y) labelAt = { x: X(e[p][0]), y: yy };
        }
      }
      ctx.stroke();
      if (labelAt && labelAt.y > M.t + 8 && off >= 4) {
        const t = `${Math.round(L)}`;
        ctx.fillStyle = off <= 4 ? '#FFFFFF' : '#5B6370';
        void t; // contour values are not labelled: the colour scale already says less / more fuel
      }
    }

    // axes
    ctx.strokeStyle = '#D7DBE1'; ctx.lineWidth = 1;
    ctx.strokeRect(M.l + 0.5, M.t + 0.5, PW - 1, PH - 1);
    ctx.fillStyle = '#5B6370'; ctx.font = '400 10.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    // x: departure dates, ticks at month starts
    const start = jdToDate(d.depStartJd), endJd = d.depStartJd + d.depStepDays * (d.nDep - 1);
    const m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    ctx.textAlign = 'center';
    while ((m.getTime() / 86400000 + 2440587.5) <= endJd) {
      const jd = m.getTime() / 86400000 + 2440587.5;
      const x = X((jd - d.depStartJd) / d.depStepDays);
      ctx.strokeStyle = 'rgba(14,17,22,0.08)'; ctx.beginPath(); ctx.moveTo(x, M.t); ctx.lineTo(x, M.t + PH); ctx.stroke();
      ctx.fillText(m.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }), x, M.t + PH + 15);
      m.setUTCMonth(m.getUTCMonth() + 1);
    }
    // y: time of flight
    ctx.textAlign = 'right';
    for (let tof = Math.ceil(d.tofStartDays / 30) * 30; tof <= d.tofStartDays + d.tofStepDays * (d.nTof - 1); tof += 30) {
      const y = Y((tof - d.tofStartDays) / d.tofStepDays);
      ctx.strokeStyle = 'rgba(14,17,22,0.08)'; ctx.beginPath(); ctx.moveTo(M.l, y); ctx.lineTo(M.l + PW, y); ctx.stroke();
      ctx.fillText(`${tof} d`, M.l - 6, y + 3.5);
    }
    ctx.save(); ctx.translate(12, M.t + PH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.font = '500 10.5px system-ui, sans-serif'; ctx.fillStyle = '#8A919C'; ctx.fillText('Trip length', 0, 0); ctx.restore();

    // best transfer marker
    const bx = X((d.best.depJd - d.depStartJd) / d.depStepDays), by = Y((d.best.tofDays - d.tofStartDays) / d.tofStepDays);
    ctx.lineWidth = 2; ctx.strokeStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#0E1116'; ctx.beginPath(); ctx.arc(bx, by, 9, 0, Math.PI * 2); ctx.stroke();
    const label = `Best day · ${Math.round(d.best.tofDays)}-day trip`; void best;
    ctx.font = '600 11px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    const lx = Math.min(M.l + PW - tw - 18, bx + 14), ly = Math.max(M.t + 14, by - 14);
    ctx.fillStyle = 'rgba(14,17,22,0.88)';
    ctx.beginPath(); ctx.roundRect(lx, ly - 13, tw + 14, 20, 10); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left'; ctx.fillText(label, lx + 7, ly + 1);
  }, [d, size]); // eslint-disable-line react-hooks/exhaustive-deps

  function move(e: React.MouseEvent) {
    const r = cv.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const PW = size.w - M.l - M.r, PH = size.h - M.t - M.b;
    if (x < M.l || x > M.l + PW || y < M.t || y > M.t + PH) { setHover(null); return; }
    const u = ((x - M.l) / PW) * (d.nDep - 1), v = (1 - (y - M.t) / PH) * (d.nTof - 1);
    setHover({ x, y, dep: d.depStartJd + u * d.depStepDays, tof: d.tofStartDays + v * d.tofStepDays, c3: val(u, v) });
  }

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <canvas ref={cv} onMouseMove={move} onMouseLeave={() => setHover(null)} role="img"
        aria-label={`Best launch dates. The best day is ${fmtD(d.best.depJd, true)}, with a ${Math.round(d.best.tofDays)}-day trip.`}
        style={{ display: 'block', borderRadius: 10, border: '1px solid var(--line-2)', cursor: 'crosshair' }} />
      {hover && (
        <div style={{ position: 'absolute', left: Math.min(hover.x + 14, size.w - 190), top: Math.max(4, hover.y - 70), pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 10, padding: '8px 10px', fontSize: 12, lineHeight: 1.5, boxShadow: 'var(--sh-3)', width: 176 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Fuel needed: {hover.c3 < 10 ? 'low' : hover.c3 < 16 ? 'medium' : hover.c3 < 40 ? 'high' : 'too much'}</div>
          <div style={{ color: '#C3C8D0' }}>Launch <span className="mono">{fmtD(hover.dep, true)}</span></div>
          <div style={{ color: '#C3C8D0' }}>Trip <span className="mono">{Math.round(hover.tof)} days</span> · lands <span className="mono">{fmtD(hover.dep + hover.tof)}</span></div>
        </div>
      )}
    </div>
  );
}
