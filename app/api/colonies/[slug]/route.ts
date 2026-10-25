import { route } from '@/lib/server/http';
import { getWorld } from '@/lib/server/store';
import { colonyDetail } from '@/lib/server/views';
import { HttpError } from '@/lib/server/actions';
import type { Resource } from '@/lib/engine/resources';
export const dynamic = 'force-dynamic';
export const GET = route(null, async (_s, req, p) => {
  const res = (new URL(req.url).searchParams.get('resource') || 'O2').toUpperCase() as Resource;
  const d = colonyDetail(await getWorld(), p.slug, ['O2', 'WATER', 'FOOD'].includes(res) ? res : 'O2');
  if (!d) throw new HttpError(404, 'Colony not found');
  return d;
});
