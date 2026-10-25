/** Building and resetting the demo world. */
import { planRoute, KM_PER_SOL } from '@/lib/engine/router';
import { watchProbability } from '@/lib/engine/season';
import { marsLs } from '@/lib/engine/ephemeris';
import { baseWorld } from './seed';
import { scheduleStory, tick, STORM_THREAD } from '@/lib/agents/story';
import { makeMessage } from '@/lib/agents/protocol';
import { earthDelayMs, nextWindow } from './model';
import { dateFromJd } from '@/lib/engine/ephemeris';
import type { World } from './types';

const col = (w: World, s: string) => w.colonies.find(c => c.slug === s)!;

/** Rover routes and transfers that already exist when the story starts. */
function seedLogistics(w: World, now: number) {
  const r = (code: string) => w.rovers.find(x => x.code === code)!;
  // r-3: carrying 900 kg water Utopia → Arcadia on the direct route (it will fail in the story)
  const direct = planRoute(col(w, 'utopia'), col(w, 'arcadia'))!;
  Object.assign(r('r-3'), { status: 'IN_TRANSIT', progress: 0.42, route: { from: 'utopia', to: 'arcadia', path: direct.path, km: direct.km, etaSols: direct.etaSols, maxGradeDeg: direct.maxGradeDeg, departMs: now - 3 * 86400000 } });
  w.transfers.push({ code: 'TR-0918', from: 'utopia', to: 'arcadia', cargo: { WATER: 900 }, rover: 'r-3', status: 'IN_TRANSIT', requestedBy: 'utopia-agent', reason: 'Routine resupply', createdMs: now - 3 * 86400000 });
  // r-4: O₂ Jezero → Valles, 3.1 sols out
  const jv = planRoute(col(w, 'jezero'), col(w, 'valles'))!;
  Object.assign(r('r-4'), { status: 'IN_TRANSIT', progress: 1 - (3.1 * KM_PER_SOL) / jv.km, route: { from: 'jezero', to: 'valles', path: jv.path, km: jv.km, etaSols: jv.etaSols, maxGradeDeg: jv.maxGradeDeg, departMs: now - 20 * 86400000 } });
  w.transfers.push({ code: 'TR-0915', from: 'jezero', to: 'valles', cargo: { O2: 220 }, rover: 'r-4', status: 'IN_TRANSIT', requestedBy: 'valles-agent', reason: 'O₂ generator below target', createdMs: now - 20 * 86400000 });
  // r-2: loading at Jezero to backfill Utopia's water after its offer
  const ju = planRoute(col(w, 'jezero'), col(w, 'utopia'))!;
  Object.assign(r('r-2'), { status: 'LOADING', progress: 0, route: { from: 'jezero', to: 'utopia', path: ju.path, km: ju.km, etaSols: ju.etaSols, maxGradeDeg: ju.maxGradeDeg, departMs: now } });
  w.transfers.push({ code: 'TR-0922', from: 'jezero', to: 'utopia', cargo: { WATER: 400 }, rover: 'r-2', status: 'LOADING', requestedBy: 'jezero-agent', reason: 'Backfill Utopia after its offer to Arcadia', createdMs: now - 60000 });
}

/** Two quieter threads so Comms looks like a real network. */
function seedOtherThreads(w: World, now: number) {
  const ls = marsLs(w.simEpochJd);
  const w04 = w.storms.find(s => s.code === 'W-04')!;
  const p = watchProbability(w04.watch!.tauTrend, w04.watch!.areaKm2, ls);
  const t1 = { id: 'watch-w04', title: 'Dust watch near Valles', status: 'OPEN' as const, linked: { storm: 'W-04' }, messages: [] as World['threads'][0]['messages'], createdMs: now - 5 * 3600000 };
  t1.messages.push(makeMessage(w, t1.id, { from: 'weather-agent', to: 'valles-agent', kind: 'INFO', createdMs: now - 5 * 3600000, deliverMs: now - 5 * 3600000 + 2000,
    body: `Dust is building up near Valles. There is a ${Math.round(p * 100)}% chance it becomes a big storm in the next two weeks.`,
    payload: [['Dust', 'getting thicker'], ['Size', `${(w04.watch!.areaKm2 / 1000).toFixed(0)},000 km²`], ['Season', ls >= 160 && ls <= 340 ? 'dust season' : 'calm season']],
    tools: [{ name: 'watch_model', ref: `p ${p.toFixed(2)}` }] }));
  t1.messages.push(makeMessage(w, t1.id, { from: 'valles-agent', to: 'weather-agent', kind: 'INFO', createdMs: now - 4.6 * 3600000, deliverMs: now - 4.6 * 3600000 + 2000,
    body: 'Thanks. Our solar panels work at 71%. Rover 4 is still bringing us air. Nothing else is needed yet.' }));
  const win = nextWindow(w);
  const t2 = { id: 'earth-channel', title: 'Talking with Earth', status: 'OPEN' as const, earth: true, linked: { window: dateFromJd(win.depJd).toISOString().slice(0, 10) }, messages: [] as World['threads'][0]['messages'], createdMs: now - 26 * 3600000 };
  const d = earthDelayMs(w, now - 26 * 3600000) / Number(process.env.DEMO_DELAY_SCALE ?? 0.1);
  t2.messages.push(makeMessage(w, t2.id, { from: 'earth-control', to: 'earth-supply-agent', kind: 'INFO', createdMs: now - 26 * 3600000, deliverMs: now - 26 * 3600000 + d,
    body: `There is room on the ${dateFromJd(win.depJd).getUTCFullYear()} rockets for your supplies. Send your order once two people approve it.`,
    payload: [['Rockets leave', dateFromJd(win.depJd).toISOString().slice(0, 10)], ['Space', 'up to 3 rockets · 100 t each']], author: 'human' }));
  w.threads.push(t1, t2);
}

export function resetWorld(now: number): World {
  const w = baseWorld(now);
  seedLogistics(w, now);
  // the S-17 response started 50 minutes ago; the Earth report is still in flight
  scheduleStory(w, now - 50 * 60000, false);
  const rep = w.schedule.find(e => (e.data as { step?: string }).step === 'report');
  if (rep) rep.atMs = now - 4000;
  w.schedule.sort((a, b) => a.atMs - b.atMs);
  tick(w, now);
  seedOtherThreads(w, now);
  // the r-7 convoy has been driving since the fault
  const r7 = w.rovers.find(r => r.code === 'r-7')!;
  if (r7.route) r7.progress = Math.min(0.9, ((now - r7.route.departMs) / 86400000 / 1.0275) * KM_PER_SOL / r7.route.km);
  w.actionsToday = 14;
  w.audit.push({ id: 'a0', atMs: now, actor: 'system', action: 'reset', target: 'world' });
  return w;
}

/** Live replay of the storm response for the demo ("Inject storm"). */
export function prepareLiveReplay(w: World, now: number) {
  const fresh = baseWorld(now);
  seedLogistics(fresh, now);
  // keep users' approvals history clean, keep policy edits
  fresh.policy = w.policy; fresh.policyHistory = w.policyHistory; fresh.automations = w.automations;
  fresh.counters = { ...fresh.counters, msg: w.counters.msg + 1, audit: w.counters.audit };
  seedOtherThreads(fresh, now);
  return fresh;
}

export { STORM_THREAD };
