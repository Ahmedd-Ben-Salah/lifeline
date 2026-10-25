import { route } from '@/lib/server/http';
import { getWorld } from '@/lib/server/store';
import { colonyView } from '@/lib/server/model';
export const dynamic = 'force-dynamic';
export const GET = route(null, async () => { const w = await getWorld(); return { colonies: w.colonies.map(c => colonyView(w, c)) }; });
