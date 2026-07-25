import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomically } from './codex-accounts/fs-utils'
import { decodeAssigneeFromSpec } from '../shared/scenario-yaml'

/**
 * Workflow execution history — persisted independently of the orchestration DB
 * so it survives resetTasks() (which wipes coordinator_runs + tasks).
 *
 * Each record is a JSON snapshot of one orchestration run: the task DAG with
 * final statuses/results, the agents involved, and the exported Scenario YAML.
 * Stored at ~/.formapis/workflow-history/<id>.json.
 *
 * Lifecycle:
 *   - saveWorkflowSnapshot(): called after a run completes (or on export),
 *     captures the current DB state into a history record.
 *   - listWorkflowHistory(): returns summaries for the history sidebar.
 *   - readWorkflowHistory(id): returns the full snapshot for re-inspection.
 */

const HISTORY_SUBDIR = 'workflow-history'

export type WorkflowTaskSnapshot = {
  id: string
  taskTitle: string
  assignee: string
  spec: string
  status: string
  deps: string[]
  result: string | null
  createdAt: string
  completedAt: string | null
}

export type WorkflowHistoryRecord = {
  id: string
  scenarioName: string
  startedAt: string
  capturedAt: string
  status: 'running' | 'completed' | 'failed' | 'partial'
  taskCount: number
  completedCount: number
  failedCount: number
  agentRefs: string[]
  tasks: WorkflowTaskSnapshot[]
  /** The exported Scenario YAML (so the run can be re-executed). */
  scenarioYaml: string
}

export type WorkflowHistorySummary = {
  id: string
  scenarioName: string
  startedAt: string
  capturedAt: string
  status: WorkflowHistoryRecord['status']
  taskCount: number
  completedCount: number
  failedCount: number
  agentRefs: string[]
}

export function getWorkflowHistoryDir(homeDir: string = homedir()): string {
  return join(homeDir, '.formapis', HISTORY_SUBDIR)
}

/** Capture the current orchestration DB state into a history record. */
export function saveWorkflowSnapshot(args: {
  scenarioName: string
  startedAt: string
  tasks: {
    id: string
    task_title: string | null
    spec: string
    status: string
    deps: string
    result: string | null
    created_at: string
    completed_at: string | null
  }[]
  scenarioYaml: string
  homeDir?: string
}): WorkflowHistoryRecord {
  const homeDir = args.homeDir ?? homedir()
  const dir = getWorkflowHistoryDir(homeDir)
  mkdirSync(dir, { recursive: true })

  const taskSnapshots: WorkflowTaskSnapshot[] = args.tasks.map((t) => {
    const { assignee, strippedSpec } = decodeAssigneeFromSpec(t.spec)
    return {
      id: t.id,
      taskTitle: t.task_title || t.id,
      assignee: assignee ?? 'unknown',
      spec: strippedSpec.trim(),
      status: t.status,
      deps: safeParseDeps(t.deps),
      result: t.result,
      createdAt: t.created_at,
      completedAt: t.completed_at
    }
  })

  const agentRefs = Array.from(
    new Set(taskSnapshots.map((t) => t.assignee).filter((a) => a !== 'unknown'))
  ).sort()

  const completedCount = taskSnapshots.filter((t) => t.status === 'completed').length
  const failedCount = taskSnapshots.filter((t) => t.status === 'failed').length
  const status: WorkflowHistoryRecord['status'] =
    failedCount > 0
      ? completedCount === taskSnapshots.length
        ? 'completed'
        : 'partial'
      : completedCount === taskSnapshots.length
        ? 'completed'
        : 'running'

  const capturedAt = new Date().toISOString()
  const id = `wf-${createHash('sha1').update(`${args.scenarioName}:${args.startedAt}`).digest('hex').slice(0, 12)}`

  const record: WorkflowHistoryRecord = {
    id,
    scenarioName: args.scenarioName,
    startedAt: args.startedAt,
    capturedAt,
    status,
    taskCount: taskSnapshots.length,
    completedCount,
    failedCount,
    agentRefs,
    tasks: taskSnapshots,
    scenarioYaml: args.scenarioYaml
  }

  writeFileAtomically(join(dir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

/** List all workflow history records (newest first), summaries only. */
export function listWorkflowHistory(homeDir: string = homedir()): WorkflowHistorySummary[] {
  const dir = getWorkflowHistoryDir(homeDir)
  if (!existsSync(dir)) {
    return []
  }
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const records: WorkflowHistorySummary[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue
    }
    const record = safeReadRecord<WorkflowHistoryRecord>(join(dir, entry))
    if (record) {
      records.push({
        id: record.id,
        scenarioName: record.scenarioName,
        startedAt: record.startedAt,
        capturedAt: record.capturedAt,
        status: record.status,
        taskCount: record.taskCount,
        completedCount: record.completedCount,
        failedCount: record.failedCount,
        agentRefs: record.agentRefs
      })
    }
  }
  records.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
  return records
}

/** Read one full history record (includes task snapshots + scenario YAML). */
export function readWorkflowHistory(
  id: string,
  homeDir: string = homedir()
): WorkflowHistoryRecord | null {
  const filePath = join(getWorkflowHistoryDir(homeDir), `${id}.json`)
  return safeReadRecord<WorkflowHistoryRecord>(filePath)
}

/** Delete a history record. */
export function removeWorkflowHistory(id: string, homeDir: string = homedir()): void {
  const filePath = join(getWorkflowHistoryDir(homeDir), `${id}.json`)
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true })
  }
}

function safeReadRecord<T>(filePath: string): T | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as T
    }
  } catch {
    // fall through
  }
  return null
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
