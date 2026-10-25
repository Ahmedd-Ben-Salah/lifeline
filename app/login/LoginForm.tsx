'use client';
import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { jdFromDate, lightDelaySec, marsSubsolar } from '@/lib/engine/ephemeris';

const MarsGlobe = dynamic(() => import('@/components/globe/MarsGlobe'), { ssr: false });

const ROLES = [
  { k: 'ops', label: 'Colony ops', email: 'ayari@jezero.base' },
  { k: 'earth', label: 'Earth control', email: 'control@earth.gov' },
  { k: 'supplier', label: 'Supplier', email: 'supply@cargo.co' },
];
const SCENARIO_JD = jdFromDate(Date.UTC(2050, 10, 12, 6, 0, 0));
const COLONIES = [
  { id: 'jezero', lat: 18.44, lon: 77.45, color: '#16A34A', label: 'Jezero' },
  { id: 'arcadia', lat: 47, lon: -176, color: '#DC2626', label: 'Arcadia', pulse: true },
  { id: 'utopia', lat: 46.7, lon: 117.5, color: '#16A34A', label: 'Utopia' },
  { id: 'valles', lat: -13.9, lon: -59.2, color: '#D97706', label: 'Valles' },
];

export default function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState('ayari@jezero.base');
  const [password, setPassword] = useState('lifeline-demo');
  const [role, setRole] = useState('ops');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 1000); return () => clearInterval(t); }, []);
  const ld = lightDelaySec(SCENARIO_JD);
  // light the side of Mars the camera looks at (~140°E) so the colonies are in daylight
  const sub = useMemo(() => { let best = marsSubsolar(SCENARIO_JD); for (let h = 0; h < 25; h += 0.25) { const p = marsSubsolar(SCENARIO_JD + h / 24); if (Math.abs(((p.lon - 140 + 540) % 360) - 180) < Math.abs(((best.lon - 140 + 540) % 360) - 180)) best = p; } return best; }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || 'Sign in failed'); setBusy(false); return; }
    const next = sp.get('next');
    router.push(next && next.startsWith('/app') ? next : j.home);
    router.refresh();
  }

  return (
    <div className="auth">
      <section className="auth-left">
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit' }}>
          <Image src="/logo.svg" width={34} height={21} alt="" priority />
          <b style={{ fontSize: 16, fontWeight: 600 }}>lifeline</b>
        </Link>
        <form className="auth-form" onSubmit={submit}>
          <div>
            <h1 style={{ fontSize: 26 }}>Sign in</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>Keep the Mars colonies safe.</p>
          </div>
          <button type="button" className="btn sso" disabled title="Coming soon"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" /></svg>Sign in with Mission ID (soon)</button>
          <div className="divider">or with email</div>
          <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required /></div>
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><label htmlFor="pw">Password</label><span className="faint" style={{ fontSize: 12.5 }}>demo: lifeline-demo</span></div>
            <input id="pw" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <div className="field">
            <label id="role-l">I am</label>
            <div className="seg" role="radiogroup" aria-labelledby="role-l" style={{ width: '100%' }}>
              {ROLES.map(r => <button key={r.k} type="button" role="radio" aria-checked={role === r.k} aria-pressed={role === r.k} style={{ flex: 1 }} onClick={() => { setRole(r.k); setEmail(r.email); }}>{r.label}</button>)}
            </div>
          </div>
          {err && <div className="chip chip-crit" role="alert" style={{ alignSelf: 'flex-start' }}><span className="d" />{err}</div>}
          <button type="submit" className="btn btn-dark btn-lg" style={{ justifyContent: 'center' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="faint" style={{ fontSize: 12, margin: 0 }}>Demo: pick a role above, the password is already filled in (<span className="mono">lifeline-demo</span>). Read-only guest: jury@lumen.org.</p>
        </form>
        <div className="faint" style={{ fontSize: 12, display: 'flex', gap: 16 }}><span>© 2050 Lifeline</span><Link href="/" className="faint">Product</Link><Link href="/#how" className="faint">How it works</Link></div>
      </section>
      <section className="auth-right" aria-label="Mars, live" style={{ background: '#04060A' }}>
        <MarsGlobe background="space" pins={COLONIES} subsolar={sub} focus={{ lat: 30, lon: 140 }} zoom={0.92} hiRes />
        <div className="ring lift status-card">
          <div className="in">
            <div className="head"><b>Mars right now</b><span className="chip chip-ok" style={{ marginLeft: 'auto' }}><span className="d" />Live</span></div>
            <div className="body">
              <div className="kv"><span className="k">Message to Earth</span><span className="ln" /><span className="v">{Math.round(ld / 60)} min</span></div>
              <div className="kv"><span className="k">Colonies answering</span><span className="ln" /><span className="v">3 of 4</span></div>
              <div className="kv"><span className="k">Season</span><span className="ln" /><span className="v">dust season</span></div>
              <div className="kv"><span className="k">Dust storm</span><span className="ln" /><span className="v" style={{ color: 'var(--crit)' }}>coming</span></div>
            </div>
          </div>
        </div>
        <div style={{ position: 'absolute', right: 20, bottom: 16, fontSize: 11, color: '#8A919C' }}>Real NASA images of Mars · real day and night</div>
      </section>
    </div>
  );
}
