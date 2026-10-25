/**
 * LLM layer (Anthropic Messages API with tool use).
 *
 * Golden rule: agents reason and talk; tools calculate. Two guards enforce it:
 *  1. every number in the reply must appear in a tool result (or the question) — else we fall back;
 *  2. timeouts (8 s for protocol messages, 25 s for questions) — else we fall back.
 * Fallback = scripted wording over the same tool outputs. The demo never breaks.
 */
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_DEFS, runTool } from './tools';
import type { World, ToolUse } from '@/lib/server/types';

/** Read an env var tolerantly: trims spaces and stray quotes pasted with the value. */
const env = (k: string) => (process.env[k] ?? '').trim().replace(/^['"]+|['"]+$/g, '').trim();
const API_KEY = () => env('ANTHROPIC_API_KEY');
export const MODEL = env('ANTHROPIC_MODEL') || 'claude-opus-5-5';
export const llmEnabled = () => (env('AGENTS_MODE') || 'llm').toLowerCase() !== 'scripted' && !!API_KEY();

let client: Anthropic | null = null;
// baseURL pinned so a stray ANTHROPIC_BASE_URL on the machine can't redirect the calls
const anthropic = () => (client ??= new Anthropic({ apiKey: API_KEY(), baseURL: 'https://api.anthropic.com', maxRetries: 1 }));

/**
 * messages.create with server-side refusal fallback (beta). If the account rejects the beta,
 * retry once without it and remember that for the rest of the process.
 */
let fallbackOk = true;
type CreateParams = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'betas' | 'fallbacks'>;
export async function createMessage(params: CreateParams): Promise<Anthropic.Beta.BetaMessage> {
  if (fallbackOk) {
    try {
      return await anthropic().beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message)) { fallbackOk = false; console.warn('[agents] fallback beta not available, continuing without it'); }
      else throw e;
    }
  }
  return anthropic().beta.messages.create(params);
}

function logError(where: string, e: unknown) {
  if (e instanceof Anthropic.AuthenticationError) console.error(`[agents] ${where}: invalid ANTHROPIC_API_KEY`);
  else if (e instanceof Anthropic.RateLimitError) console.error(`[agents] ${where}: rate limited`);
  else if (e instanceof Anthropic.APIError) console.error(`[agents] ${where}: API ${e.status} ${e.message}`);
  else console.error(`[agents] ${where}:`, (e as Error)?.message ?? e);
}

