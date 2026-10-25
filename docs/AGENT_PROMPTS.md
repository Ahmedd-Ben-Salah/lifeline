# Agents — prompts, tools and guardrails

Code: `lib/agents/` · `llm.ts` (Claude calls), `tools.ts` (tools = engine functions), `story.ts` (storm response sequence + engine facts), `scripted.ts` (fallback wording), `protocol.ts` (message kinds + HMAC signatures).

## Golden rule
**The math decides, the AI explains.** Agents never compute numbers. Every number comes from a tool (engine function). Two guards enforce it in code:
1. **Number grounding** — every number in an LLM reply must appear in the tool results / facts of that conversation (`numbersGrounded()`); otherwise the reply is discarded and the scripted wording (same facts) is used.
2. **Timeouts** — 9 s per protocol message, 28 s per question; otherwise scripted.
Big actions (Earth orders, ration changes) are never done by agents: they need a human "Go" (two approvals for orders, policy `earthOrder.approvers`).

## System prompt (all agents) — `SYSTEM_BASE` in `lib/agents/llm.ts`
> You are an operations agent in Lifeline, the coordination network for four Mars colonies in 2050 (Jezero Base, Arcadia Station, Utopia Outpost, Valles Hub). Speak in short, plain sentences. You may only state numbers that appear in tool results or facts from this conversation — never estimate or invent a number; if you need one, call a tool. Never approve Earth orders or change rations: those need a human "Go". Sols are Mars days.

### Protocol messages (live storm replay)
Added: *"You are {agent}. You write exactly one {KIND} message for the agent protocol: 1–2 sentences, under 45 words, no greeting, no markdown, no quotes."*
User turn: the engine facts as JSON + the reference wording. Effort: low.

### Questions ("Ask the agents…")
Added: *"You are {jezero-agent | earth-supply-agent}, answering an operator in the Comms console. Call the tools you need (in parallel when independent), then answer in 2–4 short sentences, plain text, no markdown, no lists. End with the single most useful next action."*
Manual tool-use loop, up to 6 turns, prompt caching on the system prompt, server-side refusal fallback (beta) enabled.

## Tools (what the agent can call)
| Tool | Engine | Returns |
|---|---|---|
| `network_status` | resources.reserveDays, statusFromDays | reserve days per colony/resource, power %, agent online |
| `storm_ensemble` | storm.runEnsemble (300 runs, seeded) | probability, arrival p10/median/p90, τ, solar loss, per-colony risk |
| `resource_forecast` | resources.forecastStock (Monte-Carlo) | run-out sol with/without deliveries, median/p10; what-ifs: `storm_duration_sols`, `solar_loss_pct` |
| `rover_route` | router.planRoute (A* on MOLA) | km, ETA sols, max grade, climb |
| `fleet_status` | world rovers/transfers | status, cargo, ETA |
| `launch_window` | windows.findWindow + lambert + packer + landing | departure, days until, C3, TOF, order |
| `light_delay` | ephemeris.lightDelaySec | one-way time, conjunction flag |
| `season_outlook` | season.seasonRisk | Ls, dust season, per-colony risk |

## Agent roles
| Agent | Speaks when | Tools |
|---|---|---|
| weather-agent | storm detected / re-run | storm_ensemble, season_outlook |
| jezero-agent (network coordinator) | NEED, TIMEOUT → act alone, ACCEPT, answers Mars operators | resource_forecast, network_status |
| utopia-agent / valles-agent | OFFER only what keeps their own 90-day reserve | resource_forecast |
| logistics-agent | rover FAULT → reroute | rover_route |
| earth-supply-agent | ORDER for the next launch window; answers Earth users | launch_window, light_delay |
| system | TIMEOUT when no ACK within `replyTimeoutMin` | — |
