import { route } from '@/lib/server/http';
import { updateAgent, deleteAgent } from '@/lib/server/agentBuilder';
export const PUT = route(null, async (s, req, p) => (await updateAgent(s, p.id, await req.json().catch(() => ({})))).result);
export const DELETE = route(null, async (s, _r, p) => (await deleteAgent(s, p.id)).result);
