/** World state — everything the app knows. Stored as one JSON document (see store.ts). */
import type { LatLon } from '@/lib/engine/geo';
import type { Resource, Stock, PowerSystem } from '@/lib/engine/resources';
import type { StormParams } from '@/lib/engine/storm';
import type { Category, PackedShip } from '@/lib/engine/packer';
import type { Zone } from '@/lib/engine/landing';

export type Role = 'OPERATOR' | 'EARTH' | 'SUPPLIER' | 'VIEWER' | 'ADMIN';
export type Kind = 'WARN' | 'NEED' | 'OFFER' | 'ACCEPT' | 'TIMEOUT' | 'ORDER' | 'FAULT' | 'INFO' | 'ASK' | 'ANSWER';

export interface Equipment { kind: string; name: string; healthPct: number; status: 'OK' | 'WATCH' | 'DOWN'; note: string }

export interface Colony {
  slug: string; name: string; lat: number; lon: number; population: number;
  agentOnline: boolean; agentLastSeenMs: number;
  stocks: Stock[]; power: PowerSystem; equipment: Equipment[];
}

export interface RoverRoute { from: string; to: string; via?: string; path: LatLon[]; km: number; etaSols: number; maxGradeDeg: number; departMs: number }
export interface Rover {
  code: string; home: string; status: 'STANDBY' | 'LOADING' | 'IN_TRANSIT' | 'OFFLINE' | 'MAINTENANCE';
  batteryPct: number; pos: LatLon; fault?: string;
  route?: RoverRoute; progress: number; // 0..1 along route
  blockedRoute?: LatLon[]; // original route a failed rover was on
}

export interface Transfer {
  code: string; from: string; to: string; cargo: Partial<Record<Resource, number>>; rover: string | null;
  status: 'REQUESTED' | 'LOADING' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED';
  requestedBy: string; reason?: string; why?: string; createdMs: number;
}

export interface Storm {
  code: string; horizon: 'TRACK' | 'WATCH' | 'OUTLOOK'; status: 'WATCHING' | 'RESPONSE' | 'PASSED';
  origin: string; target?: string; note?: string;
  params?: StormParams;          // TRACK storms: ensemble inputs
  issuedSol: number;             // mission sol when the forecast was issued
  watch?: { tauTrend: number; areaKm2: number; region: LatLon }; // WATCH storms
  runCount: number;              // how many times the ensemble was re-run (for the run id)
}

export interface ToolUse { name: string; args?: Record<string, unknown>; ref: string }

export interface Message {
  id: string; threadId: string; from: string; to?: string; kind: Kind; body: string;
  payload?: [string, string][]; tools?: ToolUse[]; signature: string;
  createdMs: number; deliverMs: number; // deliverMs > createdMs for Earth links (light delay)
  accepted?: boolean; author?: 'llm' | 'scripted' | 'human'; askedBy?: string;
  meta?: Record<string, string | number | boolean>;
}

export interface Thread { id: string; title: string; status: 'OPEN' | 'NEEDS_YOU' | 'CLOSED'; linked: Record<string, string>; messages: Message[]; createdMs: number; earth?: boolean }

export interface Approval { userEmail: string; name: string; role: Role; site: 'mars' | 'earth'; decision: 'GO' | 'CHANGES'; atMs: number; arrivesMs: number }
export interface Order {
  code: string; status: 'DRAFT' | 'AWAITING_APPROVAL' | 'SENT' | 'CONFIRMED';
  approvalsRequired: number; approvals: Approval[];
  windowDepJd: number; tofDays: number; c3: number; vinfArr: number;
  landingZone: string; demand: Partial<Record<Category, number>>; ships: PackedShip[];
  createdMs: number; sentMs?: number; reachesEarthMs?: number;
}

export interface Policy {
  version: number; publishedBy: string; publishedMs: number; note?: string;
  autonomy: Record<string, Record<string, string>>;
  thresholds: { stormProbability: number; replyTimeoutMin: number; keepOwnReserveDays: number; criticalDays: number; watchDays: number };
  charter: Record<string, boolean>;
}

export interface AutomationNode { id: string; type: string; label: string; x: number; y: number; count?: number; badge?: string; items?: string[]; expr?: string }
export interface Automation {
  id: string; name: string; version: number; status: 'LIVE' | 'OFF'; graph: { nodes: AutomationNode[]; edges: [string, string][] }; runs: Run[];
  /** user-built agents (Agent builder) */
  custom?: boolean; rule?: AgentRule; createdBy?: string; createdMs?: number;
  lastResult?: { atMs: number; text: string; fired: boolean };
}

/** Custom agent rule: WHEN all checks match, THEN do the actions (optionally after a human OK). */
export type AgentInput = 'airDays' | 'waterDays' | 'foodDays' | 'powerPct' | 'stormChance' | 'stormWithin' | 'silentMin' | 'roverDown' | 'windowDays' | 'deliveryArrives';
export interface AgentCheck { input: AgentInput; op: '<' | '>'; value: number; colony: string /* 'any' or slug */ }
export type AgentActionType = 'warn' | 'askHelp' | 'sendRover' | 'earthOrder' | 'notify';
export interface AgentAction { type: AgentActionType; resource?: 'O2' | 'WATER' | 'FOOD'; kg?: number }
export interface AgentRule {
  checks: AgentCheck[]; actions: AgentAction[]; needsOk: boolean;
  state?: { lastEvalMs?: number; active?: boolean };
  pending?: { atMs: number; colony: string; text: string; msgId?: string };
}
export interface Run { id: string; startedMs: number; status: 'RUNNING' | 'WAITING' | 'AWAITING_APPROVAL' | 'DONE' | 'FAILED'; steps: { node: string; label: string; status: 'done' | 'wait' | 'fail'; atMs: number }[] }

export interface AuditEntry { id: string; atMs: number; actor: string; action: string; target: string; data?: Record<string, unknown> }

export type ScheduledType =
  | 'msg'          // post a prepared message
  | 'timeout'      // check NEED ack, post TIMEOUT if none
  | 'accept'       // accept offer + dispatch rover
  | 'fault'        // rover r-3 fails + reroute
  | 'order'        // earth-supply drafts the order
  | 'earth-go';    // earth control's approval (demo)
export interface Scheduled { id: string; atMs: number; type: ScheduledType; data: Record<string, unknown> }

export interface World {
  version: number; scenario: string;
  resetAtMs: number; simEpochJd: number; simOffsetDays: number; solEpochMsd: number;
  colonies: Colony[]; rovers: Rover[]; transfers: Transfer[]; storms: Storm[];
  threads: Thread[]; orders: Order[]; zones: Zone[];
  policy: Policy; policyHistory: Policy[];
  automations: Automation[]; audit: AuditEntry[]; schedule: Scheduled[];
  counters: { msg: number; transfer: number; run: number; audit: number };
  actionsToday: number;
}
