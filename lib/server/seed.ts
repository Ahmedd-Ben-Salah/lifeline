/**
 * The demo world "storm-s17". All 2050 colony values are simulated; geography, orbits,
 * seasons and crew needs are real. reset() rebuilds this exact state every time.
 */
import { jdFromDate, marsSolDate, marsLs } from '@/lib/engine/ephemeris';
import { BVAD, Stock } from '@/lib/engine/resources';
import { bearing } from '@/lib/engine/geo';
import type { World, Colony, Rover, Storm, Policy, Automation, AgentRule } from './types';
import { graphFor } from './customAgents';

/** Scenario date: 12 Nov 2050 — Mars Ls ≈ 292°, peak dust season (perihelion Ls 251° just passed). */
export const SCENARIO_UTC = Date.UTC(2050, 10, 12, 6, 0, 0);
export const SCENARIO_SOL = 1284;

const stocks = (pop: number, s: { O2: [number, number]; WATER: [number, number]; FOOD: [number, number] }): Stock[] => [
  { resource: 'O2', amount: s.O2[0], unit: 'kg', dailyUse: +(BVAD.o2KgPerPerson * pop).toFixed(1), dailyMake: s.O2[1] },
  { resource: 'WATER', amount: s.WATER[0], unit: 'kg', dailyUse: +(BVAD.waterKgPerPerson * pop).toFixed(1), dailyMake: s.WATER[1] },
  { resource: 'FOOD', amount: s.FOOD[0], unit: 'kg', dailyUse: +(BVAD.foodKgPerPerson * pop).toFixed(1), dailyMake: s.FOOD[1] },
];

export function seedColonies(now: number): Colony[] {
  return [
    { slug: 'jezero', name: 'Jezero Base', lat: 18.44, lon: 77.45, population: 64, agentOnline: true, agentLastSeenMs: now,
      stocks: stocks(64, { O2: [6671, 55.0], WATER: [45760, 410], FOOD: [10714, 60] }),
      power: { solarKw: 107, nuclearKw: 60, demandKw: 136, localTau: 0.9 },
      equipment: [
        { kind: 'solar', name: 'Solar field', healthPct: 92, status: 'OK', note: 'τ 0.9 · 107 kW peak' },
        { kind: 'fission', name: 'Fission units × 6', healthPct: 100, status: 'OK', note: '10 kWe each · steady' },
        { kind: 'wrs', name: 'Water recovery', healthPct: 94, status: 'OK', note: '98% recovery' },
        { kind: 'oga', name: 'O₂ generator', healthPct: 97, status: 'OK', note: 'MOXIE-class × 4 · nominal' },
        { kind: 'comms', name: 'Relay uplink', healthPct: 100, status: 'OK', note: 'Areo relays 1–3 in view' } ] },
    { slug: 'arcadia', name: 'Arcadia Station', lat: 47.0, lon: -176.0, population: 42, agentOnline: false, agentLastSeenMs: now - 52 * 60000,
      stocks: stocks(42, { O2: [670, 21.0], WATER: [7100, 240], FOOD: [5370, 30] }),
      power: { solarKw: 40, nuclearKw: 20, demandKw: 96, localTau: 2.4 },
      equipment: [
        { kind: 'solar', name: 'Solar field', healthPct: 38, status: 'WATCH', note: 'dust τ 2.4 · output dropping' },
        { kind: 'fission', name: 'Fission units × 2', healthPct: 100, status: 'OK', note: '10 kWe each · steady' },
        { kind: 'wrs', name: 'Water recovery', healthPct: 78, status: 'OK', note: '98% recovery · membrane wear 22%' },
        { kind: 'oga', name: 'O₂ generator', healthPct: 60, status: 'WATCH', note: 'throttled to save power' },
        { kind: 'comms', name: 'Comms antenna', healthPct: 0, status: 'DOWN', note: 'no link since the storm warning' } ] },
    { slug: 'utopia', name: 'Utopia Outpost', lat: 46.7, lon: 117.5, population: 36, agentOnline: true, agentLastSeenMs: now,
      stocks: stocks(36, { O2: [3266, 31.0], WATER: [22698, 236], FOOD: [6545, 40] }),
      power: { solarKw: 86, nuclearKw: 40, demandKw: 94, localTau: 0.8 },
      equipment: [
        { kind: 'solar', name: 'Solar field', healthPct: 90, status: 'OK', note: 'τ 0.8' },
        { kind: 'fission', name: 'Fission units × 4', healthPct: 100, status: 'OK', note: '10 kWe each' },
        { kind: 'ice', name: 'Ice mine', healthPct: 88, status: 'OK', note: 'subsurface ice · 240 kg/sol' },
        { kind: 'oga', name: 'O₂ generator', healthPct: 95, status: 'OK', note: 'nominal' },
        { kind: 'comms', name: 'Relay uplink', healthPct: 100, status: 'OK', note: 'nominal' } ] },
    { slug: 'valles', name: 'Valles Hub', lat: -13.9, lon: -59.2, population: 28, agentOnline: true, agentLastSeenMs: now,
      stocks: stocks(28, { O2: [964, 22.0], WATER: [16016, 178], FOOD: [4838, 28] }),
      power: { solarKw: 62, nuclearKw: 20, demandKw: 72, localTau: 1.6 },
      equipment: [
        { kind: 'solar', name: 'Solar field', healthPct: 71, status: 'WATCH', note: 'τ 1.6 · rim dust' },
        { kind: 'fission', name: 'Fission units × 2', healthPct: 100, status: 'OK', note: '10 kWe each' },
        { kind: 'wrs', name: 'Water recovery', healthPct: 90, status: 'OK', note: '98% recovery' },
        { kind: 'oga', name: 'O₂ generator', healthPct: 84, status: 'OK', note: 'nominal' },
        { kind: 'comms', name: 'Relay uplink', healthPct: 100, status: 'OK', note: 'nominal' } ] },
  ];
}

