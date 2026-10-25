import { route } from '@/lib/server/http';
import { getWorld } from '@/lib/server/store';
export const dynamic = 'force-dynamic';
export const GET = route(null, async () => ({ audit: (await getWorld()).audit.slice(0, 100) }));
