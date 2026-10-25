/** Order settlement: an order is SENT once enough GO approvals have physically reached Earth. */
import { makeMessage } from '@/lib/agents/protocol';
import { earthDelayMs } from './model';
import type { World } from './types';

/** Called from tick(): settle orders whose approvals have arrived. */
export function settleOrders(w: World, now: number) {
  let changed = false;
  for (const o of w.orders) {
    if (o.status !== 'AWAITING_APPROVAL') continue;
    const effective = o.approvals.filter(a => a.decision === 'GO' && a.arrivesMs <= now).length;
    if (effective >= o.approvalsRequired) {
      o.status = 'SENT'; o.sentMs = now; changed = true;
      const th = w.threads.find(t => t.linked.order === o.code);
      if (th) { th.status = 'OPEN'; th.messages.push(makeMessage(w, th.id, { from: 'earth-control', to: 'earth-supply-agent', kind: 'ACCEPT', body: `Both approvals reached Earth. The order is sent, and the rockets will be loaded for the ${new Date((o.windowDepJd - 2440587.5) * 86400000).getUTCFullYear()} launch.`, createdMs: now, deliverMs: now + earthDelayMs(w, now), author: 'scripted', payload: [['Rockets', o.ships.map(s => `${s.ship} ${s.massT} t`).join(' · ')], ['Status', 'Sent']] })); }
    }
  }
  return changed;
}