export function seedRovers(cols: Colony[]): Rover[] {
  const at = (slug: string) => { const c = cols.find(x => x.slug === slug)!; return { lat: c.lat, lon: c.lon }; };
  return [
    { code: 'r-1', home: 'jezero', status: 'STANDBY', batteryPct: 96, pos: at('jezero'), progress: 0 },
    { code: 'r-2', home: 'jezero', status: 'LOADING', batteryPct: 88, pos: at('jezero'), progress: 0 },
    { code: 'r-3', home: 'utopia', status: 'IN_TRANSIT', batteryPct: 41, pos: at('utopia'), progress: 0 },
    { code: 'r-4', home: 'valles', status: 'IN_TRANSIT', batteryPct: 54, pos: at('jezero'), progress: 0 },
    { code: 'r-5', home: 'utopia', status: 'STANDBY', batteryPct: 91, pos: at('utopia'), progress: 0 },
    { code: 'r-6', home: 'jezero', status: 'MAINTENANCE', batteryPct: 0, pos: at('jezero'), progress: 0, fault: 'wheel actuator swap' },
    { code: 'r-7', home: 'utopia', status: 'STANDBY', batteryPct: 82, pos: at('utopia'), progress: 0 },
  ];
}

export function seedStorms(cols: Colony[], issuedSol: number): Storm[] {
  const hellas = { lat: -42, lon: 70 };
  const arc = cols.find(c => c.slug === 'arcadia')!;
  return [
    { code: 'S-17', horizon: 'TRACK', status: 'WATCHING', origin: 'Hellas', target: 'arcadia', issuedSol, runCount: 0,
      params: { code: 'S-17', origin: hellas, originName: 'Hellas', meanBearingDeg: bearing(hellas, arc), bearingSpreadDeg: 19, medianSpeedKmSol: 680, speedSigma: 0.22,
        meanLifetimeSols: 40, radius0Km: 350, growthKmSol: 50, maxRadiusKm: 1100, tauCore: 9.5, tauNow: 2.4, tauBefore: 0.9, seed: 4412 } },
    { code: 'W-04', horizon: 'WATCH', status: 'WATCHING', origin: 'Valles rim', target: 'valles', issuedSol, runCount: 0,
      watch: { tauTrend: 0.06, areaKm2: 220000, region: { lat: -10, lon: -66 } } },
    { code: 'W-05', horizon: 'WATCH', status: 'WATCHING', origin: 'Acidalia front', target: 'jezero', issuedSol, runCount: 0,
      watch: { tauTrend: 0.02, areaKm2: 140000, region: { lat: 48, lon: -30 } } },
    { code: 'O-MY52', horizon: 'OUTLOOK', status: 'WATCHING', origin: 'Global', issuedSol, runCount: 0, note: 'Next dust season, Mars Year 52 — peak near perihelion (Ls ≈ 251°)' },
  ];
}

