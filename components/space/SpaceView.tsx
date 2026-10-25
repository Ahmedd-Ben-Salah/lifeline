'use client';
/** Space view page: a simple panel on top of the 3D scene. React never runs inside the render loop. */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useApi } from '@/lib/client/live';
import { SpaceScene, Focus, SpaceInfo, Colony } from './SpaceScene';
import s from './space.module.css';

interface Snapshot { clock: { jd: number }; window: { depJd: number; tofDays: number }; colonies: Colony[] }

const SPEEDS = [{ k: 1 / 24, label: '1 hour / s' }, { k: 1, label: '1 day / s' }, { k: 10, label: '10 days / s' }];
const FOCUS: { k: Focus; label: string }[] = [{ k: 'system', label: 'Solar system' }, { k: 'earth', label: 'Earth' }, { k: 'mars', label: 'Mars' }, { k: 'rocket', label: 'Rockets' }];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function SpaceView() {
  const { data } = useApi<Snapshot>('/api/traffic/snapshot');
  const host = useRef<HTMLDivElement>(null);
  const lbl = useRef<HTMLDivElement>(null);
  const sc = useRef<SpaceScene | null>(null);
  const started = useRef(false);
  const [info, setInfo] = useState<SpaceInfo | null>(null);
  const [load, setLoad] = useState(0);
  const [focus, setFocus] = useState<Focus>('system');
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    try {
      const scene = new SpaceScene(host.current!, lbl.current!);
      scene.onInfo = setInfo; scene.onLoad = setLoad;
      sc.current = scene;
      return () => { scene.dispose(); sc.current = null; };
    } catch { setFailed(true); }
  }, []);

  useEffect(() => {
    const scene = sc.current;
    if (!scene || !data) return;
    scene.setColonies(data.colonies);
    if (!started.current) { started.current = true; scene.jd = data.clock.jd; scene.setWindow(data.window.depJd, data.window.tofDays); }
  }, [data]);

  useEffect(() => { if (sc.current) sc.current.speed = speed; }, [speed]);
  useEffect(() => { if (sc.current) sc.current.playing = playing; }, [playing]);
  const go = (f: Focus) => { setFocus(f); sc.current?.setFocus(f); };
  const jump = (to: 'now' | 'launch' | 'arrive') => {
    const scene = sc.current; if (!scene || !data) return;
    scene.jd = to === 'now' ? data.clock.jd : to === 'launch' ? scene.depJd - 1 : scene.depJd + scene.tofDays - 3;
    if (to !== 'now') { go('rocket'); setSpeed(to === 'launch' ? 1 / 24 : 1); }
  };

  const phaseText = !info ? '' : info.phase === 'waiting' ? (Math.ceil(info.daysToLaunch) <= 1 ? 'Rockets leave Earth tomorrow' : `Rockets leave Earth in ${Math.ceil(info.daysToLaunch)} days`) : info.phase === 'flying' ? `Rockets flying · day ${Math.max(0, Math.floor(info.daysSinceLaunch))} of ${Math.round(info.tofDays)}` : 'Rockets have reached Mars';

  return (
    <div className={s.root}>
      <div ref={host} className={s.stage} aria-label="3D view of the Sun, Earth, Mars and the cargo rockets. Drag to turn, scroll to zoom." />
      <div ref={lbl} className={s.labels} aria-hidden="true" />
      {load < 1 && !failed && <div className={s.loading}><div className={s.loadBar}><i style={{ width: `${Math.round(load * 100)}%` }} /></div>Loading planets… {Math.round(load * 100)}%</div>}
      {failed && <div className={s.loading}>3D is not available on this device. <Link href="/app">Back to the dashboard</Link></div>}

      <div className={`${s.panel} ${s.top}`}>
        <Link href="/app" className={s.back} aria-label="Back to dashboard"><Image src="/logo.svg" width={28} height={18} alt="" /></Link>
        <b>Space view</b>
        <span className={s.sep} />
        <span className="mono" style={{ fontSize: 12.5 }}>{info ? fmtDate(info.dateIso) : '—'}</span>
      </div>

      <div className={`${s.panel} ${s.card}`}>
        <div className={s.cardH}>{phaseText || 'Loading…'}</div>
        <div className={s.row}><span>Earth to Mars</span><b className="mono">{info ? `${Math.round(info.earthMarsMkm)} million km` : '—'}</b></div>
        <div className={s.row}><span>A message takes</span><b className="mono">{info ? `${Math.round(info.delayMin)} min` : '—'}</b></div>
        <div className={s.row}><span>Trip time</span><b className="mono">{info ? `${Math.round(info.tofDays)} days` : '—'}</b></div>
        <div className={s.note}>Planets are drawn much bigger so you can see them. Their positions are real for this date.</div>
        <div className={s.btns}>
          <button onClick={() => jump('launch')}>Watch the launch</button>
          <button onClick={() => jump('arrive')}>Watch the arrival</button>
          <button onClick={() => jump('now')}>Back to today</button>
        </div>
      </div>

      <div className={`${s.panel} ${s.dock}`}>
        <button className={s.play} onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <svg width="14" height="14" viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" /></svg> : <svg width="14" height="14" viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z" fill="currentColor" /></svg>}
        </button>
        <div className={s.grp} role="group" aria-label="Speed">{SPEEDS.map(x => <button key={x.label} aria-pressed={speed === x.k} onClick={() => setSpeed(x.k)}>{x.label}</button>)}</div>
        <div className={s.grp} role="group" aria-label="Look at">{FOCUS.map(x => <button key={x.k} aria-pressed={focus === x.k} onClick={() => go(x.k)}>{x.label}</button>)}</div>
        <span className={s.hint}>Drag to turn · scroll to zoom</span>
      </div>
    </div>
  );
}
