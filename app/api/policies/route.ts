import { z } from 'zod';
import { route } from '@/lib/server/http';
import { getWorld } from '@/lib/server/store';
import { publishPolicy, HttpError } from '@/lib/server/actions';
export const dynamic = 'force-dynamic';
export const GET = route(null, async () => { const w = await getWorld(); return { policy: w.policy, history: w.policyHistory.slice(0, 10).map(p => ({ version: p.version, publishedBy: p.publishedBy, publishedMs: p.publishedMs, note: p.note })), audit: w.audit.filter(a => a.action.startsWith('policy')).slice(0, 10) }; });
const Body = z.object({
  autonomy: z.record(z.string(), z.record(z.string(), z.string())),
  thresholds: z.object({ stormProbability: z.number().min(0.3).max(0.95), replyTimeoutMin: z.number().min(2).max(120), keepOwnReserveDays: z.number().min(30).max(180), criticalDays: z.number().min(7).max(60), watchDays: z.number().min(14).max(120) }),
  charter: z.record(z.string(), z.boolean()),
  note: z.string().max(200).optional(),
});
export const PUT = route('editPolicy', async (s, req) => {
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, 'Policy values are out of range');
  if (b.data.thresholds.criticalDays >= b.data.thresholds.watchDays) throw new HttpError(400, 'Critical days must be lower than watch days');
  return (await publishPolicy(s, b.data)).result;
});
