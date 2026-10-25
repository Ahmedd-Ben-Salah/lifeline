import { route } from '@/lib/server/http';
import { ask, HttpError } from '@/lib/server/actions';
export const maxDuration = 60;
export const POST = route('ask', async (s, req, p) => {
  const { question } = await req.json().catch(() => ({}));
  const q = String(question || '').trim().slice(0, 500);
  if (!q) throw new HttpError(400, 'Type a question first');
  return ask(s, p.id, q);
});
