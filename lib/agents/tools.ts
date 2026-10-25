/**
 * Tools the agents may call. Each wraps a deterministic engine function and returns
 * JSON (what the model sees) + a short ref (the "tool chip" shown under the message).
 * Agents never compute numbers themselves — they call these.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { dateFromJd, lightDelaySec, sunEarthMarsAngleDeg, marsLs } from '@/lib/engine/ephemeris';
import { planRoute } from '@/lib/engine/router';
import { forecastStock, Resource } from '@/lib/engine/resources';
import { solarLossPct } from '@/lib/engine/storm';
import { seasonRisk, GLOBAL_STORM_YEARS } from '@/lib/engine/season';
import { simJd } from '@/lib/sim';
import { activeStorm, ensembleFor, stormSummary, colonyView, colonyDeliveries, buildOrderPlan, stormAge } from '@/lib/server/model';
import type { World } from '@/lib/server/types';

const r1 = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const COLONIES = ['jezero', 'arcadia', 'utopia', 'valles'];

export const TOOL_DEFS: Anthropic.Beta.BetaTool[] = [
  { name: 'network_status', description: 'Current status of every colony: population, reserve days per resource (stock / daily use), power %, agent online, status. Use first for general questions.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'storm_ensemble', description: 'Ensemble forecast (300 seeded runs) for the active tracked dust storm: probability per colony, arrival window in sols from now, optical depth τ, solar power loss, duration.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'resource_forecast', description: 'Monte-Carlo forecast of one colony resource over the next 60 sols (median, p10, p90, run-out sol), including the storm and scheduled rover deliveries. Optional what-if overrides: storm_duration_sols (how long dust stays over the colony) and solar_loss_pct (0-100).', input_schema: { type: 'object', properties: { colony: { type: 'string', enum: COLONIES }, resource: { type: 'string', enum: ['O2', 'WATER', 'FOOD'] }, storm_duration_sols: { type: 'number' }, solar_loss_pct: { type: 'number' } }, required: ['colony', 'resource'], additionalProperties: false } },
  { name: 'rover_route', description: 'Plan a rover route on real Mars elevation (A* on MOLA): distance km, ETA sols, max grade.', input_schema: { type: 'object', properties: { from: { type: 'string', enum: COLONIES }, to: { type: 'string', enum: COLONIES } }, required: ['from', 'to'], additionalProperties: false } },
  { name: 'fleet_status', description: 'Rovers and transfers: status, cargo, ETA, faults.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'launch_window', description: 'Next Earth→Mars launch window from a Lambert scan: departure date, days until it, C3, time of flight, arrival date; plus the planned order (ships, tonnes, landing zone).', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'light_delay', description: 'Current one-way light time Earth↔Mars and Sun–Earth–Mars angle (conjunction when < 3°).', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'season_outlook', description: 'Mars season (Ls) and climatological storm risk per colony for the coming dust season.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
];

export interface ToolOutput { json: unknown; ref: string }

export function runTool(w: World, name: string, input: Record<string, unknown>): ToolOutput {
  switch (name) {
    case 'network_status': {
      const cols = w.colonies.map(c => { const v = colonyView(w, c); return { colony: c.slug, people: c.population, status: v.status, power_pct: Math.round(v.powerPct * 100), agent: v.agentOnline ? 'online' : `silent ${v.agentSilentMin} min`, reserve_days: Object.fromEntries(v.stocks.map(s => [s.resource, Math.round(s.days)])) }; });
      return { json: { colonies: cols, thresholds: w.policy.thresholds }, ref: 'network · 4 colonies' };
    }
    case 'storm_ensemble': {
      const s = activeStorm(w); if (!s) return { json: { storm: null }, ref: 'no storm' };
      const sum = stormSummary(w, s)!; const e = ensembleFor(w, s)!; const age = stormAge(w, s);
      return { json: { storm: s.code, origin: s.origin, runs: sum.runs, seed: sum.seed, target: sum.target, probability: Math.round(sum.probability * 100) + '%', runs_reaching_target: sum.runsReached, arrival_sols_from_now: { p10: r1(sum.arrivalMin), median: r1(sum.arrivalMedian), p90: r1(sum.arrivalMax) }, tau: { p10: r1(sum.tauMin), p90: r1(sum.tauMax) }, solar_loss_pct: { p10: Math.round((sum.solarLossMin ?? 0) * 100), p90: Math.round((sum.solarLossMax ?? 0) * 100) }, storm_lifetime_sols_median: Math.round(sum.durationSols), per_colony: e.impacts.map(i => ({ colony: i.slug, probability_pct: Math.round(i.probability * 100), arrival_median_sols: i.arrivalMedian === null ? null : r1(i.arrivalMedian - age) })) }, ref: `run #${sum.runId}` };
    }
    case 'resource_forecast': {
      const slug = String(input.colony), res = String(input.resource) as Resource;
      const ci = w.colonies.findIndex(c => c.slug === slug); if (ci < 0) return { json: { error: 'unknown colony' }, ref: 'error' };
      const c = w.colonies[ci]; const st = c.stocks.find(x => x.resource === res)!;
      const s = activeStorm(w); let e = s ? ensembleFor(w, s) : null;
      const age = s ? stormAge(w, s) : 0;
      if (e) {
        const dur = input.storm_duration_sols !== undefined ? Number(input.storm_duration_sols) : null;
        const loss = input.solar_loss_pct !== undefined ? Number(input.solar_loss_pct) / 100 : null;
        e = { ...e, perRun: e.perRun.map(r => {
          const tau = loss !== null ? r.tau.map(() => 0.5 - Math.log(Math.max(0.01, 1 - loss)) / 0.313) : r.tau;
          return { arrival: r.arrival.map(a => (a === null ? null : Math.max(0, a - age))), tau, life: dur !== null ? dur / 0.6 : r.life };
        }) };
      }
      const f = forecastStock(st, c.power, ci, e, colonyDeliveries(w, slug), 60);
      const what = [input.storm_duration_sols !== undefined ? `storm ${input.storm_duration_sols} sols` : '', input.solar_loss_pct !== undefined ? `loss ${input.solar_loss_pct}%` : ''].filter(Boolean).join(', ');
      return { json: { colony: slug, resource: res, stock_kg: Math.round(st.amount), daily_use_kg: st.dailyUse, daily_make_kg_now: st.dailyMake, reserve_days_now: Math.round(st.amount / st.dailyUse), run_out_sol_with_deliveries: f.runOutSol.withPlan, run_out_sol_no_action: f.runOutSol.noAction, median_kg_at_sol: { 10: Math.round(f.median[10]), 30: Math.round(f.median[30]), 60: Math.round(f.median[60]) }, p10_kg_at_sol_30: Math.round(f.p10[30]), deliveries: colonyDeliveries(w, slug).filter(d => d.resource === res), scenario: what || 'baseline ensemble' }, ref: `forecast · ${slug} ${res}${what ? ' · ' + what : ''}` };
    }
    case 'rover_route': {
      const a = w.colonies.find(c => c.slug === input.from), b = w.colonies.find(c => c.slug === input.to);
      if (!a || !b) return { json: { error: 'unknown colony' }, ref: 'error' };
      const p = planRoute(a, b)!;
      return { json: { from: a.slug, to: b.slug, km: Math.round(p.km), eta_sols: r1(p.etaSols), max_grade_deg: r1(p.maxGradeDeg), climb_m: Math.round(p.climbM), speed: '20 km/h, 18 h per sol' }, ref: `A* · ${a.slug}→${b.slug}` };
    }
    case 'fleet_status': {
      return { json: { rovers: w.rovers.map(r => ({ rover: r.code, status: r.status, battery_pct: r.batteryPct, fault: r.fault ?? null, route: r.route ? `${r.route.from}→${r.route.to}` : null, eta_sols: r.route && r.status === 'IN_TRANSIT' ? r1((1 - r.progress) * r.route.etaSols) : null })), transfers: w.transfers.map(t => ({ code: t.code, from: t.from, to: t.to, cargo_kg: t.cargo, rover: t.rover, status: t.status })) }, ref: 'fleet · 7 rovers' };
    }
    case 'launch_window': {
      const p = buildOrderPlan(w); const jd = simJd(w);
      return { json: { departure: dateFromJd(p.win.depJd).toISOString().slice(0, 10), days_until: Math.round(p.win.depJd - jd), c3_km2_s2: r1(p.win.c3), time_of_flight_days: Math.round(p.win.tofDays), arrival: dateFromJd(p.win.arrJd).toISOString().slice(0, 10), order: { ships: p.ships.map(s => ({ ship: s.ship, tonnes: s.massT, fill_pct: Math.round(s.fillPct * 100) })), total_t: Math.round(p.ships.reduce((a, s) => a + s.massT, 0)), demand_t: p.demand, landing_zone: p.zones[0].name, landing_score: r1(p.zones[0].score) } }, ref: `Lambert · C3 ${r1(p.win.c3)}` };
    }
    case 'light_delay': {
      const jd = simJd(w); const sec = lightDelaySec(jd); const ang = sunEarthMarsAngleDeg(jd);
      return { json: { one_way_seconds: Math.round(sec), one_way: `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`, round_trip_minutes: r1(sec * 2 / 60), sun_earth_mars_angle_deg: r1(ang), conjunction: ang < 3 }, ref: `light ${Math.floor(sec / 60)}m${Math.round(sec % 60)}s` };
    }
    case 'season_outlook': {
      const ls = marsLs(simJd(w));
      return { json: { ls_deg: r1(ls), dust_season: ls >= 160 && ls <= 340, global_storm_rate: `${GLOBAL_STORM_YEARS.observed} of ${GLOBAL_STORM_YEARS.of} Mars years`, colony_season_risk_pct: Object.fromEntries(w.colonies.map(c => [c.slug, Math.round(seasonRisk(c.lat) * 100)])) }, ref: `outlook · Ls ${Math.round(ls)}°` };
    }
  }
  return { json: { error: `unknown tool ${name}` }, ref: 'error' };
}

export { solarLossPct };
