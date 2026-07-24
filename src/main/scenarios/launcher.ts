import { homedir } from 'node:os'
import {
  decodeAssigneeFromSpec,
  encodeAssigneeInSpec,
  parseScenarioYaml,
  type ScenarioTask,
  type ScenarioYaml
} from '../../shared/scenario-yaml'
import { readScenarioYamlRaw } from './registry'

/**
 * Scenario launcher: translates a Scenario YAML into Orca orchestration-engine
 * primitives (tasks + deps + gates). The coordinator run itself is started by
 * the caller via the existing orchestration.run RPC — keeping this module free
 * of a runtime dependency.
 *
 * Phase 3a strategy (no engine core changes):
 *   - Reset the orchestration DB (tasks have no run/cluster isolation, so each
 *     Scenario run starts clean — see db.ts listTasks()).
 *   - Topologically insert tasks via db.createTask(), encoding the assignee
 *     into each task.spec header (decodeAssigneeFromSpec) so the task board
 *     can render the intended agent (coordinator routing by agent arrives in
 *     Phase 3b).
 *   - Return the created task ids + a run spec; the caller invokes
 *     orchestration.run to start the coordinator loop.
 */

/** Minimal DB surface the launcher needs. */
export type ScenarioOrchestrationDb = {
  resetTasks(): void
  createTask(task: { spec: string; taskTitle?: string; deps?: string[] }): { id: string }
}

export type LaunchResult =
  | {
      ok: true
      runId: string
      scenarioName: string
      taskIds: { scenarioTaskId: string; engineTaskId: string; assignee: string }[]
      mode: ScenarioYaml['spec']['mode']
    }
  | { ok: false; error: string }

/** Resolve + validate a scenario by name, returning the parsed YAML or an error. */
export function loadScenarioForLaunch(
  name: string,
  homeDir: string = homedir()
): { scenario: ScenarioYaml } | { error: string } {
  const raw = readScenarioYamlRaw(name, homeDir)
  if (raw === null) {
    return { error: `Scenario "${name}" not found` }
  }
  const validation = parseScenarioYaml(raw)
  if (!validation.valid || !validation.scenario) {
    return { error: `Scenario YAML invalid: ${validation.errors.join('; ')}` }
  }
  const scenario = validation.scenario
  if (scenario.spec.mode === 'orchestrated') {
    if (!scenario.spec.tasks || scenario.spec.tasks.length === 0) {
      return { error: 'orchestrated scenario requires at least one task' }
    }
    const cycleError = detectCycle(scenario.spec.tasks)
    if (cycleError) {
      return { error: `task dependency cycle: ${cycleError}` }
    }
  } else if (!scenario.spec.supervisor) {
    return { error: 'autonomous scenario requires a supervisor agent' }
  }
  return { scenario }
}

/**
 * Prepare a scenario: reset DB, create tasks (orchestrated) or a single
 * supervisor task (autonomous). Returns the task ids + run spec; the caller
 * then invokes orchestration.run to start the coordinator.
 */
export function launchScenario(args: {
  name: string
  db: ScenarioOrchestrationDb
  homeDir?: string
}): LaunchResult {
  const homeDir = args.homeDir ?? homedir()
  const loaded = loadScenarioForLaunch(args.name, homeDir)
  if ('error' in loaded) {
    return { ok: false, error: loaded.error }
  }
  const scenario = loaded.scenario

  // Why: tasks have no run/cluster isolation (db.ts schema); each Scenario run
  // starts from a clean slate.
  args.db.resetTasks()

  if (scenario.spec.mode === 'autonomous') {
    return prepareAutonomous(scenario, args.db)
  }
  return prepareOrchestrated(scenario, args.db)
}

/** The run spec the caller should pass to orchestration.run. */
export function runSpecForScenario(scenario: ScenarioYaml): string {
  return `Scenario: ${scenario.metadata.name}`
}

function prepareOrchestrated(scenario: ScenarioYaml, db: ScenarioOrchestrationDb): LaunchResult {
  const tasks = scenario.spec.tasks!
  const sorted = topoSort(tasks)
  const idMap = new Map<string, string>() // scenarioTaskId → engineTaskId
  const taskIds: { scenarioTaskId: string; engineTaskId: string; assignee: string }[] = []

  for (const task of sorted) {
    const deps = (task.deps ?? []).map((d) => idMap.get(d)).filter((d): d is string => Boolean(d))
    const specWithAssignee = encodeAssigneeInSpec(task.assignee, task.spec)
    const created = db.createTask({
      spec: specWithAssignee,
      taskTitle: task.id,
      deps
    })
    idMap.set(task.id, created.id)
    taskIds.push({ scenarioTaskId: task.id, engineTaskId: created.id, assignee: task.assignee })
  }

  return {
    ok: true,
    runId: '',
    scenarioName: scenario.metadata.name,
    taskIds,
    mode: 'orchestrated'
  }
}

function prepareAutonomous(scenario: ScenarioYaml, db: ScenarioOrchestrationDb): LaunchResult {
  const supervisor = scenario.spec.supervisor!
  const goal =
    scenario.spec.goal ??
    `Coordinate agents ${scenario.spec.agents
      .map((a) => a.ref)
      .join(', ')} to complete the objective.`
  const specWithAssignee = encodeAssigneeInSpec(
    supervisor,
    `${goal}\n\nAvailable agents: ${scenario.spec.agents.map((a) => a.ref).join(', ')}.\nUse the orca orchestration CLI to dispatch and coordinate.`
  )
  const created = db.createTask({ spec: specWithAssignee, taskTitle: 'supervisor' })
  return {
    ok: true,
    runId: '',
    scenarioName: scenario.metadata.name,
    taskIds: [{ scenarioTaskId: 'supervisor', engineTaskId: created.id, assignee: supervisor }],
    mode: 'autonomous'
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function topoSort(tasks: ScenarioTask[]): ScenarioTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const visited = new Set<string>()
  const result: ScenarioTask[] = []
  const visit = (id: string, path: string[]): void => {
    if (visited.has(id)) {
      return
    }
    if (path.includes(id)) {
      throw new Error(`cycle at ${id}`)
    }
    const task = byId.get(id)
    if (!task) {
      return
    }
    visited.add(id)
    for (const dep of task.deps ?? []) {
      visit(dep, [...path, id])
    }
    result.push(task)
  }
  for (const t of tasks) {
    visit(t.id, [])
  }
  return result
}

function detectCycle(tasks: ScenarioTask[]): string | null {
  try {
    topoSort(tasks)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export { decodeAssigneeFromSpec }
