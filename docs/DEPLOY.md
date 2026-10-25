# Deploying Lifeline (Vercel)

Lifeline is a standard Next.js 16 app. Nothing to build by hand: textures are committed in `public/textures`, the elevation grid in `lib/engine/data/mola.ts`.

## 1. One-time setup (5 minutes)

```bash
npm i -g vercel          # Vercel CLI
cd lifeline              # this repository
vercel login
vercel link              # create/link a project (accept defaults: framework Next.js)
```

### Environment variables
Add them in **Vercel → your project → Settings → Environment Variables** (Production + Preview), or from the CLI:

```bash
vercel env add AUTH_SECRET production        # paste: output of  openssl rand -base64 32
vercel env add ANTHROPIC_API_KEY production  # paste your Claude key (sk-ant-...)
vercel env add ANTHROPIC_MODEL production    # claude-opus-5-5   (or claude-sonnet-5-5 to save cost)
vercel env add AGENTS_MODE production        # llm
vercel env add DEMO_DELAY_SCALE production   # 0.1
vercel env add DEMO_TIMEOUT_SCALE production # 0.02
```

**Where does the Claude key go?** Only in the `ANTHROPIC_API_KEY` environment variable (Vercel settings, or `.env.local` on your laptop). It is read on the server only (`lib/agents/llm.ts`) and never sent to the browser.

### Shared state (strongly recommended)
Serverless functions can run on several instances. To make every instance see the same world (needed for the two-person approval demo from two laptops):

Vercel dashboard → **Storage** (or Marketplace) → **Upstash for Redis** → Create (free plan) → connect to the project.
It adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Lifeline detects them (see `lib/server/store.ts`). Settings → "Store" will then show `redis`.

Without Redis the app still works (state lives in instance memory), which is fine for a single-laptop demo.

## 2. Deploy

```bash
vercel --prod
```

That's the one command. It prints your URL, e.g. `https://lifeline-xyz.vercel.app`.

## 3. Check it

1. Open the URL → landing page → **Open mission control** → sign in as `ayari@jezero.base` / `lifeline-demo`.
2. Settings → **Test Claude connection** → should say `Lifeline agents online` with the model and latency.
3. Press **D** → Demo controls → **Reset**, then **Inject storm (live)** and watch Comms.

## Local development

```bash
npm i
cp .env.example .env.local   # fill AUTH_SECRET (and ANTHROPIC_API_KEY if you want Claude)
npm run dev                  # http://localhost:3000
npm test                     # engine unit tests (vitest)
```

State is saved to `.data/world.json` locally. Demo panel → Reset (or delete that file) restores the seeded scenario.

## Costs (Claude)
- Each "Inject storm" writes 8 agent messages: ~8 short calls ≈ $0.02–0.05 with Opus 5.5 at low effort.
- Each "Ask the agents" question: 2–4 calls with tool results ≈ $0.02–0.08.
- A full day of rehearsals (≈ 200 questions + 50 replays) stays well under $15. Switch `ANTHROPIC_MODEL=claude-sonnet-5-5` to halve it.
- If the API fails, is slow (> 8 s for messages, > 28 s for answers) or the reply contains a number not found in the tool results, the app silently uses the scripted wording — the demo never breaks.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Login works but you are sent back to /login | `AUTH_SECRET` changed between deploys → sign in again |
| Messages say "template" instead of "Claude" | No key, `AGENTS_MODE=scripted`, or the key is invalid → Settings → Test Claude connection shows the reason |
| Two laptops see different states | Add Upstash Redis (above) |
| 3D view slow on the venue laptop | Traffic 3D → speed 1 day/s, turn off "Earth orbit" layer |
