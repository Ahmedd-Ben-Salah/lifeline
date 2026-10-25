import { route } from '@/lib/server/http';
import { getWorld } from '@/lib/server/store';
import { automationsView } from '@/lib/server/automations';
import { createAgent } from '@/lib/server/agentBuilder';
export const dynamic = 'force-dynamic';
export const GET = route(null, async () => automationsView(await getWorld()));
export const POST = route(null, async (s, req) => (await createAgent(s, await req.json().catch(() => ({})))).result);
