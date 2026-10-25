/** Extra payload for the Comms screen: who is online, order states and link delay. */
import { lightDelaySec } from '@/lib/engine/ephemeris';
import { simJd } from '@/lib/sim';
import type { World } from './types';

export function agentStatuses(w: World) {
  const now = Date.now();
  const delay = lightDelaySec(simJd(w));
  const out: Record<string, { state: 'online' | 'silent' | 'delay'; label: string }> = {
    'weather-agent': { state: 'online', label: 'online' },
    'logistics-agent': { state: 'online', label: 'online' },
    'earth-supply-agent': { state: 'delay', label: `delay ${Math.round(delay / 60)}m` },
    'earth-control': { state: 'delay', label: `delay ${Math.round(delay / 60)}m` },
    supplier: { state: 'delay', label: `delay ${Math.round(delay / 60)}m` },
  };
  for (const c of w.colonies) {
    out[`${c.slug}-agent`] = c.agentOnline ? { state: 'online', label: 'online' } : { state: 'silent', label: `silent ${Math.max(1, Math.round((now - c.agentLastSeenMs) / 60000))}m` };
  }
  return out;
}

export function orderStates(w: World) {
  return w.orders.map(o => ({ code: o.code, status: o.status, approvalsRequired: o.approvalsRequired, approvedBy: o.approvals.map(a => a.userEmail) }));
}

export const lightDelay = (w: World) => lightDelaySec(simJd(w));
