import { route } from '@/lib/server/http';
import { confirmOrder } from '@/lib/server/actions';
export const POST = route('fulfilOrder', async (s, _r, p) => (await confirmOrder(s, p.code)).result);
