import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from './db'
import { reconcileLifecycleMessage } from './lifecycle-reconciliation'
import type { AgentLaunchPayload } from '../../../shared/agent-yaml'
import {
  Coordinator,
  DISPATCH_STALE_THRESHOLD,
  parseAllowStaleBaseFromSpec,
  type CoordinatorOptions,
  type CoordinatorRuntime
} from './coordinator'
import { AgentWorkerManager } from './agent-worker-manager'

const payload = (name: string): AgentLaunchPayload => ({
  provider: 'claude',
  runtimeType: undefined,
  systemPrompt: `prompt for ${name}`,
  initialMessage: `prompt for ${name}`,
  displayName: name,
  tools: { mcp: [], skills: [], plugins: [] }
})

// Why: every Coordinator needs an AgentWorkerManager now; this injects one over the
// mock runtime so non-assignee tests stay unchanged. Assignee-bearing tests build
// their own manager so they can stub `resolve`.
function makeCoordinator(
  db: OrchestrationDb,
  runtime: CoordinatorRuntime,
  options: Omit<CoordinatorOptions, 'agentWorkerManager'>
): Coordinator {
  const opts: CoordinatorOptions = {
    ...options,
    agentWorkerManager: new AgentWorkerManager(runtime, '/nonexistent-home')
  }
  return new Coordinator(db, runtime, opts)
}

// Why: collapse the noisy `new Promise((r) => setTimeout(r, ms))` wait into one helper.
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type DriftResult = {
  base: string
  behind: number
  recentSubjects: string[]
} | null

function createMockRuntime(): CoordinatorRuntime & {
  sentMessages: { handle: string; text: string }[]
  terminals: { handle: string; worktreeId: string; connected: boolean; writable: boolean }[]
  createdTerminals: string[]
  createdTerminalOptions: { title?: string }[]
  probeDriftCalls: string[]
  probeDriftResult: DriftResult
  cliCommand: 'orca' | 'orca-ide'
  setProbeDrift(result: DriftResult): void
  throwProbeDrift: Error | null
} {
  const mock = {
    sentMessages: [] as { handle: string; text: string }[],
    terminals: [] as {
      handle: string
      worktreeId: string
      connected: boolean
      writable: boolean
    }[],
    createdTerminals: [] as string[],
    createdTerminalOptions: [] as { title?: string }[],
    probeDriftCalls: [] as string[],
    probeDriftResult: null as DriftResult,
    cliCommand: 'orca' as 'orca' | 'orca-ide',
    throwProbeDrift: null as Error | null,
    setProbeDrift(result: DriftResult): void {
      mock.probeDriftResult = result
    },
    async sendTerminalAgentPrompt(handle: string, prompt: string) {
      mock.sentMessages.push({ handle, text: prompt })
      return { handle, accepted: true, bytesWritten: 0 }
    },
    async listTerminals() {
      return { terminals: mock.terminals }
    },
    async createTerminal(_worktree?: string, opts?: { title?: string }) {
      const handle = `term_worker_${mock.createdTerminals.length}`
      mock.createdTerminals.push(handle)
      mock.createdTerminalOptions.push(opts ?? {})
      mock.terminals.push({ handle, worktreeId: 'wt1', connected: true, writable: true })
      return { handle, worktreeId: 'wt1', title: opts?.title ?? '' }
    },
    async waitForTerminal(handle: string) {
      return { handle, condition: 'exit' }
    },
    async probeWorktreeDrift(worktreeSelector: string): Promise<DriftResult> {
      mock.probeDriftCalls.push(worktreeSelector)
      if (mock.throwProbeDrift) {
        throw mock.throwProbeDrift
      }
      return mock.probeDriftResult
    },
    getTerminalOrchestrationCliCommand() {
      return mock.cliCommand
    },
    spawnAgentTerminal: vi.fn(async (_w: string | undefined, _p: AgentLaunchPayload) => ({
      handle: 'term_spawned',
      worktreeId: 'wt_test'
    })),
    closeTerminal: vi.fn(async (_h: string) => {})
  }
  return mock
}

