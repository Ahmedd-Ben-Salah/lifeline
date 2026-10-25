import { route } from '@/lib/server/http';
import { approveOrder } from '@/lib/server/actions';
export const POST = route('approveOrder', async (s, req, p) => {
  const { decision } = await req.json().catch(() => ({}));
  return (await approveOrder(s, p.code, decision === 'CHANGES' ? 'CHANGES' : 'GO')).result;
});
