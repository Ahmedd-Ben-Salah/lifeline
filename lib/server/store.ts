/**
 * Persistence: the whole world is one JSON document.
 *
 *  - Upstash Redis (REST) when UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN are set (Vercel Marketplace, free tier).
 *    → shared by every serverless instance, survives redeploys.
 *  - Otherwise: a local file (.data/world.json) in dev, or process memory on serverless.
 *
 * Every read runs `tick(now)` first, so scheduled agent events (timeouts, light-delayed
 * deliveries…) materialise lazily — no background worker is needed on serverless.
 */
import { promises as fs } from 'fs';
import path from 'path';
import type { World } from './types';
import { resetWorld } from './world';
import { tick } from '@/lib/agents/story';

const KEY = 'lifeline:world:v3';
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const useRedis = !!(url && token);
const useFile = !useRedis && !process.env.VERCEL;
const FILE = path.join(process.cwd(), '.data', 'world.json');

const g = globalThis as unknown as { __lifelineWorld?: string; __lifelineLock?: Promise<unknown> };

async function redis(cmd: (string | number)[]) {
  const r = await fetch(url!, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), cache: 'no-store' });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).result as string | null;
}

async function loadRaw(): Promise<string | null> {
  if (useRedis) return redis(['GET', KEY]);
  if (g.__lifelineWorld) return g.__lifelineWorld;
  if (useFile) { try { return await fs.readFile(FILE, 'utf8'); } catch { return null; } }
  return null;
}
async function saveRaw(s: string) {
  g.__lifelineWorld = s;
  if (useRedis) { await redis(['SET', KEY, s]); return; }
  if (useFile) { await fs.mkdir(path.dirname(FILE), { recursive: true }); await fs.writeFile(FILE, s); }
}

export const storeKind = () => (useRedis ? 'redis' : useFile ? 'file' : 'memory');

/** Serialise writers inside one instance (Redis gives last-write-wins across instances, fine for a demo). */
async function locked<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__lifelineLock ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(r => (release = r));
  g.__lifelineLock = prev.then(() => next);
  await prev;
  try { return await fn(); } finally { release(); }
}

async function loadTicked(): Promise<{ w: World; changed: boolean }> {
  const raw = await loadRaw();
  let w: World;
  let changed = false;
  if (!raw) { w = resetWorld(Date.now()); changed = true; }
  else w = JSON.parse(raw) as World;
  if (tick(w, Date.now())) { w.version += 1; changed = true; }
  return { w, changed };
}

export async function getWorld(): Promise<World> {
  return locked(async () => {
    const { w, changed } = await loadTicked();
    if (changed) await saveRaw(JSON.stringify(w));
    return w;
  });
}

/** Read-modify-write. The callback may mutate the world in place. */
export async function mutate<T>(fn: (w: World) => T | Promise<T>): Promise<{ w: World; result: T }> {
  return locked(async () => {
    const { w } = await loadTicked();
    const result = await fn(w);
    tick(w, Date.now());
    w.version += 1;
    await saveRaw(JSON.stringify(w));
    return { w, result };
  });
}

export async function replaceWorld(w: World) {
  return locked(async () => { await saveRaw(JSON.stringify(w)); return w; });
}
