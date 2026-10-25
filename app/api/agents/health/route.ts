import { route } from '@/lib/server/http';
import { healthCheck } from '@/lib/agents/llm';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export const GET = route(null, async () => healthCheck());
