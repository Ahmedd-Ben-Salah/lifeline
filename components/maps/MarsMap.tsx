'use client';
/**
 * MarsMap — a real-terrain Mars map (equirectangular), pan + zoom.
 *
 * Base layer: /textures/mars-relief-4k.jpg — Viking colour mosaic × MOLA hillshade,
 * 4096×2048, left edge 180°W, top 90°N. Drawn as SVG <image> (repeated every 360° so
 * routes across the 180° meridian stay continuous). Overlays are drawn in screen pixels
 * through `proj`, so strokes and labels stay crisp at every zoom.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import st from './MarsMap.module.css';

export interface LL { lat: number; lon: number }
export interface View { lon: number; lat: number; s: number } // centre + pixels per degree
export interface Proj {
  W: number; H: number; s: number; view: View;
  /** screen [x, y] for a lat/lon; longitudes unwrapped around the view centre */
  p: (lat: number, lon: number) => [number, number];
  /** SVG path for a polyline (breaks where it would jump across the far meridian) */
  path: (pts: LL[], closed?: boolean) => string;
  kmPerPx: number;
}

const KM_PER_DEG = (Math.PI * 3389.5) / 180; // 59.16 km per degree of latitude on Mars
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export function boundsView(pts: LL[], W: number, H: number, pad = 0.18, refLon?: number): View {
  const ref = refLon ?? pts[0]?.lon ?? 0;
  const lons = pts.map(p => ref + wrap(p.lon - ref)), lats = pts.map(p => p.lat);
  const lo0 = Math.min(...lons), lo1 = Math.max(...lons), la0 = Math.min(...lats), la1 = Math.max(...lats);
  const spanLon = Math.max(8, (lo1 - lo0) * (1 + pad * 2)), spanLat = Math.max(6, (la1 - la0) * (1 + pad * 2));
  const s = Math.min(W / spanLon, H / spanLat);
  return { lon: wrap((lo0 + lo1) / 2), lat: (la0 + la1) / 2, s };
}

interface Props {
  /** points the initial view should frame */
  frame: LL[];
  /** when this key changes, the view animates to the new frame */
  frameKey?: string;
  refLon?: number;
  aspect?: number;
  minHeight?: number;
  ariaLabel: string;
  children?: (proj: Proj) => ReactNode;
  graticule?: boolean;
  dark?: boolean;
  corner?: ReactNode; // overlay HTML (legend etc.)
  pad?: number;
}

