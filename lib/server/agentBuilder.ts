/** Agent builder actions (create / update / delete / test / approve) — kept apart from actions.ts. */
import { mutate, getWorld } from './store';
import { HttpError, audit } from './actions';
import { cleanRule, graphFor, evaluateRule, planActions, describeRule, approvePending, runCustomAgents } from './customAgents';
import type { Session } from '@/lib/auth/session';
import type { Automation } from './types';

/** ADMIN and OPERATOR can build agents; VIEWER, EARTH and SUPPLIER can only read. */
export const canBuild = (s: Session) => s.role === 'ADMIN' || s.role === 'OPERATOR';
const need = (s: Session) => { if (!canBuild(s)) throw new HttpError(403, `Your role (${s.role}) cannot build agents.`); };

export async function createAgent(s: Session, body: { name?: string; rule?: unknown; status?: 'LIVE' | 'OFF' }) {
  need(s);
  return mutate(w => {
    const rule = cleanRule(body.rule, w.colonies.map(c => c.slug));
    if (typeof rule === 'string') throw new HttpError(400, rule);
    const name = String(body.name || '').trim().slice(0, 40) || 'My agent';
    let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
    while (w.automations.some(a => a.id === id)) id += '-2';
    const a: Automation = { id, name, version: 1, status: body.status === 'OFF' ? 'OFF' : 'LIVE', runs: [], custom: true, rule, createdBy: s.name, createdMs: Date.now(), graph: graphFor(name, rule) };
    w.automations.push(a);
    audit(w, s.email, 'agent.create', id, { sentence: describeRule(w, rule) });
    runCustomAgents(w, Date.now());
    return { id };
  });
}

export async function updateAgent(s: Session, id: string, body: { name?: string; rule?: unknown; status?: 'LIVE' | 'OFF'; positions?: Record<string, { x: number; y: number }> }) {
  return mutate(w => {
    const a = w.automations.find(x => x.id === id);
    if (!a) throw new HttpError(404, 'Agent not found');
    if (!a.custom) {
      if (s.role !== 'ADMIN') throw new HttpError(403, 'Only an admin can change built-in automations.');
    } else need(s);
    if (body.positions) a.graph.nodes.forEach(n => { const p = body.positions![n.id]; if (p) { n.x = Math.round(p.x); n.y = Math.round(p.y); } });
    if (body.status) { a.status = body.status; if (a.rule) a.rule.state = {}; }
    if (a.custom && (body.rule || body.name)) {
      const rule = body.rule ? cleanRule(body.rule, w.colonies.map(c => c.slug)) : a.rule!;
      if (typeof rule === 'string') throw new HttpError(400, rule);
      a.rule = { ...rule, state: {}, pending: undefined };
      if (body.name) a.name = String(body.name).trim().slice(0, 40) || a.name;
      a.graph = graphFor(a.name, a.rule);
    }
    a.version += 1;
    audit(w, s.email, 'agent.update', id, { status: body.status });
    runCustomAgents(w, Date.now());
    return { id };
  });
}

export async function deleteAgent(s: Session, id: string) {
  need(s);
  return mutate(w => {
    const a = w.automations.find(x => x.id === id);
    if (!a) throw new HttpError(404, 'Agent not found');
    if (!a.custom) throw new HttpError(403, 'Built-in automations cannot be deleted. Turn them off instead.');
    w.automations = w.automations.filter(x => x.id !== id);
    audit(w, s.email, 'agent.delete', id);
    return { ok: true };
  });
}

export async function testRule(rule: unknown) {
  const w = await getWorld();
  const r = cleanRule(rule, w.colonies.map(c => c.slug));
  if (typeof r === 'string') throw new HttpError(400, r);
  const ev = evaluateRule(w, r);
  return { match: ev.match, lines: ev.lines, sentence: describeRule(w, r), wouldDo: ev.match ? planActions(w, r, ev.target).map(p => p.text) : [], needsOk: r.needsOk };
}

export async function approveAgent(s: Session, id: string) {
  need(s);
  return mutate(w => {
    const text = approvePending(w, id, s.email, Date.now());
    if (text === null) throw new HttpError(409, 'This agent has nothing waiting for an OK.');
    return { done: text };
  });
}
