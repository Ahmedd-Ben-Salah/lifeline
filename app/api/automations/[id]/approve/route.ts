import { route } from '@/lib/server/http';
import { approveAgent } from '@/lib/server/agentBuilder';
export const POST = route(null, async (s, _r, p) => (await approveAgent(s, p.id)).result);
