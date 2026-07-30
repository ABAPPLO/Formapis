import { describe, expect, it, vi } from 'vitest'
import { launchScenario } from '../../../scenarios/launcher'
import type { RpcContext } from '../core'
import { SCENARIOS_METHODS } from './scenarios'

// Why: stub the launcher so the RPC forwarding contract is hermetic — no on-disk scenario fixtures required.
vi.mock('../../../scenarios/launcher', () => ({
  launchScenario: vi.fn()
}))

function findMethod(name: string) {
  const method = SCENARIOS_METHODS.find((m) => m.name === name)
  if (!method) {
    throw new Error(`Method not found: ${name}`)
  }
  return method
}

const ctx = { runtime: { getOrchestrationDb: () => ({}) } } as unknown as RpcContext

describe('scenarios.launch RPC', () => {
  it('forwards unknownAssignees when launch refuses', async () => {
    vi.mocked(launchScenario).mockReturnValue({
      ok: false,
      error: 'unknown agent(s): nope-a',
      unknownAssignees: ['nope-a']
    })

    const method = findMethod('scenarios.launch')
    const parsed = method.params!.parse({ name: 'demo' })
    const result = await method.handler(parsed, ctx)

    expect(result).toEqual({
      ok: false,
      error: 'unknown agent(s): nope-a',
      unknownAssignees: ['nope-a']
    })
  })

  it('forwards the success variant unchanged', async () => {
    vi.mocked(launchScenario).mockReturnValue({
      ok: true,
      runId: '',
      scenarioName: 'demo',
      taskIds: [],
      mode: 'orchestrated'
    })

    const method = findMethod('scenarios.launch')
    const parsed = method.params!.parse({ name: 'demo' })
    const result = await method.handler(parsed, ctx)

    expect(result).toMatchObject({ ok: true, scenarioName: 'demo' })
  })
})
