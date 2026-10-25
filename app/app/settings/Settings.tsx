'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLive, post } from '@/lib/client/live';
import { PageHead, KV, Chip, Skeleton } from '@/components/ui';
import { can, Action } from '@/lib/auth/permissions';
import { minutes } from '@/lib/client/format';

const PERMS: { a: Action; label: string }[] = [
  { a: 'ask', label: 'Ask the AI questions' },
  { a: 'acceptOffer', label: 'Accept help between towns' },
  { a: 'createTransfer', label: 'Send rovers' },
  { a: 'approveOrder', label: 'Approve Earth orders' },
  { a: 'fulfilOrder', label: 'Confirm Earth orders' },
  { a: 'runForecast', label: 'Run the storm forecast again' },
  { a: 'editPolicy', label: 'Change the rules for the AI' },
  { a: 'editAutomation', label: 'Build and change automations' },
  { a: 'demo', label: 'Demo controls (press D)' },
];
type Health = { ok: boolean; mode: string; model?: string; latencyMs?: number; detail: string };

export default function Settings() {
  const { state } = useLive();
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
  const [testing, setTesting] = useState(false);
  const me = state?.me;
  async function test() {
    setTesting(true);
    try { const r = await fetch('/api/agents/health', { cache: 'no-store' }); const j = await r.json(); setHealth(r.ok ? j : { ok: false, mode: '—', detail: j.error || `HTTP ${r.status}` }); }
    catch (e) { setHealth({ ok: false, mode: '—', detail: (e as Error).message }); } finally { setTesting(false); }
  }
  async function signOut() { await post('/api/auth/logout'); router.push('/login'); router.refresh(); }
  if (!me) return <main className="page"><Skeleton h={60} /><Skeleton h={300} /></main>;
  return (
    <main className="page">
      <PageHead title="Settings" sub="Who you are, what you can do, and a quick check that everything works." actions={<button className="btn" style={{ color: 'var(--crit)' }} onClick={signOut}>Sign out</button>} />
      {state?.store === 'memory' && (
        <div className="card fade-in" role="alert" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', background: 'var(--warn-bg)', borderColor: '#F5DDB5' }}>
          <span className="dot dot-warn" style={{ marginTop: 6 }} />
          <div style={{ fontSize: 13.5, color: 'var(--warn)' }}>
            <b>Shared storage is off.</b> On Vercel, add Upstash Redis (Storage tab) or the chat and approvals may not show up.
            <div style={{ fontSize: 12.5, marginTop: 4 }}>Vercel → your project → Storage → Upstash for Redis → Create (free) → connect, then redeploy.</div>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16, alignItems: 'start' }}>
        <div className="ring lift"><div className="in">
          <div className="head"><span className="avatar">{me.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()}</span><b>{me.name}</b><span style={{ marginLeft: 'auto' }}><Chip tone="info">{({ ADMIN: 'Admin', OPERATOR: 'Operator', EARTH: 'Earth control', SUPPLIER: 'Supplier', VIEWER: 'Viewer' } as Record<string, string>)[me.role] ?? me.role}</Chip></span></div>
          <div className="body">
            <KV k="Email" v={me.email} /><KV k="Job" v={me.title} /><KV k="Where" v={me.site === 'mars' ? `Mars${me.colony ? ` · ${me.colony[0].toUpperCase() + me.colony.slice(1)}` : ''}` : 'Earth'} />
          </div>
          <div className="sect"><span className="k">{me.site === 'mars' ? 'You are on Mars. Your messages take a few minutes to reach Earth.' : 'You are on Earth. Messages from Mars take a few minutes to reach you.'}</span></div>
        </div></div>

        <section className="card" aria-label="Permissions">
          <div className="card-h"><h2>What you can do</h2></div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {PERMS.map(p => { const ok = can(me.role, p.a); return <div key={p.a} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}><span className={`dot ${ok ? 'dot-ok' : 'dot-off'}`} /><span style={{ color: ok ? 'var(--ink)' : 'var(--ink-4)' }}>{p.label}</span><span className="mono faint" style={{ marginLeft: 'auto', fontSize: 11.5 }}>{ok ? 'yes' : 'no'}</span></div>; })}
          </div>
        </section>

        <section className="card" aria-label="Workspace">
          <div className="card-h"><h2>System</h2><div className="r"><Chip tone={state?.store === 'memory' ? 'warn' : 'ok'}>{state?.store === 'memory' ? 'Check storage' : 'All good'}</Chip></div></div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <KV k="Storage" v={state?.store === 'redis' ? 'shared (Redis)' : state?.store === 'file' ? 'this computer' : state?.store === 'memory' ? 'off — not shared' : '—'} />
            <KV k="AI" v={state?.agents?.startsWith('llm') ? 'Claude' : 'automatic messages (no Claude)'} />
            <KV k="Mars day" v={state ? state.clock.sol.toLocaleString('en-US') : '—'} />
            <KV k="Message to Earth" v={state ? minutes(state.clock.lightDelaySec) : '—'} />
            <KV k="Date in the story" v={state ? new Date(state.clock.utc).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—'} />
          </div>
        </section>

        <section className="card" aria-label="Claude connection">
          <div className="card-h"><h2>Claude AI</h2><div className="r"><button className="btn btn-sm btn-dark" disabled={testing} onClick={test}>{testing ? 'Testing…' : 'Test Claude connection'}</button></div></div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            {health ? (
              <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {health.ok ? <Chip tone="ok">Claude is working · answered in {((health.latencyMs ?? 0) / 1000).toFixed(1)} s</Chip> : <Chip tone="warn">{health.mode === 'scripted' ? 'Claude is off' : 'Claude is not reachable'}</Chip>}
                <span className="muted">{health.detail}</span>
              </div>
            ) : <span className="muted">Sends one tiny test message to Claude. If Claude is off, the app still works with automatic messages.</span>}
            <div className="ring" style={{ marginTop: 4 }}><div className="in" style={{ padding: '10px 12px', fontSize: 12.5 }}>
              <b style={{ fontSize: 12.5 }}>Where is the API key?</b>
              <div className="muted" style={{ marginTop: 4 }}>Set <span className="mono">ANTHROPIC_API_KEY</span> in Vercel → Project → Settings → Environment Variables (or <span className="mono">.env.local</span> locally). Never in the browser.</div>
            </div></div>
          </div>
        </section>
      </div>
    </main>
  );
}
