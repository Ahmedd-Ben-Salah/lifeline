import { route } from '@/lib/server/http';
import { demoReset, demoReplay, demoFailRover, demoEarthConfirm, demoAdvance, HttpError } from '@/lib/server/actions';
export const maxDuration = 60;
export const POST = route('demo', async (s, req, p) => {
  switch (p.action) {
    case 'reset': return demoReset(s);
    case 'replay': return demoReplay(s);
    case 'fail-rover': return (await demoFailRover(s)).result;
    case 'earth-confirm': return (await demoEarthConfirm(s)).result;
    case 'advance': { const { sols } = await req.json().catch(() => ({})); return (await demoAdvance(s, Math.max(1, Math.min(10, Number(sols) || 1)))).result; }
  }
  throw new HttpError(404, 'Unknown demo action');
});
