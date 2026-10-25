/** Lightweight sync endpoint: clients poll it (~1.5 s) and refetch their page when `version` changes. */
import { route } from '@/lib/server/http';
import { getWorld, storeKind } from '@/lib/server/store';
import { clockSnapshot } from '@/lib/sim';
import { llmEnabled, MODEL } from '@/lib/agents/llm';
export const dynamic = 'force-dynamic';
export const GET = route(null, async s => {
  const w = await getWorld();
  const needsYou = w.orders.filter(o => o.status === 'AWAITING_APPROVAL').length;
  const nextEvent = w.schedule[0]?.atMs ?? null;
  return { version: w.version, serverNow: Date.now(), clock: clockSnapshot(w), me: s, needsYou, threads: w.threads.length, nextEvent, store: storeKind(), agents: llmEnabled() ? `llm · ${MODEL}` : 'scripted', stormAlert: w.storms.some(x => x.horizon === 'TRACK' && x.status === 'RESPONSE') ? 1 : 0 };
});
