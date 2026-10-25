import { route } from '@/lib/server/http';
import { getWorld } from '@/lib/server/store';
import { threadView } from '@/lib/server/views';
import { agentStatuses, orderStates, lightDelay } from '@/lib/server/views-extra';
export const dynamic = 'force-dynamic';
export const GET = route(null, async s => {
  const w = await getWorld();
  return { threads: w.threads.map(t => threadView(w, t, s)), agents: agentStatuses(w), orders: orderStates(w), lightDelaySec: lightDelay(w), serverNow: Date.now() };
});
