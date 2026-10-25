/** Automations: graphs + their latest run, derived from the agent messages that run produced. */
import { msgTime } from '@/lib/sim';
import { STORM_THREAD } from '@/lib/agents/story';
import type { World } from './types';
import { INPUTS, ACTIONS, describeRule, AGENTS_THREAD } from './customAgents';

export function automationsView(w: World) {
  const th = w.threads.find(t => t.id === STORM_THREAD);
  const now = Date.now();
  const msgs = (th?.messages ?? []).filter(m => m.createdMs <= now);
  const at = (k: string) => msgs.find(m => m.kind === k);
  const step = (node: string, label: string, kind: string, waitIfMissing = false) => {
    const m = at(kind);
    return m ? { node, label, status: 'done' as const, time: msgTime(w, m.createdMs) } : { node, label, status: waitIfMissing ? 'wait' as const : 'idle' as const, time: '' };
  };
  const order = w.orders[0];
  const stormRun = msgs.length ? {
    id: 'Storm S-17',
    status: order?.status === 'AWAITING_APPROVAL' ? 'AWAITING_APPROVAL' : order ? 'DONE' : 'RUNNING',
    steps: [
      step('weather', 'Weather AI ran 300 storm simulations', 'WARN'),
      step('impact', 'Arcadia is in danger', 'NEED'),
      step('jezero', 'Jezero AI asked Arcadia', 'NEED'),
      step('jezero', 'No reply → act alone', 'TIMEOUT'),
      step('actions', 'Utopia’s offer accepted', 'ACCEPT'),
      step('actions', 'Rover 7 re-routed', 'FAULT'),
      { ...step('actions', 'Earth order (needs your OK)', 'ORDER', true), status: order ? (order.status === 'AWAITING_APPROVAL' ? 'wait' as const : 'done' as const) : 'idle' as const },
    ],
    hot: ['sensors-weather', 'dust-weather', 'weather-impact', 'weather-tools', ...(at('NEED') ? ['impact-jezero'] : []), ...(at('ACCEPT') ? ['jezero-actions'] : [])],
  } : null;
  const builtinResult = (id: string) => id === 'storm-response' && stormRun
    ? { atMs: msgs[msgs.length - 1]?.createdMs ?? now, text: order?.status === 'AWAITING_APPROVAL' ? 'Handled storm S-17 · Earth order waiting for your OK' : 'Handled storm S-17', fired: true }
    : { atMs: now, text: 'Waiting — nothing to do', fired: false };
  return {
    automations: w.automations.map(a => ({
      ...a, custom: !!a.custom, lastRun: a.id === 'storm-response' ? stormRun : null,
      lastResult: a.custom ? a.lastResult ?? null : builtinResult(a.id),
      sentence: a.rule ? describeRule(w, a.rule) : null,
      pending: a.rule?.pending ?? null,
    })),
    catalog: { inputs: INPUTS, actions: ACTIONS },
    colonies: w.colonies.map(c => ({ slug: c.slug, name: c.name })),
    agentsThread: AGENTS_THREAD,
  };
}