export const seedPolicy = (now: number): Policy => ({
  version: 4, publishedBy: 'Ayari', publishedMs: now - 6 * 86400000, note: 'Raised reply timeout to 20 min after the sol-1271 relay outage',
  autonomy: {
    warn: { normal: 'AUTO', delay: 'AUTO', blackout: 'AUTO' },
    requestOffers: { normal: 'AUTO', delay: 'AUTO', blackout: 'AUTO' },
    acceptOffer: { normal: 'NOTIFY', delay: 'NOTIFY', blackout: 'AUTO', max: '2 t' },
    dispatchRover: { normal: 'NOTIFY', delay: 'AUTO', blackout: 'AUTO', max: '3 rovers' },
    changeRations: { normal: 'GO', delay: 'GO', blackout: 'NOTIFY', max: '−25%' },
    earthOrder: { normal: 'GO', delay: 'GO', blackout: 'GO', approvers: '2' },
  },
  thresholds: { stormProbability: 0.7, replyTimeoutMin: 20, keepOwnReserveDays: 90, criticalDays: 30, watchDays: 60 },
  charter: { equalBaseline: true, medicalFirst: true, survivalMinimum: true, agentsUseEngineNumbersOnly: true, volunteerPowerShifts: false },
});

const VALLES_RULE: AgentRule = { checks: [{ input: 'airDays', op: '<', value: 45, colony: 'valles' }], actions: [{ type: 'askHelp' }, { type: 'notify' }], needsOk: false };
export const seedAutomations = (): Automation[] => [
  { id: 'valles-air-guard', name: 'Valles air guard', version: 1, status: 'LIVE', runs: [], custom: true, createdBy: 'Ayari',
    rule: VALLES_RULE, graph: graphFor('Valles air guard', VALLES_RULE) },
  { id: 'storm-response', name: 'Storm response', version: 12, status: 'LIVE', runs: [],
    graph: {
      nodes: [
        { id: 'sensors', type: 'source', label: 'Colony sensors', count: 4, x: 20, y: 40 },
        { id: 'dust', type: 'source', label: 'Orbiter dust maps', count: 1, x: 20, y: 124 },
        { id: 'fleet', type: 'source', label: 'Rover fleet', count: 7, x: 20, y: 208 },
        { id: 'climate', type: 'source', label: 'Past storms', badge: '14 years', x: 20, y: 292 },
        { id: 'weather', type: 'agent', label: 'Weather AI', x: 290, y: 40 },
        { id: 'tools', type: 'tools', label: 'Tools', items: ['Storm simulator', 'Supply forecast', 'Rover route planner', 'Launch date finder', 'Rocket packer'], x: 290, y: 330 },
        { id: 'impact', type: 'condition', label: 'Is a colony in danger?', expr: 'Storm chance over 70%, arriving within 15 days, and less than 30 days of supplies', x: 620, y: 40 },
        { id: 'jezero', type: 'agent', label: 'Jezero AI', x: 620, y: 260 },
        { id: 'actions', type: 'actions', label: 'Actions', items: ['OFFER_REQ → Ask Utopia and Valles', 'ROUTE → Rover 7 picks up Rover 3’s cargo', 'ORDER → Earth order (needs your OK)', 'NOTIFY → Tell Earth'], x: 910, y: 40 } ],
      edges: [['sensors', 'weather'], ['dust', 'weather'], ['fleet', 'weather'], ['climate', 'weather'], ['weather', 'impact'], ['weather', 'tools'], ['impact', 'jezero'], ['jezero', 'actions']],
    } },
  { id: 'low-stock', name: 'Low stock watch', version: 5, status: 'LIVE', runs: [],
    graph: {
      nodes: [
        { id: 'stocks', type: 'source', label: 'Supply levels', count: 12, x: 20, y: 60 },
        { id: 'model', type: 'tools', label: 'Tools', items: ['Supply forecast'], x: 290, y: 60 },
        { id: 'cond', type: 'condition', label: 'Running low?', expr: 'Less than 60 days of air, water or food', x: 620, y: 60 },
        { id: 'actions', type: 'actions', label: 'Actions', items: ['NEED → Ask the network for help', 'NOTIFY → Tell the operators'], x: 910, y: 60 } ],
      edges: [['stocks', 'model'], ['model', 'cond'], ['cond', 'actions']],
    } },
  { id: 'earth-window', name: 'Earth window planner', version: 3, status: 'LIVE', runs: [],
    graph: {
      nodes: [
        { id: 'outlook', type: 'source', label: 'Next dust season', count: 1, x: 20, y: 60 },
        { id: 'earth', type: 'agent', label: 'Earth supply AI', x: 290, y: 60 },
        { id: 'tools', type: 'tools', label: 'Tools', items: ['Launch date finder', 'Best launch dates', 'Rocket packer', 'Landing spot picker'], x: 290, y: 250 },
        { id: 'go', type: 'condition', label: 'Did 2 people say OK?', expr: '2 people must approve', x: 620, y: 60 },
        { id: 'actions', type: 'actions', label: 'Actions', items: ['ORDER → Send the order to Earth'], x: 910, y: 60 } ],
      edges: [['outlook', 'earth'], ['earth', 'tools'], ['earth', 'go'], ['go', 'actions']],
    } },
];

