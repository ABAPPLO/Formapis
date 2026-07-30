# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What is Formapis

Formapis is a fork/evolution of [Orca](https://github.com/stablyai/orca) — an Electron **ADE (AI Development Environment)** that runs 30+ local AI coding agents (Codex / Claude Code / Gemini / Cursor / OpenCode / Grok / ZCode …) in parallel across isolated git worktrees. On top of the Orca runtime, Formapis adds four capability layers (most in progress — see `README.md` for the phased roadmap):

- **Unified resource layer** — MCP / Skill / Plugin defined once, distributed into each agent's config dir.
- **YAML agent workbench** — declare agents (identity / role / tools / harness) in YAML; generate / download / load / trial-run.
- **Agent cluster + task board** — orchestrate multiple agents (ordered workflow pipeline / unordered main-agent scheduling) with a visual board.
- **A2A external interface** — expose agents over the A2A protocol.

It ships as a **desktop app** (macOS / Windows / Linux) **and** a **web client** that connects to the desktop runtime over an end-to-end-encrypted WebSocket; the React UI is shared. The `orca` CLI binary and `ORCA_*` env vars are retained from the Orca baseline and migrate gradually.

## Commands

Package manager is **pnpm 10.24.0** on **Node 24** (see `engines`). Native deps (node-pty, @parcel/watcher, sherpa-onnx) are rebuilt on `postinstall` and after branch switches via `pnpm rebuild:electron`.

### Develop
- `pnpm dev` — desktop (electron-vite). Runs `ensure:electron-runtime` first.
- `pnpm dev:web` — web client (`vite.web.config.ts`).
- `FORMAPIS_POLL=1 pnpm dev` — polling file-watch fallback for hosts whose inotify budget is too small for this tree (ENOSPC otherwise crashes the dev server).

### Typecheck / lint / format
- `pnpm tc` (= `typecheck`) — all three TypeScript projects (`node` / `cli` / `web`, configs in `config/tsconfig.*.json`).
- `pnpm lint` — the full gate: oxlint + switch-exhaustiveness (type-aware) + styled-scrollbar check + reliability gates + max-lines ratchet + bundled-skill-guide / skill-manifest / localization verification. Slow; runs in CI.
- `oxlint` — fast lint subset. lint-staged runs `oxlint` + `oxlint --config config/oxlint-react-doctor.json` + `oxfmt --write` on commit.
- `pnpm format` — `oxfmt --write .`

### Test
- `pnpm test` — vitest (node runtime). **Unit tests are colocated**: `foo.ts` + `foo.test.ts` next to it.
- Run a single file: `npx vitest run <path> -c config/vitest.config.ts` (or `pnpm test -- <pattern>`).
- `pnpm test:e2e` — Playwright against the Electron app; specs in `tests/e2e/`. Specialized suites exist for terminal perf, source-control scale, multi-client navigation, etc. (`pnpm test:e2e:terminal-perf`, `:source-control-scale`, …). `pnpm test:e2e:computer` is vitest-based.

### Build / package
- `pnpm build` — full desktop + native build.
- `pnpm build:desktop` — typecheck + relay + cli + electron-vite + web (no native compile).
- Platform packaging: `pnpm build:mac` / `build:win` / `build:linux` (each calls `ensure:electron-runtime` before electron-builder). `build:mac:release` requires release env/secrets.
- `pnpm build:cli` — builds the `orca` CLI to `out/` and installs it for local dev.

## Architecture

### Process model
The app is several cooperating processes — most backend logic lives as one-feature-per-file in `src/main/`.

- **main** — `src/main/index.ts`, the Electron main process (app lifecycle, window/tray, service wiring, daemon + hook startup).
- **daemon** — `src/main/daemon/daemon-entry.ts`, forked and **asar-unpacked** so `child_process.fork()` can execute it from disk. This is the long-lived **runtime server** that CLI / web / mobile clients connect to.
- **relay** — `src/relay/`, a local framed-protocol server that external agents **and** the CLI connect to; implements fs / git / pty / exec / agent-hook / plugin-overlay handlers. Built separately via `build:relay`.
- **renderer** — `src/renderer/` React 19 app. `index.html` is the main window; `popout.html` is a **second independent React root** (dashboard pop-out). `src/renderer/src/web/` holds the web-client variant that talks to the runtime over E2EE WS.
- **preload** — `src/preload/index.ts` exposes the audited `window.api` Electron-IPC surface. This file is the **security / type-drift contract** for the local desktop bridge — keep it in sync with `src/main/ipc/*` handlers.
- **cli** — `src/cli/`, the `orca` CLI; itself a runtime-RPC client.
- **mobile** — separate `mobile/` app; reaches the runtime over encrypted WS, not Electron IPC.

### Two IPC/RPC layers — don't confuse them
1. **Electron IPC (desktop only)** — `src/main/ipc/*.ts` handlers ↔ `window.api` in preload. Add a channel by registering a handler in `src/main/ipc/` and exposing it in `src/preload/index.ts`.
2. **Runtime RPC (all clients)** — `src/main/runtime/rpc/methods/*`, a flat manifest aggregated in `methods/index.ts` (`ALL_RPC_METHODS`). Wire frame: `{ id, ok, result | error, _meta }` (`src/shared/runtime-rpc-envelope.ts`). Served by the daemon over WS / unix-socket; mobile traffic is E2E-encrypted (`src/main/runtime/rpc/e2ee-*.ts`). **To add a method:** create a module in `methods/` exporting an `RpcAnyMethod[]`, then append it to `ALL_RPC_METHODS` in `methods/index.ts`.

`src/shared/` holds types and logic imported by *every* process — keep it free of Electron/Node-only APIs.

### Formapis capability layers (the code that extends Orca)
- **Unified resources** — `src/main/resources/` (canonical store → discovery → distributor) + `src/shared/resources.ts`. RPC: `RESOURCE_METHODS`.
- **YAML agents** — `src/main/agents-yaml/` (registry / runner / conversation) + `src/shared/agent-yaml.ts`; UI under `src/renderer/.../agents-yaml/`. RPC: `AGENTS_YAML_METHODS`.
- **Workflow nodes** — `src/main/workflow-nodes-yaml/` + `src/shared/workflow-node-yaml.ts`; compose ordered agent pipelines. UI: `src/renderer/.../components/workflow-nodes-yaml/`. RPC: `WORKFLOW_NODE_YAML_METHODS`.
- **Scenarios** — `src/main/scenarios/` (registry / launcher / exporter) + `src/shared/scenario-yaml.ts`: run a scenario across a cluster and export results. RPC: `SCENARIOS_METHODS`.
- **A2A** — `src/main/a2a/` (agent-card + handler): expose agents over the A2A protocol.
- **Cloud sync** — planned; design in `docs/cloud-platform-architecture.md` (local syncs agent YAML / skills / workflow / API keys to `formapis.cloud`, or acts as a relay-only tunnel).

### Agent integration model
Each supported agent has its own folder in `src/main/` (e.g. `codex/`, `claude/`, `gemini/`, `cursor/`, `opencode/`, `grok/`) plus shared detection / launch / status logic in `src/shared/`. Agents run inside a claimed worktree's terminal (PTY via `node-pty`); status and usage are parsed from terminal output and OSC sequences (`src/shared/agent-status-*.ts`, `*-usage-types.ts`). `src/relay/agent-exec-handler.ts` is where an agent harness is spawned for a remote/CLI request.

## Conventions
- **Co-located tests:** `foo.ts` + `foo.test.ts`. Variants: `*.integration.test.ts`, `*.live.test.ts`, `*.bench.test.ts`.
- **Three tsconfig projects** (`config/tsconfig.{node,cli,web}.json`) back the three typecheck targets; ambient declarations live in `src/types/` (e.g. compile-time build constants).
- **Telemetry is compile-time gated:** `ORCA_BUILD_IDENTITY` / `ORCA_POSTHOG_WRITE_KEY` fold to literal `null` in `electron.vite.config.ts` unless set by official CI — contributor / `pnpm dev` builds never transmit. There is no runtime env-var override.
- UI work, naming, comment style, the max-lines ratchet, and cross-platform / SSH / folder-workspace / Git-compatibility rules live in **`AGENTS.md`** (included above) and `docs/STYLEGUIDE.md` — follow those, not guesses.
