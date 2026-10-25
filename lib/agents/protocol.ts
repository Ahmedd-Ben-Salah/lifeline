/**
 * Agent message protocol. Every message is one of a small set of kinds, carries a structured
 * payload and an HMAC-SHA256 signature (body + payload, signed with AGENT_KEY) so nothing can be
 * altered after it is sent.
 */
import { createHmac } from 'crypto';
import { z } from 'zod';
import type { Kind, Message, ToolUse, World } from '@/lib/server/types';

export const KINDS = ['WARN', 'NEED', 'OFFER', 'ACCEPT', 'TIMEOUT', 'ORDER', 'FAULT', 'INFO', 'ASK', 'ANSWER'] as const;

export const MessageSchema = z.object({
  kind: z.enum(KINDS),
  from: z.string().min(1),
  to: z.string().optional(),
  body: z.string().min(1).max(600),
  payload: z.array(z.tuple([z.string(), z.string()])).optional(),
});

const key = () => process.env.AGENT_KEY || process.env.AUTH_SECRET || 'lifeline-dev-agent-key';

export function sign(body: string, payload?: [string, string][]) {
  return createHmac('sha256', key()).update(body + '\n' + JSON.stringify(payload ?? [])).digest('hex').slice(0, 16);
}
export function verify(m: Message) { return sign(m.body, m.payload) === m.signature; }

/** Agents on Earth vs Mars decide the link delay. */
export const isEarthAgent = (a?: string) => a === 'earth-control' || a === 'supplier';

export function makeMessage(w: World, threadId: string, m: {
  from: string; to?: string; kind: Kind; body: string; payload?: [string, string][]; tools?: ToolUse[];
  createdMs: number; deliverMs?: number; author?: Message['author']; accepted?: boolean; askedBy?: string; meta?: Message['meta'];
}): Message {
  w.counters.msg += 1;
  return {
    id: `m${w.counters.msg}`, threadId, from: m.from, to: m.to, kind: m.kind, body: m.body, payload: m.payload, tools: m.tools,
    signature: sign(m.body, m.payload), createdMs: m.createdMs, deliverMs: m.deliverMs ?? m.createdMs,
    author: m.author ?? 'scripted', accepted: m.accepted, askedBy: m.askedBy, meta: m.meta,
  };
}

/** Next free delivery code (skips numbers already used by seeded deliveries). */
export function nextTransferCode(w: World) {
  let code = `TR-0${w.counters.transfer}`;
  while (w.transfers.some(t => t.code === code)) { w.counters.transfer += 1; code = `TR-0${w.counters.transfer}`; }
  w.counters.transfer += 1;
  return code;
}
