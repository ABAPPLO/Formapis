import { resolveAgentLaunch } from '../../agents-yaml/runner'
import type { AgentLaunchPayload } from '../../../shared/agent-yaml'
import type { CoordinatorRuntime } from './coordinator'

// Why: per-task worker lifecycle owner (resolve → spawn → close). v1 policy is
// one-task-one-terminal (ephemeral); acquire/release leave room for v2 pool/N-concurrency.
export type AcquireResult =
  | { ok: true; handle: string; agentName: string }
  | { ok: false; reason: 'unknown_agent' | 'spawn_failed'; message: string }

export class AgentWorkerManager {
  private readonly cache = new Map<string, AgentLaunchPayload | null>()

  constructor(
    private readonly runtime: CoordinatorRuntime,
    private readonly homeDir: string
  ) {}

  // Why: resolveAgentLaunch does disk I/O per call; cache by assignee name (null = known-missing).
  resolve(assignee: string): AgentLaunchPayload | null {
    if (this.cache.has(assignee)) {
      return this.cache.get(assignee) ?? null
    }
    const result = resolveAgentLaunch(assignee, this.homeDir)
    const value = 'payload' in result ? result.payload : null
    this.cache.set(assignee, value)
    return value
  }

  async acquire(worktree: string | undefined, assignee: string): Promise<AcquireResult> {
    const payload = this.resolve(assignee)
    if (!payload) {
      return { ok: false, reason: 'unknown_agent', message: `Agent "${assignee}" not found` }
    }
    try {
      const { handle } = await this.runtime.spawnAgentTerminal(worktree, payload)
      return { ok: true, handle, agentName: assignee }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        reason: 'spawn_failed',
        message: `failed to spawn agent ${assignee}: ${message}`
      }
    }
  }

  async release(handle: string): Promise<void> {
    await this.runtime.closeTerminal(handle).catch(() => {
      // Why: best-effort teardown; task is already terminal, orphan cleanup sweeps stragglers.
    })
  }
}
