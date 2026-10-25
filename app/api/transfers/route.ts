import { z } from 'zod';
import { route } from '@/lib/server/http';
import { createTransfer, HttpError } from '@/lib/server/actions';
const Body = z.object({ from: z.string(), to: z.string(), rover: z.string(), resource: z.enum(['O2', 'WATER', 'FOOD']), kg: z.number().positive().max(3000) });
export const POST = route('createTransfer', async (s, req) => {
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, 'Check the transfer fields');
  return (await createTransfer(s, b.data)).result;
});