/** Small live call used by Settings → "Test Claude connection". */
export async function healthCheck() {
  if (!API_KEY()) return { ok: false, mode: 'scripted', detail: 'ANTHROPIC_API_KEY is not set — agents use scripted wording.' };
  if (!llmEnabled()) return { ok: false, mode: 'scripted', detail: 'AGENTS_MODE=scripted — set it to llm to use Claude.' };
  const t0 = Date.now();
  try {
    const r = await withTimeout(createMessage({ model: MODEL, max_tokens: 400, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with exactly: Lifeline agents online.' }] }), 20000);
    const text = r.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join(' ');
    return { ok: true, mode: 'llm', model: r.model, latencyMs: Date.now() - t0, detail: text.trim(), usage: r.usage };
  } catch (e) {
    logError('health', e);
    return { ok: false, mode: 'llm', detail: e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : (e as Error).message };
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** Numbers in a text, normalised ("1,370" → 1370, "−85%" → 85). */
export function numbersIn(text: string): number[] {
  return (text.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(\.\d+)?/g) || []).map(Number);
}
/**
 * Every number in `answer` must be supported by the evidence (tools/facts/question).
 * Tolerant on purpose: rounding to an integer or 1 decimal is fine, a 0..1 probability may be quoted
 * as a percent (0.78 → 78), and small counts (≤ 31: days, people, rockets…) are allowed.
 */
export function ungroundedNumbers(answer: string, evidence: string): number[] {
  const ev = new Set<number>();
  for (const n of numbersIn(evidence)) {
    [n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100].forEach(x => ev.add(x));
    if (n > 0 && n <= 1) { ev.add(Math.round(n * 100)); ev.add(Math.round(n * 1000) / 10); }
    if (n >= 1 && n <= 100) ev.add(Math.round(n) / 100);
  }
  return numbersIn(answer).filter(n => !((n <= 31 && Number.isInteger(n)) || ev.has(n) || ev.has(Math.round(n)) || ev.has(Math.round(n * 10) / 10)));
}
export function numbersGrounded(answer: string, evidence: string) {
  return ungroundedNumbers(answer, evidence).length === 0;
}

const SYSTEM_BASE = `You are an AI helper in Lifeline, the app that keeps four Mars towns supplied in 2050 (Jezero, Arcadia, Utopia and Valles).
Explain things like you are talking to a 12-year-old: short, simple sentences, everyday words, no jargon. Say "days" (not sols), "air" or "oxygen" (not O2), and percent (78%, not 0.78).
You may only use numbers that appear in tool results or facts in this conversation. Never guess a number; if you need one, call a tool.
Never approve Earth orders or change food and water rations: people must say yes to those.`;

/** Write the body of one protocol message from engine facts (used for the live storm replay). */
export async function writeProtocolMessage(agent: string, kind: string, facts: Record<string, string | number>, fallback: string): Promise<{ body: string; author: 'llm' | 'scripted' }> {
  if (!llmEnabled()) return { body: fallback, author: 'scripted' };
  try {
    const res = await withTimeout(createMessage({
      model: MODEL, max_tokens: 1200,
      output_config: { effort: 'low' },
      system: SYSTEM_BASE + `\nYou are ${agent}. Write exactly one ${kind} message for the team chat: 1–2 short sentences, under 40 words, no greeting, no markdown, no quotes.`,
      messages: [{ role: 'user', content: `Facts from engine tools (use only these numbers):\n${JSON.stringify(facts)}\n\nReference wording (you may rephrase, keep it as clear):\n${fallback}\n\nWrite the message body only.` }],
    }), 9000);
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join(' ').trim();
    if (res.stop_reason === 'refusal' || !text || text.length > 500) return { body: fallback, author: 'scripted' };
    const bad = ungroundedNumbers(text, JSON.stringify(facts) + ' ' + fallback);
    if (bad.length) { console.warn(`[agents] ${kind}: ungrounded numbers ${bad.join(', ')} → template`); return { body: fallback, author: 'scripted' }; }
    return { body: text, author: 'llm' };
  } catch (e) {
    logError(`message ${kind}`, e);
    return { body: fallback, author: 'scripted' };
  }
}

export interface AskResult { body: string; tools: ToolUse[]; author: 'llm' | 'scripted'; payload?: [string, string][] }

/** Operator question → agent answer with real tool calls (manual tool-use loop). */
export async function askAgents(w: World, question: string, agent = 'jezero-agent'): Promise<AskResult> {
  const used: ToolUse[] = [];
  const evidence: string[] = [question];
  const exec = (name: string, input: Record<string, unknown>) => {
    const out = runTool(w, name, input);
    used.push({ name, args: input, ref: out.ref });
    const s = JSON.stringify(out.json);
    evidence.push(s);
    return s;
  };

  if (llmEnabled()) {
    try {
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: question }];
      const deadline = Date.now() + 40000;
      let retried = false;
      for (let i = 0; i < 7; i++) {
        const res = await withTimeout(createMessage({
          model: MODEL, max_tokens: 4000,
          output_config: { effort: 'low' },
          system: [{ type: 'text', text: SYSTEM_BASE + `\nYou are ${agent}, answering a person in the team chat. Call the tools you need (in parallel when they don't depend on each other), then answer in at most 3 short sentences, plain text, no markdown, no lists. End with one simple next step.`, cache_control: { type: 'ephemeral' } }],
          tools: TOOL_DEFS, messages,
        }), Math.max(3000, deadline - Date.now()));
        if (res.stop_reason === 'refusal') break;
        messages.push({ role: 'assistant', content: res.content });
        const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (res.stop_reason === 'tool_use' && calls.length) {
          messages.push({ role: 'user', content: calls.map(c => ({ type: 'tool_result' as const, tool_use_id: c.id, content: exec(c.name, (c.input ?? {}) as Record<string, unknown>) })) });
          continue;
        }
        const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join(' ').trim();
        if (!text) break;
        const bad = ungroundedNumbers(text, evidence.join(' '));
        if (!bad.length) return { body: text, tools: used, author: 'llm' };
        if (retried) { console.warn('[agents] ask: numbers not found in tool results after retry:', bad.join(', ')); break; }
        retried = true;
        messages.push({ role: 'user', content: `These numbers are not in any tool result: ${bad.join(', ')}. Rewrite the answer using only numbers from the tool results (call a tool if you need another number). Keep it to 3 short, simple sentences.` });
      }
    } catch (e) { logError('ask', e); /* fall through to the scripted answer */ }
  }
  return scriptedAnswer(w, question, exec, used);
}

/** Keyword-routed answer using the same tools (plain words, same numbers). */
function scriptedAnswer(w: World, q: string, exec: (n: string, i: Record<string, unknown>) => string, used: ToolUse[]): AskResult {
  const ql = q.toLowerCase();
  const durM = ql.match(/(\d+)\s*(sol|day)/);
  const colony = ['jezero', 'arcadia', 'utopia', 'valles'].find(c => ql.includes(c)) ?? 'arcadia';
  const Name = colony[0].toUpperCase() + colony.slice(1);
  if (ql.includes('storm') && (ql.includes('last') || ql.includes('long') || durM)) {
    const dur = durM ? Number(durM[1]) : 60;
    const o2 = JSON.parse(exec('resource_forecast', { colony, resource: 'O2', storm_duration_sols: dur }));
    const wa = JSON.parse(exec('resource_forecast', { colony, resource: 'WATER', storm_duration_sols: dur }));
    const ro = (x: number | null) => (x === null ? 'lasts more than 60 days' : `runs out in about ${x} days`);
    return { body: `If the storm stays over ${Name} for ${dur} days, with Rover 7's delivery the air ${ro(o2.run_out_sol_with_deliveries)} and the water ${ro(wa.run_out_sol_with_deliveries)}. Without any delivery, the air ${ro(o2.run_out_sol_no_action)}. Next step: keep Rover 7 on its way and ask ${Name} to save power.`, tools: used, author: 'scripted' };
  }
  if (ql.includes('window') || ql.includes('earth') || ql.includes('launch') || ql.includes('order') || ql.includes('rocket')) {
    const l = JSON.parse(exec('launch_window', {}));
    const d = JSON.parse(exec('light_delay', {}));
    return { body: `Rockets can next leave Earth in ${l.days_until} days, and the trip takes ${l.time_of_flight_days} days. Our order fills ${l.order.ships.length} rockets with ${l.order.total_t} tonnes. A message to Earth takes ${d.one_way}. Next step: a second person approves the order.`, tools: used, author: 'scripted' };
  }
  if (ql.includes('rover') || ql.includes('route') || ql.includes('convoy') || ql.includes('r-7') || ql.includes('r7')) {
    const f = JSON.parse(exec('fleet_status', {}));
    const r7 = f.rovers.find((r: { rover: string }) => r.rover === 'r-7');
    const moving = r7?.status === 'IN_TRANSIT';
    return { body: `Rover 7 is ${moving ? 'driving to Arcadia' : String(r7?.status ?? 'parked').toLowerCase().replace('_', ' ')}${r7?.eta_sols ? ` and arrives in ${r7.eta_sols} days` : ''}. Rover 3 is broken and waiting for repair. Next step: keep Rover 5 ready at Utopia as a backup.`, tools: used, author: 'scripted' };
  }
  const s = JSON.parse(exec('storm_ensemble', {}));
  const n = JSON.parse(exec('network_status', {}));
  const worst = n.colonies.map((c: { colony: string; reserve_days: Record<string, number> }) => ({ c: c.colony, d: Math.min(...(Object.values(c.reserve_days) as number[])) })).sort((a: { d: number }, b: { d: number }) => a.d - b.d)[0];
  const W = worst.c[0].toUpperCase() + worst.c.slice(1);
  return { body: `The dust storm has a ${Math.round(parseFloat(String(s.probability)))}% chance to reach ${String(s.target)[0].toUpperCase() + String(s.target).slice(1)} in ${Math.round(s.arrival_sols_from_now.p10)} to ${Math.round(s.arrival_sols_from_now.p90)} days. ${W} has the fewest supplies: ${worst.d} days left. Next step: approve the Earth order and keep Rover 7 on its way.`, tools: used, author: 'scripted' };
}
