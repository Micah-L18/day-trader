# CLAUDE.md — conventions & guardrails

Authoritative coding conventions for this repo. The full architecture and
roadmap live in [`PLAN.md`](./PLAN.md); read it first.

## Non-negotiable safety guardrails

1. **Paper is the default.** Code defaults to simulated/paper trading. Live
   trading requires ALL of: app `mode: live`, env `ALLOW_LIVE_TRADING=1`, and an
   on-screen typed confirmation. If any is missing, refuse to connect live.
2. **Single submission chokepoint.** Every order flows through one
   `SafetyGate.submitOrder()`. No other code path may reach the broker. The
   renderer never imports broker/data SDKs — it only calls `window.api`.
3. **No secrets in code or git.** Keys live in the OS keychain (Electron
   `safeStorage`) or a git-ignored `.env`. Maintain `.env.example` with
   placeholders only.
4. **Server-side stops.** Protective stops are placed at the broker (bracket /
   OTO), so positions stay protected if the app crashes.
5. **Fail safe, not open.** On any ambiguous error (disconnect, unknown order
   state, data gap): stop trading and alert — never blind-retry a submission.
6. **Log everything.** Signals, order requests, broker responses, fills,
   rejections, and risk decisions are persisted to the SQLite journal + logs.

## Process boundaries (Electron)

- **main** — Node-privileged. Owns providers, broker, SafetyGate, DB, secrets,
  global hotkeys. All broker/market-data I/O happens here.
- **preload** — exposes a typed `window.api` via `contextBridge`. The only
  bridge. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **renderer** — React UI. No Node, no fs, no SDKs. Talks only to `window.api`.
- **shared** — pure types + indicator math, safe to import anywhere.

## Code conventions

- Strict TypeScript. No `any` in shared contracts or IPC payloads.
- Money as `string`/`decimal.js`/integer cents — never binary float for
  prices or quantities.
- Small, testable modules; dependency-inject providers/brokers so paper↔live
  and sim↔real swap by config, not rewrites.
- Conventional commits. Run `npm run typecheck` (and tests, once present)
  before considering a phase complete.

## Testing

- Unit (Vitest): indicators, `SafetyGate` (pass + reject per limit, kill-switch,
  daily-loss halt, live-gating), sim provider.
- E2E (Playwright-Electron): smoke only.
- **No test may hit a live account.** Paper / sim / mock only.
