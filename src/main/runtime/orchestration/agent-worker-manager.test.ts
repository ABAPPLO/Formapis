import { describe, expect, it, vi } from 'vitest'
import { AgentWorkerManager } from './agent-worker-manager'
import type { CoordinatorRuntime } from './coordinator'
import type { AgentLaunchPayload } from '../../../shared/agent-yaml'

const payload = (name: string): AgentLaunchPayload => ({
  provider: 'claude',
  runtimeType: undefined,
  systemPrompt: `prompt for ${name}`,
  initialMessage: `prompt for ${name}`,
  displayName: name,
  tools: { mcp: [], skills: [], plugins: [] }
})

function makeRuntime(
  spawnImpl: (
    w: string | undefined,
    p: AgentLaunchPayload
  ) => Promise<{ handle: string; worktreeId: string }>
): CoordinatorRuntime {
  return {
    sendTerminalAgentPrompt: vi.fn(),
    listTerminals: vi.fn(async () => ({ terminals: [] })),
    createTerminal: vi.fn(),
    waitForTerminal: vi.fn(),
    probeWorktreeDrift: vi.fn(async () => null),
    spawnAgentTerminal: vi.fn(spawnImpl),
    closeTerminal: vi.fn(async () => {})
  } as unknown as CoordinatorRuntime
}

describe('AgentWorkerManager', () => {
  it('resolve returns null for an unregistered agent', () => {
    const m = new AgentWorkerManager(
      makeRuntime(async () => ({ handle: 'h', worktreeId: 'w' })),
      '/nonexistent-home'
    )
    expect(m.resolve('no-such-agent')).toBeNull()
  })

  it('acquire fails with unknown_agent when resolve returns null', async () => {
    const m = new AgentWorkerManager(
      makeRuntime(async () => ({ handle: 'h', worktreeId: 'w' })),
      '/nonexistent-home'
    )
    const r = await m.acquire(undefined, 'no-such-agent')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('unknown_agent')
    }
  })

  it('acquire spawns a terminal and returns the handle + name', async () => {
    const runtime = makeRuntime(async (_w, _p) => ({ handle: 'h_spawn', worktreeId: 'wt' }))
    const m = new AgentWorkerManager(runtime, '/nonexistent-home')
    vi.spyOn(m, 'resolve').mockReturnValue(payload('code-reviewer'))
    const r = await m.acquire(undefined, 'code-reviewer')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.handle).toBe('h_spawn')
      expect(r.agentName).toBe('code-reviewer')
    }
    expect(runtime.spawnAgentTerminal).toHaveBeenCalledWith(undefined, payload('code-reviewer'))
  })

  it('acquire fails with spawn_failed when runtime throws', async () => {
    const runtime = makeRuntime(async () => {
      throw new Error('boom')
    })
    const m = new AgentWorkerManager(runtime, '/nonexistent-home')
    vi.spyOn(m, 'resolve').mockReturnValue(payload('code-reviewer'))
    const r = await m.acquire(undefined, 'code-reviewer')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('spawn_failed')
    }
  })

  it('release closes the terminal', async () => {
    const runtime = makeRuntime(async () => ({ handle: 'h', worktreeId: 'w' }))
    const m = new AgentWorkerManager(runtime, '/nonexistent-home')
    await m.release('h')
    expect(runtime.closeTerminal).toHaveBeenCalledWith('h')
  })
})
