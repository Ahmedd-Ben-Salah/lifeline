import { route } from '@/lib/server/http';
import { testRule } from '@/lib/server/agentBuilder';
export const dynamic = 'force-dynamic';
export const POST = route(null, async (_s, req) => { const b = await req.json().catch(() => ({})); return testRule(b.rule); });
