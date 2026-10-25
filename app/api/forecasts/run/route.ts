import { route } from '@/lib/server/http';
import { rerunForecast } from '@/lib/server/actions';
export const POST = route('runForecast', async s => (await rerunForecast(s)).result);
