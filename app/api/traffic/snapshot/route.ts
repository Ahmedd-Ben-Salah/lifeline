import { route } from '@/lib/server/http';
import { getWorld } from '@/lib/server/store';
import { trafficSnapshot } from '@/lib/server/views';
export const dynamic = 'force-dynamic';
export const GET = route(null, async () => trafficSnapshot(await getWorld()));
