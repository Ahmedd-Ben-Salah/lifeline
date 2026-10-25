import { route } from '@/lib/server/http';
import { getWorld } from '@/lib/server/store';
import { overview } from '@/lib/server/views';
export const dynamic = 'force-dynamic';
export const GET = route(null, async s => overview(await getWorld(), s));