export const seedZones = () => [
  { name: 'arcadia-south', lat: 45.0, lon: -178.5, slopeDeg: 2, quakeRisk: 0.1, distanceKm: 38, dustTau: 2 },
  { name: 'utopia-east', lat: 45.5, lon: 121.0, slopeDeg: 3, quakeRisk: 0.15, distanceKm: 1240, dustTau: 2 },
  { name: 'jezero-delta', lat: 18.5, lon: 77.6, slopeDeg: 6, quakeRisk: 0.4, distanceKm: 2300, dustTau: 3 },
];

/** A fresh world (no story events yet — story.ts plays them, instantly for reset or live for the demo). */
export function baseWorld(now: number): World {
  const epochJd = jdFromDate(SCENARIO_UTC);
  const cols = seedColonies(now);
  return {
    version: 1, scenario: 'storm-s17', resetAtMs: now, simEpochJd: epochJd, simOffsetDays: 0,
    solEpochMsd: marsSolDate(epochJd) - SCENARIO_SOL - 0.38, // sol 1284, ~09:10 LMST at Jezero at reset
    colonies: cols, rovers: seedRovers(cols), transfers: [], storms: seedStorms(cols, SCENARIO_SOL),
    threads: [], orders: [], zones: seedZones(),
    policy: seedPolicy(now), policyHistory: [],
    automations: seedAutomations(), audit: [], schedule: [],
    counters: { msg: 0, transfer: 921, run: 4400, audit: 0 },
    actionsToday: 0,
  };
}

export const scenarioLs = () => marsLs(jdFromDate(SCENARIO_UTC));
