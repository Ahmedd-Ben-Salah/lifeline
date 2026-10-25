'use client';
/**
 * Realtime sync. One poll of /api/state every 1.5 s gives the world `version` and the server clock.
 * Pages fetch their payload with useApi(url); it refetches whenever the version changes.
 * (Polling instead of SSE: it works on any serverless host with no long-lived connections.)
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@/lib/auth/session';

export interface StateInfo {
  version: number; serverNow: number; me: Session; needsYou: number; threads: number; nextEvent: number | null;
  store: string; agents: string; stormAlert: number;
  clock: { jd: number; sol: number; solF: number; ls: number; marsYear: number; lightDelaySec: number; utc: string; lmstHQ: string };
}
interface Ctx { state: StateInfo | null; offset: number; bump: () => void }
const LiveCtx = createContext<Ctx>({ state: null, offset: 0, bump: () => {} });

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StateInfo | null>(null);
  const [offset, setOffset] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poll = useCallback(async () => {
    try {
      const t0 = Date.now();
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (r.status === 401) { window.location.href = '/login'; return; }
      const s = (await r.json()) as StateInfo;
      setOffset(s.serverNow - (t0 + Date.now()) / 2);
      setState(prev => (prev && prev.version === s.version && prev.clock.sol === s.clock.sol && prev.needsYou === s.needsYou ? { ...prev, clock: s.clock, serverNow: s.serverNow, nextEvent: s.nextEvent } : s));
    } catch { /* offline: keep last state */ }
    const fast = document.visibilityState === 'visible';
    timer.current = setTimeout(poll, fast ? 1500 : 6000);
  }, []);
  useEffect(() => { poll(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [poll]);
  const bump = useCallback(() => { if (timer.current) clearTimeout(timer.current); poll(); }, [poll]);
  return <LiveCtx.Provider value={{ state, offset, bump }}>{children}</LiveCtx.Provider>;
}

export const useLive = () => useContext(LiveCtx);
export const useMe = () => useContext(LiveCtx).state?.me ?? null;

/** Fetch a page payload; refetch when the world version changes. */
export function useApi<T>(url: string | null) {
  const { state } = useLive();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!url) return;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Request failed');
      setData(j); setError(null);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [url]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => { if (state?.version) load(); }, [state?.version, state?.clock.sol, load]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: load };
}

/** Ticking "now" in server time (for countdown rings). */
export function useNow(ms = 1000) {
  const { offset } = useLive();
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() + offset), ms); return () => clearInterval(t); }, [ms, offset]);
  return now;
}

/** POST helper with JSON + error message. */
export async function post<T = unknown>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}