export default function MarsMap({ frame, frameKey, refLon, aspect = 0.52, minHeight = 300, ariaLabel, children, graticule = true, corner, pad = 0.16 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  const H = Math.max(minHeight, Math.round(W * aspect));
  const [view, setView] = useState<View | null>(null);
  const target = useRef<View | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;
  const raf = useRef(0);
  const minS = W / 360;

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const clamp = useCallback((v: View): View => {
    const s = Math.max(minS || 0.1, Math.min(60, v.s));
    const halfLat = H / 2 / s;
    const lat = halfLat >= 90 ? 0 : Math.max(-90 + halfLat, Math.min(90 - halfLat, v.lat));
    return { lon: wrap(v.lon), lat, s };
  }, [H, minS]);

  const animate = useCallback(() => {
    cancelAnimationFrame(raf.current);
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const cur = viewRef.current, t = target.current;
      if (!cur || !t) return;
      const k = 1 - Math.exp(-dt * 10);
      const next = { lon: cur.lon + wrap(t.lon - cur.lon) * k, lat: cur.lat + (t.lat - cur.lat) * k, s: cur.s * Math.pow(t.s / cur.s, k) };
      const done = Math.abs(wrap(t.lon - next.lon)) * next.s < 0.3 && Math.abs(t.lat - next.lat) * next.s < 0.3 && Math.abs(t.s / next.s - 1) < 0.002;
      const v = done ? t : next;
      viewRef.current = v; setView(v);
      if (!done) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, []);

  // initial / reframe
  const fk = frameKey ?? JSON.stringify(frame.map(p => [Math.round(p.lat), Math.round(p.lon)]));
  const lastFk = useRef('');
  useEffect(() => {
    if (!W || !frame.length) return;
    const v = clamp(boundsView(frame, W, H, pad, refLon));
    if (!viewRef.current) { viewRef.current = v; target.current = v; setView(v); lastFk.current = fk; return; }
    if (fk !== lastFk.current) { lastFk.current = fk; target.current = v; animate(); }
  }, [W, H, fk]); // eslint-disable-line react-hooks/exhaustive-deps

  // wheel zoom about the cursor (non-passive so the page doesn't scroll)
  useEffect(() => {
    const el = box.current!;
    const onWheel = (e: WheelEvent) => {
      const v = target.current ?? viewRef.current; if (!v) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const s2 = Math.max(minS, Math.min(60, v.s * Math.exp(-delta * 0.0015)));
      const gLon = v.lon + (mx - W / 2) / v.s, gLat = v.lat - (my - H / 2) / v.s;
      target.current = clamp({ lon: gLon - (mx - W / 2) / s2, lat: gLat + (my - H / 2) / s2, s: s2 });
      animate();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [W, H, minS, clamp, animate]);

  // drag to pan
  const drag = useRef<{ x: number; y: number; v: View } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button,a')) return;
    const v = viewRef.current; if (!v) return;
    cancelAnimationFrame(raf.current);
    drag.current = { x: e.clientX, y: e.clientY, v };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const v = clamp({ lon: d.v.lon - (e.clientX - d.x) / d.v.s, lat: d.v.lat + (e.clientY - d.y) / d.v.s, s: d.v.s });
    viewRef.current = v; target.current = v; setView(v);
  };
  const onUp = () => { drag.current = null; };
  const zoomBy = (f: number) => { const v = target.current ?? viewRef.current; if (!v) return; target.current = clamp({ ...v, s: v.s * f }); animate(); };
  const reset = () => { if (!W) return; target.current = clamp(boundsView(frame, W, H, pad, refLon)); animate(); };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const proj = useMemo<Proj | null>(() => {
    if (!view || !W) return null;
    const p = (lat: number, lon: number): [number, number] => [W / 2 + wrap(lon - view.lon) * view.s, H / 2 - (lat - view.lat) * view.s];
    const path = (pts: LL[], closed = false) => {
      let d = '', prev: [number, number] | null = null;
      for (const q of pts) {
        const xy = p(q.lat, q.lon);
        const jump = prev && Math.abs(xy[0] - prev[0]) > 180 * view.s;
        d += `${!prev || jump ? 'M' : 'L'}${xy[0].toFixed(1)} ${xy[1].toFixed(1)}`;
        prev = xy;
      }
      return closed ? d + 'Z' : d;
    };
    return { W, H, s: view.s, view, p, path, kmPerPx: KM_PER_DEG / view.s };
  }, [view, W, H]);

  // base image copies so the map repeats across ±180°
  const images = useMemo(() => {
    if (!proj) return [];
    const out: { x: number; y: number; w: number; h: number }[] = [];
    const w = 360 * proj.s, h = 180 * proj.s;
    const x0 = W / 2 + (-180 - proj.view.lon) * proj.s, y0 = H / 2 - (90 - proj.view.lat) * proj.s;
    for (let k = -2; k <= 2; k++) { const x = x0 + k * w; if (x + w > -10 && x < W + 10) out.push({ x, y: y0, w, h }); }
    return out;
  }, [proj, W, H]);

  // graticule: 10°/15°/30° depending on zoom
  const grat = useMemo(() => {
    if (!proj || !graticule) return null;
    const step = proj.s > 14 ? 5 : proj.s > 7 ? 10 : proj.s > 3.5 ? 15 : 30;
    const lonL = proj.view.lon - W / 2 / proj.s, lonR = proj.view.lon + W / 2 / proj.s;
    const latT = proj.view.lat + H / 2 / proj.s, latB = proj.view.lat - H / 2 / proj.s;
    const lines: ReactNode[] = [];
    for (let lo = Math.ceil(lonL / step) * step; lo <= lonR; lo += step) {
      const x = W / 2 + (lo - proj.view.lon) * proj.s, w = wrap(lo);
      lines.push(<g key={'lo' + lo}><line x1={x} x2={x} y1={0} y2={H} /><text x={x + 4} y={H - 8} className="glab">{Math.abs(w)}°{w === 0 || Math.abs(w) === 180 ? '' : w > 0 ? 'E' : 'W'}</text></g>);
    }
    for (let la = Math.ceil(Math.max(-90, latB) / step) * step; la <= Math.min(90, latT); la += step) {
      const y = H / 2 - (la - proj.view.lat) * proj.s;
      lines.push(<g key={'la' + la}><line x1={0} x2={W} y1={y} y2={y} /><text x={6} y={y - 4} className="glab">{Math.abs(la)}°{la === 0 ? '' : la > 0 ? 'N' : 'S'}</text></g>);
    }
    return lines;
  }, [proj, W, H, graticule]);

  // scale bar (horizontal distance at the view's centre latitude)
  const scale = useMemo(() => {
    if (!proj) return null;
    const kmPerPxX = (KM_PER_DEG * Math.cos((proj.view.lat * Math.PI) / 180)) / proj.s;
    const nice = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
    const km = nice.find(n => n / kmPerPxX >= 70) ?? 5000;
    return { km, px: km / kmPerPxX };
  }, [proj]);

  return (
    <div ref={box} className={st.mmap} style={{ height: W ? H : minHeight }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={() => zoomBy(1.8)}>
      {proj && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
          <rect width={W} height={H} fill="#2a1710" />
          {images.map((im, i) => <image key={i} href="/textures/mars-relief-4k.jpg" x={im.x} y={im.y} width={im.w} height={im.h} preserveAspectRatio="none" />)}
          <g className="grat">{grat}</g>
          {children?.(proj)}
        </svg>
      )}
      <div className={st.vig} aria-hidden="true" />
      {scale && (
        <div className={st.scale} aria-hidden="true">
          <span style={{ width: scale.px }} /><b>{scale.km.toLocaleString('en-US')} km</b>
        </div>
      )}
      <div className={st.ctl}>
        <button aria-label="Zoom in" onClick={() => zoomBy(1.6)}>+</button>
        <button aria-label="Zoom out" onClick={() => zoomBy(1 / 1.6)}>−</button>
        <button aria-label="Reset view" onClick={reset} style={{ fontSize: 12 }}>⤢</button>
      </div>
      {corner}
    </div>
  );
}

/* ---------------- overlay primitives (screen space) ---------------- */

const pillW = (t: string, fs: number) => t.length * fs * 0.6 + 18;

export function Pin({ proj, lat, lon, color, label, labelColor = '#0E1116', big, pulse, onClick, side = 'right' }: { proj: Proj; lat: number; lon: number; color: string; label?: string; labelColor?: string; big?: boolean; pulse?: boolean; onClick?: () => void; side?: 'right' | 'left' }) {
  const [x, y] = proj.p(lat, lon);
  if (x < -100 || x > proj.W + 100 || y < -40 || y > proj.H + 40) return null;
  const r = big ? 8 : 7, fs = 13, w = label ? pillW(label, fs) : 0;
  let sd = side;
  if (sd === 'right' && x + r + 8 + w > proj.W - 8) sd = 'left';
  else if (sd === 'left' && x - r - 8 - w < 8) sd = 'right';
  const lx = sd === 'right' ? x + r + 8 : x - r - 8 - w;
  return (
    <g style={{ cursor: onClick ? 'pointer' : undefined }} onClick={onClick}>
      {pulse && <circle cx={x} cy={y} r={r + 6} fill={color} opacity=".45" className="pulse" />}
      <circle cx={x} cy={y} r={r + 1} fill="rgba(0,0,0,.25)" transform="translate(0 1)" />
      <circle cx={x} cy={y} r={r} fill="#fff" stroke={color} strokeWidth={big ? 4 : 3.2} />
      {label && (
        <g filter="url(#pillshadow)">
          <rect x={lx} y={y - 13} width={w} height={26} rx={13} fill="#fff" />
          <text x={lx + w / 2} y={y + 4.5} textAnchor="middle" style={{ font: `600 ${fs}px var(--font)` }} fill={labelColor}>{label}</text>
        </g>
      )}
    </g>
  );
}

export function MapDefs() {
  return (
    <defs>
      <filter id="pillshadow" x="-20%" y="-40%" width="140%" height="180%"><feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="#000" floodOpacity=".28" /></filter>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
      <radialGradient id="dustcore"><stop offset="0" stopColor="#FFF1DD" stopOpacity=".95" /><stop offset=".45" stopColor="#F2C38B" stopOpacity=".5" /><stop offset="1" stopColor="#F2C38B" stopOpacity="0" /></radialGradient>
    </defs>
  );
}

/** Text with a soft dark halo — readable on any terrain. */
export function MapText({ x, y, children, size = 11, color = '#FFF1DD', anchor = 'start', mono }: { x: number; y: number; children: ReactNode; size?: number; color?: string; anchor?: 'start' | 'middle' | 'end'; mono?: boolean }) {
  return <text x={x} y={y} textAnchor={anchor} style={{ font: `${mono ? 500 : 600} ${size}px var(${mono ? '--mono' : '--font'})`, paintOrder: 'stroke' }} fill={color} stroke="rgba(30,12,6,.55)" strokeWidth={3} strokeLinejoin="round">{children}</text>;
}

export const kmPerDeg = KM_PER_DEG;
export const wrapLon = wrap;
