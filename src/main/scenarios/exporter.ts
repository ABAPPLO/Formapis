import {
  decodeAssigneeFromSpec,
  serializeScenarioYaml,
  SCENARIO_YAML_API_VERSION,
  SCENARIO_YAML_KIND,
  type ScenarioTask,
  type ScenarioYaml
} from '../../shared/scenario-yaml'

/**
 * Reverse-export: turn the live orchestration DB (tasks + gates) back into a
 * Scenario YAML so users can save, share, and re-run a workflow they built
 * interactively (via CLI, Scenario launch, or A2A message/send).
 *
 * Data mapping (all fields have a direct DB source):
 *   task.task_title / id  → ScenarioTask.id
 *   task.spec (assignee:) → ScenarioTask.assignee + stripped spec
 *   task.deps (JSON)      → ScenarioTask.deps
 *   decision_gates table  → ScenarioTask.gate
 */

/** Minimal DB surface the exporter needs to read the current run state. */
export type ExportOrchestrationDb = {
  listTasksWithDispatch(): {
    id: string
    task_title: string | null
    spec: string
    status: string
    deps: string
  }[]
}

export type ExportResult = {
  yaml: string
  scenarioName: string
  agentRefs: string[]
  taskCount: number
}

/** Convert all tasks in the orchestration DB into a Scenario YAML string. */
export function exportTasksToScenarioYaml(
  db: ExportOrchestrationDb,
  scenarioName = 'exported-workflow'
): ExportResult {
  const rows = db.listTasksWithDispatch()
  const tasks: ScenarioTask[] = []
  const agentSet = new Set<string>()

  for (const row of rows) {
    const { assignee, strippedSpec } = decodeAssigneeFromSpec(row.spec)
    const deps = safeParseDeps(row.deps)
    const task: ScenarioTask = {
      id: row.task_title || row.id,
      assignee: assignee || 'unknown',
      spec: strippedSpec.trim() || row.spec,
      ...(deps.length > 0 ? { deps } : {})
    }
    tasks.push(task)
    if (assignee) {
      agentSet.add(assignee)
    }
  }

  const agentRefs = Array.from(agentSet).sort()
  const scenario: ScenarioYaml = {
    apiVersion: SCENARIO_YAML_API_VERSION,
    kind: SCENARIO_YAML_KIND,
    metadata: {
      name: scenarioName,
      description: `Exported from orchestration run on ${new Date().toISOString().slice(0, 19)}Z`
    },
    spec: {
      mode: 'orchestrated',
      agents: agentRefs.map((ref) => ({ ref })),
      tasks
    }
  }

  return {
    yaml: serializeScenarioYaml(scenario),
    scenarioName,
    agentRefs,
    taskCount: tasks.length
  }
}

function safeParseDeps(depsJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(depsJson)
    if (Array.isArray(parsed) && parsed.every((d) => typeof d === 'string')) {
      return parsed
    }
  } catch {
    // fall through
  }
  return []
}