function insertWorkerDone(
  db: OrchestrationDb,
  params: {
    taskId: string
    to?: string
    from?: string
    dispatchId?: string
    filesModified?: string[]
    senderPaneKey?: string
  }
): void {
  const dispatch = db.getDispatchContext(params.taskId)
  const dispatchId = params.dispatchId ?? dispatch?.id
  if (!dispatchId) {
    throw new Error(`No dispatch for task ${params.taskId}`)
  }
  const from = params.from ?? dispatch?.assignee_handle ?? 'term_unknown'
  db.insertMessage({
    from,
    to: params.to ?? 'coord',
    subject: 'Done',
    type: 'worker_done',
    payload: JSON.stringify({
      taskId: params.taskId,
      dispatchId,
      ...(params.filesModified ? { filesModified: params.filesModified } : {})
    }),
    senderPaneKey:
      params.senderPaneKey ??
      (from === dispatch?.assignee_handle ? (dispatch.assignee_pane_key ?? undefined) : undefined)
  })
}

describe('Coordinator', () => {
  let db: OrchestrationDb

  afterEach(() => {
    db?.close()
  })

  it('throws if no tasks exist', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    const coordinator = makeCoordinator(db, runtime, {
      spec: 'do stuff',
      coordinatorHandle: 'coord'
    })
    await expect(coordinator.run()).rejects.toThrow('No tasks found')
  })

  it('dispatches a ready task to an available terminal', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.cliCommand = 'orca-ide'
    runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]

    const task = db.createTask({ spec: 'implement feature' })

    // Simulate worker_done arriving after dispatch
    const coordinator = makeCoordinator(db, runtime, {
      spec: 'build it',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50
    })

    // Run coordinator in background, then simulate completion
    const runPromise = coordinator.run()

    // Wait for dispatch to happen
    await wait(100)

    // Simulate the worker completing
    insertWorkerDone(db, { taskId: task.id, filesModified: ['a.ts'] })

    const result = await runPromise
    expect(result.status).toBe('completed')
    expect(result.completedTasks).toContain(task.id)
    expect(runtime.sentMessages.length).toBeGreaterThan(0)
    expect(runtime.sentMessages[0].text).toContain('orca-ide orchestration send')
  })

  it('records the assignee pane key when the runtime can resolve one', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
    const withPaneLookup = Object.assign(runtime, {
      getTerminalPaneKey: (handle: string) => (handle === 'term_a' ? 'tab_a:leaf_a' : null)
    })

    const task = db.createTask({ spec: 'implement feature' })
    const coordinator = makeCoordinator(db, withPaneLookup, {
      spec: 'build it',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50
    })
    const runPromise = coordinator.run()
    await wait(100)

    expect(db.getDispatchContext(task.id)?.assignee_pane_key).toBe('tab_a:leaf_a')

    insertWorkerDone(db, { taskId: task.id })
    await runPromise
  })

  it('records completedTasks when send reconciled worker_done before coordinator read', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()

    const task = db.createTask({ spec: 'send-driven completion' })
    const dispatch = db.createDispatchContext(task.id, 'term_a')
    const msg = db.insertMessage({
      from: 'term_a',
      to: 'coord',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({ taskId: task.id, dispatchId: dispatch.id })
    })

    reconcileLifecycleMessage(db, msg)

    const coordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20
    })
    const result = await coordinator.run()

    expect(result.status).toBe('completed')
    expect(result.completedTasks).toContain(task.id)
  })

  it('does not duplicate completedTasks for repeated completed worker_done messages', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()

    const task = db.createTask({ spec: 'duplicate completion' })
    const dispatch = db.createDispatchContext(task.id, 'term_a')
    const payload = JSON.stringify({ taskId: task.id, dispatchId: dispatch.id })
    const first = db.insertMessage({
      from: 'term_a',
      to: 'coord',
      subject: 'Done',
      type: 'worker_done',
      payload
    })
    db.insertMessage({
      from: 'term_a',
      to: 'coord',
      subject: 'Done again',
      type: 'worker_done',
      payload
    })

    reconcileLifecycleMessage(db, first)

    const coordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20
    })
    const result = await coordinator.run()

    expect(result.status).toBe('completed')
    expect(result.completedTasks.filter((id) => id === task.id)).toHaveLength(1)
  })

  it('creates a terminal when none are available', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    // Why: an assignee-bearing task spawns a worker terminal via the manager even when no free terminal exists.
    const manager = new AgentWorkerManager(runtime, '/nonexistent-home')
    vi.spyOn(manager, 'resolve').mockReturnValue(payload('codex'))

    const task = db.createTask({ spec: 'assignee: codex\nwork' })

    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50,
      agentWorkerManager: manager
    })

    const runPromise = coordinator.run()
    await wait(100)

    // Why: routing goes through the manager's spawnAgentTerminal, not the legacy createTerminal path.
    expect(runtime.spawnAgentTerminal).toHaveBeenCalledWith(undefined, payload('codex'))

    // Complete the task from the spawned handle
    insertWorkerDone(db, { taskId: task.id, from: 'term_spawned' })

    const result = await runPromise
    expect(result.status).toBe('completed')
    // Why: one-task-one-terminal teardown — the spawned worker is released on completion.
    expect(runtime.closeTerminal).toHaveBeenCalledWith('term_spawned')
  })

  it('records the resolved agent when an assignee is known and dispatches via the manager', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    const manager = new AgentWorkerManager(runtime, '/nonexistent-home')
    vi.spyOn(manager, 'resolve').mockReturnValue(payload('gemini'))

    const task = db.createTask({ spec: 'assignee: gemini\nwork' })

    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50,
      agentWorkerManager: manager
    })

    const runPromise = coordinator.run()
    await wait(100)

    expect(db.getTask(task.id)?.resolved_agent).toBe('gemini')
    expect(runtime.spawnAgentTerminal).toHaveBeenCalled()

    insertWorkerDone(db, { taskId: task.id, from: 'term_spawned' })
    const result = await runPromise
    expect(result.status).toBe('completed')
  })

  it('fails a ready task fast when its assignee agent is unknown', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    // Why: real home is unused; resolve genuinely returns null for an unregistered agent.
    const manager = new AgentWorkerManager(runtime, '/nonexistent-home')

    const task = db.createTask({ spec: 'assignee: no-such-agent\nwork' })

    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20,
      agentWorkerManager: manager
    })

    const result = await coordinator.run()

    expect(result.status).toBe('failed')
    expect(result.failedTasks).toContain(task.id)
    expect(db.getTask(task.id)?.status).toBe('failed')
    // Why: dispatch_error captures why the assignee could not be routed.
    expect(db.getTask(task.id)?.dispatch_error).toContain('no-such-agent')
    expect(runtime.spawnAgentTerminal).not.toHaveBeenCalled()
  })

  it('releases the spawned terminal on a retryable dispatch failure', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    const manager = new AgentWorkerManager(runtime, '/nonexistent-home')
    vi.spyOn(manager, 'resolve').mockReturnValue(payload('codex'))
    const task = db.createTask({ spec: 'assignee: codex\nwork' })
    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20,
      agentWorkerManager: manager
    })

    const runPromise = coordinator.run()
    await wait(80)
    expect(runtime.spawnAgentTerminal).toHaveBeenCalled()

    // Why: one escalation → failure_count 1 (retryable, not circuit-broken); task returns to 'ready'.
    db.insertMessage({
      from: 'term_spawned',
      to: 'coord',
      subject: 'stuck',
      type: 'escalation',
      payload: JSON.stringify({ taskId: task.id })
    })
    await wait(80)

    // Why: the failed attempt's terminal is released even though the task will retry.
    expect(runtime.closeTerminal).toHaveBeenCalledWith('term_spawned')
    expect(db.getTask(task.id)?.status).not.toBe('failed')

    coordinator.stop()
    await runPromise
  })

  it('handles escalation and circuit breaker', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [
      { handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true },
      { handle: 'term_b', worktreeId: 'wt1', connected: true, writable: true }
    ]

    const task = db.createTask({ spec: 'risky work' })

    const coordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50
    })

    const runPromise = coordinator.run()

    // Send 3 escalations to trigger circuit breaker
    for (let i = 0; i < 3; i++) {
      await wait(100)
      db.insertMessage({
        from: `term_${i === 0 ? 'a' : 'b'}`,
        to: 'coord',
        subject: `Failed attempt ${i + 1}`,
        type: 'escalation',
        payload: JSON.stringify({ taskId: task.id })
      })
    }

    const result = await runPromise
    expect(result.status).toBe('failed')
    expect(result.failedTasks).toContain(task.id)
  })

  it('reports failed when dispatch send failures circuit-break in the DB', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
    runtime.sendTerminalAgentPrompt = async () => {
      throw new Error('terminal_not_writable')
    }

    const task = db.createTask({ spec: 'cannot dispatch' })
    const coordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 10
    })

    const result = await coordinator.run()

    expect(result.status).toBe('failed')
    expect(result.failedTasks).toContain(task.id)
    expect(db.getTask(task.id)?.status).toBe('failed')
  })

  it('handles decision gate blocking and resolution', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]

    const task = db.createTask({ spec: 'needs approval' })

    const coordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50
    })

    const runPromise = coordinator.run()

    // Wait for dispatch
    await wait(100)

    // Worker sends decision gate
    db.insertMessage({
      from: 'term_a',
      to: 'coord',
      subject: 'Need approval',
      type: 'decision_gate',
      payload: JSON.stringify({
        taskId: task.id,
        question: 'Proceed with destructive migration?',
        options: ['yes', 'no']
      })
    })

    await wait(100)

    // Verify task is blocked
    const blocked = db.getTask(task.id)
    expect(blocked?.status).toBe('blocked')
    expect(db.getActiveDispatchForTerminal('term_a')).toBeUndefined()

    // Resolve the gate
    const gates = db.listGates({ taskId: task.id, status: 'pending' })
    expect(gates.length).toBe(1)
    db.resolveGate(gates[0].id, 'yes')

    // Wait for re-dispatch and simulate completion
    await wait(200)

    insertWorkerDone(db, { taskId: task.id })

    const result = await runPromise
    expect(result.status).toBe('completed')
    expect(result.completedTasks).toContain(task.id)
  })

  it('respects task DAG ordering', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]

    const t1 = db.createTask({ spec: 'first' })
    const t2 = db.createTask({ spec: 'second', deps: [t1.id] })

    expect(t2.status).toBe('pending')

    const coordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50
    })

    const runPromise = coordinator.run()

    // Wait for t1 dispatch
    await wait(100)

    // t2 should still be pending
    expect(db.getTask(t2.id)?.status).toBe('pending')

    // Complete t1
    insertWorkerDone(db, { taskId: t1.id })

    // Wait for t2 to be promoted and dispatched
    await wait(200)

    // t2 should now be dispatched
    const t2Status = db.getTask(t2.id)?.status
    expect(t2Status === 'dispatched' || t2Status === 'ready').toBe(true)

    // Complete t2
    insertWorkerDone(db, { taskId: t2.id })

    const result = await runPromise
    expect(result.status).toBe('completed')
    expect(result.completedTasks).toContain(t1.id)
    expect(result.completedTasks).toContain(t2.id)
  })

  it('respects maxConcurrent limit', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [
      { handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true },
      { handle: 'term_b', worktreeId: 'wt1', connected: true, writable: true },
      { handle: 'term_c', worktreeId: 'wt1', connected: true, writable: true }
    ]

    const t1 = db.createTask({ spec: 'one' })
    const t2 = db.createTask({ spec: 'two' })
    const t3 = db.createTask({ spec: 'three' })

    const coordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50,
      maxConcurrent: 2
    })

    const runPromise = coordinator.run()

    await wait(100)

    // Only 2 should be dispatched
    const dispatched = db.listTasks({ status: 'dispatched' })
    expect(dispatched.length).toBe(2)

    // Complete all tasks
    for (const task of [t1, t2, t3]) {
      insertWorkerDone(db, { taskId: task.id })
      await wait(100)
    }

    const result = await runPromise
    expect(result.status).toBe('completed')
  })

  it('logs a stale warning for dispatched rows past the threshold and does not auto-fail', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    // No terminals available so dispatchReadyTasks creates one and we can
    // drive the stale-scan deterministically via SQL backdating.
    const task = db.createTask({ spec: 'work' })
    const ctx = db.createDispatchContext(task.id, 'term_stale')

    // Backdate dispatched_at and last_heartbeat_at beyond the 10-min threshold
    // so getStaleDispatches returns this row on the first tick.
    const sqlite = (
      db as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }
    ).db
    const iso = (ms: number) => new Date(Date.now() - ms).toISOString()
    sqlite
      .prepare('UPDATE dispatch_contexts SET dispatched_at = ?, last_heartbeat_at = ? WHERE id = ?')
      .run(iso(60 * 60 * 1000), iso(30 * 60 * 1000), ctx.id)

    const logs: string[] = []
    const coordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20,
      onLog: (m) => logs.push(m)
    })

    // Drive one tick then stop — we only need the stale warning to have fired.
    const runPromise = coordinator.run()
    await wait(80)
    coordinator.stop()
    await runPromise

    expect(logs.some((l) => /has not sent a heartbeat/.test(l) && l.includes(task.id))).toBe(true)
    // Task status must NOT have been auto-failed — logging only.
    expect(db.getTask(task.id)?.status).toBe('dispatched')
  })

  it('records heartbeat by dispatchId on worker heartbeat messages', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]

    const task = db.createTask({ spec: 'work' })
    const ctx = db.createDispatchContext(task.id, 'term_a')

    const coordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20
    })

    const runPromise = coordinator.run()

    db.insertMessage({
      from: 'term_a',
      to: 'coord',
      subject: 'alive',
      type: 'heartbeat',
      payload: JSON.stringify({ taskId: task.id, dispatchId: ctx.id, phase: 'implementing' })
    })

    await wait(80)

    expect(db.getDispatchContext(task.id)?.last_heartbeat_at).toBeTruthy()

    // Complete the task so the coordinator run finishes cleanly.
    insertWorkerDone(db, { taskId: task.id })

    const result = await runPromise
    expect(result.status).toBe('completed')
  })

  it('ignores stale worker_done from a failed retry before accepting the active dispatch', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    const logs: string[] = []

    const task = db.createTask({ spec: 'retry-sensitive work' })
    const staleCtx = db.createDispatchContext(task.id, 'term_old')
    db.failDispatch(staleCtx.id, 'retry elsewhere')
    const activeCtx = db.createDispatchContext(task.id, 'term_current')

    db.insertMessage({
      from: 'term_old',
      to: 'coord',
      subject: 'Late done',
      type: 'worker_done',
      payload: JSON.stringify({ taskId: task.id, dispatchId: staleCtx.id })
    })

    const staleCoordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20,
      onLog: (m) => logs.push(m)
    })
    const staleRun = staleCoordinator.run()
    await wait(80)
    staleCoordinator.stop()
    await staleRun

    expect(db.getTask(task.id)?.status).toBe('dispatched')
    expect(db.getDispatchContextById(staleCtx.id)?.status).toBe('failed')
    expect(db.getDispatchContextById(activeCtx.id)?.status).toBe('dispatched')
    expect(logs.some((m) => m.includes('inactive dispatch'))).toBe(true)

    insertWorkerDone(db, {
      taskId: task.id,
      from: 'term_current',
      dispatchId: activeCtx.id
    })
    const completionCoordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20
    })
    const result = await completionCoordinator.run()

    expect(result.status).toBe('completed')
    expect(db.getTask(task.id)?.status).toBe('completed')
    expect(db.getDispatchContextById(activeCtx.id)?.status).toBe('completed')
  })

  it('accepts worker_done pane provenance after an assignee handle changes', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    const logs: string[] = []

    const task = db.createTask({ spec: 'owned work' })
    const leafId = '11111111-1111-4111-8111-111111111111'
    const ctx = db.createDispatchContext(task.id, 'term_owner', `tab_before:${leafId}`)

    db.insertMessage({
      from: 'term_reminted',
      to: 'coord',
      subject: 'Done after restart',
      type: 'worker_done',
      payload: JSON.stringify({ taskId: task.id, dispatchId: ctx.id }),
      senderPaneKey: `tab_after:${leafId}`
    })

    const coordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20,
      onLog: (m) => logs.push(m)
    })
    const result = await coordinator.run()

    expect(result.status).toBe('completed')
    expect(db.getTask(task.id)?.status).toBe('completed')
    expect(db.getDispatchContextById(ctx.id)?.status).toBe('completed')
    expect(logs.some((m) => m.includes('Task') && m.includes('completed'))).toBe(true)
  })

  it('can be stopped', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    db.createTask({ spec: 'never finishes' })

    const coordinator = makeCoordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50
    })

    const runPromise = coordinator.run()

    await wait(100)
    coordinator.stop()

    const result = await runPromise
    expect(result.status).toBe('failed')
  })

  describe('stale-base dispatch guard', () => {
    it('threads drift into the preamble when behind > 0 and under threshold', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
      runtime.setProbeDrift({
        base: 'origin/main',
        behind: 5,
        recentSubjects: ['fix A', 'fix B', 'fix C']
      })

      const task = db.createTask({ spec: 'do the work' })

      const coordinator = makeCoordinator(db, runtime, {
        spec: 'go',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        worktree: 'wt1'
      })

      const runPromise = coordinator.run()
      await wait(100)

      insertWorkerDone(db, { taskId: task.id })

      const result = await runPromise
      expect(result.status).toBe('completed')
      expect(runtime.probeDriftCalls).toContain('wt1')
      const sent = runtime.sentMessages.find((m) => m.handle === 'term_a')
      expect(sent).toBeDefined()
      expect(sent!.text).toContain('--- BASE DRIFT ---')
      expect(sent!.text).toContain('5 commits behind origin/main')
      expect(sent!.text).toContain('fix A')
    })

    it('silently skips dispatch when drift > threshold and allow-stale-base is absent', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
      runtime.setProbeDrift({
        base: 'origin/main',
        behind: DISPATCH_STALE_THRESHOLD + 10,
        recentSubjects: ['fix A']
      })

      const task = db.createTask({ spec: 'do the work' })

      const coordinator = makeCoordinator(db, runtime, {
        spec: 'go',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        worktree: 'wt1'
      })

      const runPromise = coordinator.run()
      await wait(250)
      coordinator.stop()
      const result = await runPromise

      // Why: silent-skip must NOT burn the circuit-breaker budget. Task must
      // stay in `ready`; failDispatch must NOT be called; no prompt injection
      // should happen; no dispatch context should exist.
      expect(runtime.sentMessages).toHaveLength(0)
      expect(db.getTask(task.id)?.status).toBe('ready')
      expect(db.getDispatchContext(task.id)).toBeUndefined()
      // Coordinator was stopped externally, so overall status is 'failed'
      // because tasks are not complete — but the task itself never dispatched.
      expect(result.status).toBe('failed')
      expect(result.failedTasks).not.toContain(task.id)
    })

    it('proceeds with stripped spec + drift section when allow-stale-base overrides', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
      runtime.setProbeDrift({
        base: 'origin/main',
        behind: 200,
        recentSubjects: ['commit 1', 'commit 2']
      })

      const spec = `Investigate issue #42
allow-stale-base: true`
      const task = db.createTask({ spec })

      const coordinator = makeCoordinator(db, runtime, {
        spec: 'go',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        worktree: 'wt1'
      })

      const runPromise = coordinator.run()
      await wait(100)

      insertWorkerDone(db, { taskId: task.id })

      const result = await runPromise
      expect(result.status).toBe('completed')
      const sent = runtime.sentMessages.find((m) => m.handle === 'term_a')
      expect(sent).toBeDefined()
      expect(sent!.text).toContain('--- BASE DRIFT ---')
      expect(sent!.text).toContain('200 commits behind origin/main')
      // Why (§3.4): stripped spec must not contain the infra flag line.
      expect(sent!.text).toContain('Investigate issue #42')
      expect(sent!.text).not.toContain('allow-stale-base: true')
    })

    it('proceeds without drift section when probeWorktreeDrift returns null', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
      runtime.setProbeDrift(null)

      const task = db.createTask({ spec: 'do the work' })

      const coordinator = makeCoordinator(db, runtime, {
        spec: 'go',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        worktree: 'wt1'
      })

      const runPromise = coordinator.run()
      await wait(100)

      insertWorkerDone(db, { taskId: task.id })

      const result = await runPromise
      expect(result.status).toBe('completed')
      const sent = runtime.sentMessages.find((m) => m.handle === 'term_a')
      expect(sent).toBeDefined()
      expect(sent!.text).not.toContain('--- BASE DRIFT ---')
    })

    it('does not call probeWorktreeDrift when coordinator has no worktree selector', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
      const logs: string[] = []

      const task = db.createTask({ spec: 'do the work' })

      const coordinator = makeCoordinator(db, runtime, {
        spec: 'go',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        // worktree deliberately omitted
        onLog: (msg) => logs.push(msg)
      })

      const runPromise = coordinator.run()
      await wait(100)

      insertWorkerDone(db, { taskId: task.id })

      const result = await runPromise
      expect(result.status).toBe('completed')
      expect(runtime.probeDriftCalls).toHaveLength(0)
      expect(logs.some((m) => m.includes('stale-base guard inert'))).toBe(true)
      // Dispatch still went through normally.
      expect(runtime.sentMessages.length).toBeGreaterThan(0)
    })

    it('proceeds without drift when probeWorktreeDrift throws', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
      runtime.throwProbeDrift = new Error('boom')

      const task = db.createTask({ spec: 'do the work' })

      const coordinator = makeCoordinator(db, runtime, {
        spec: 'go',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        worktree: 'wt1'
      })

      const runPromise = coordinator.run()
      await wait(100)

      insertWorkerDone(db, { taskId: task.id })

      const result = await runPromise
      expect(result.status).toBe('completed')
      const sent = runtime.sentMessages.find((m) => m.handle === 'term_a')
      expect(sent!.text).not.toContain('--- BASE DRIFT ---')
    })
  })
})

