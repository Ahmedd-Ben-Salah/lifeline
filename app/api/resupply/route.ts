import { route } from '@/lib/server/http';
import { getWorld } from '@/lib/server/store';
import { resupply } from '@/lib/server/views';
export const dynamic = 'force-dynamic';
export const GET = route(null, async () => resupply(await getWorld()));
