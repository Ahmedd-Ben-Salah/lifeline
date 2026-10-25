import { route } from '@/lib/server/http';
import { acceptOffer } from '@/lib/server/actions';
export const POST = route('acceptOffer', async (s, _r, p) => (await acceptOffer(s, p.id)).result);