describe('parseAllowStaleBaseFromSpec', () => {
  it('matches canonical form on its own line and strips it', () => {
    const spec = `Do the work
allow-stale-base: true`
    const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(spec)
    expect(allowStale).toBe(true)
    expect(strippedSpec).toBe('Do the work\n')
    expect(strippedSpec).not.toContain('allow-stale-base')
  })

  it('matches case-insensitively', () => {
    const spec = `Do the work
Allow-Stale-Base: TRUE`
    const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(spec)
    expect(allowStale).toBe(true)
    expect(strippedSpec).not.toMatch(/[Aa]llow-[Ss]tale-[Bb]ase/)
  })

  it('does not match allow-stale-base: false', () => {
    const spec = `Do the work
allow-stale-base: false`
    const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(spec)
    expect(allowStale).toBe(false)
    expect(strippedSpec).toBe(spec)
  })

  it('does not match allow-stale-base: truthy', () => {
    const spec = `Do the work
allow-stale-base: truthy`
    const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(spec)
    expect(allowStale).toBe(false)
    expect(strippedSpec).toBe(spec)
  })

  it('does not match the flag embedded inside a sentence', () => {
    const spec = 'we allow-stale-base: true sometimes'
    const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(spec)
    expect(allowStale).toBe(false)
    expect(strippedSpec).toBe(spec)
  })

  it('handles the flag as the last line with no trailing newline', () => {
    const spec = 'line 1\nallow-stale-base: true'
    const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(spec)
    expect(allowStale).toBe(true)
    expect(strippedSpec).toBe('line 1\n')
    expect(strippedSpec.endsWith('allow-stale-base: true')).toBe(false)
  })
})
