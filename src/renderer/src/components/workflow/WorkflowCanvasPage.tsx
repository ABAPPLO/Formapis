/* eslint-disable max-lines -- Why: WorkflowCanvasPage combines the DAG canvas, agent YAML side panel, and export in one surface; splitting would break the click-node→see-YAML→export loop. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeMouseHandler
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Blocks,
  Clock,
  Download,
  Play,
  Square,
  Trash2,
  Workflow as WorkflowIcon
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { decodeAssigneeFromSpec } from '../../../../shared/scenario-yaml'
import type { ScenarioRecord } from '../../../../shared/scenario-yaml'
import { TaskNode, type TaskNodeData } from './TaskNode'
import { layoutDag } from './layout'
import { WorkflowNodesEditorSheet } from '../workflow-nodes-yaml/WorkflowNodesEditorSheet'
import { WorkbenchShell } from '../workbench/WorkbenchShell'
import { taskStatusStyle } from '../workbench/task-status-style'
import { ConfirmDeleteDialog } from '../workbench/ConfirmDeleteDialog'
import { YamlEditor } from '../workbench/YamlEditor'

const POLL_INTERVAL_MS = 2000

type WorkflowHistorySummary = {
  id: string
  scenarioName: string
  startedAt: string
  capturedAt: string
  status: 'running' | 'completed' | 'failed' | 'partial'
  taskCount: number
  completedCount: number
  failedCount: number
  agentRefs: string[]
}

type WorkflowHistoryRecord = WorkflowHistorySummary & {
  tasks: {
    id: string
    taskTitle: string
    assignee: string
    spec: string
    status: string
    deps: string[]
    result: string | null
  }[]
  scenarioYaml: string
}

type OrchestrationTask = {
  id: string
  task_title: string | null
  spec: string
  status: 'pending' | 'ready' | 'dispatched' | 'completed' | 'failed' | 'blocked'
  deps: string
  assignee_handle?: string | null
}

type SidePanelMode = 'task' | 'nodes' | null

export default function WorkflowCanvasPage(): React.JSX.Element {
  const closeWorkflowPage = useAppStore((s) => s.closeTaskBoardPage)
  const settings = useAppStore((s) => s.settings)
  const mountedRef = useMountedRef()
  const [scenarios, setScenarios] = useState<ScenarioRecord[]>([])
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null)
  const [tasks, setTasks] = useState<OrchestrationTask[]>([])
  const [running, setRunning] = useState(false)
  const [polling, setPolling] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<OrchestrationTask | null>(null)
  const [sidePanel, setSidePanel] = useState<SidePanelMode>(null)
  const [agentYaml, setAgentYaml] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [history, setHistory] = useState<WorkflowHistorySummary[]>([])
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [deleteHistoryId, setDeleteHistoryId] = useState<string | null>(null)

  const loadHistory = useCallback(async (): Promise<void> => {
    try {
      const target = getActiveRuntimeTarget(settings)
      const result = await callRuntimeRpc<{ items: WorkflowHistorySummary[] }>(
        target,
        'workflow-history.list',
        {}
      ).catch(() => ({ items: [] as WorkflowHistorySummary[] }))
      // The RPC returns an array directly, not wrapped in {items}
      const list =
        (result as unknown as WorkflowHistorySummary[]) ??
        (result as { items?: WorkflowHistorySummary[] }).items ??
        []
      if (mountedRef.current) {
        setHistory(Array.isArray(list) ? list : [])
      }
    } catch {
      // silent
    }
  }, [mountedRef, settings])

  const loadScenarios = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.scenarios.list()
      if (mountedRef.current) {
        setScenarios(list)
      }
    } catch {
      // silent
    }
  }, [mountedRef])

  const pollTasks = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) {
      return
    }
    setPolling(true)
    try {
      const target = getActiveRuntimeTarget(settings)
      const result = await callRuntimeRpc<{ tasks: OrchestrationTask[] }>(
        target,
        'orchestration.taskList',
        {}
      ).catch(() => ({ tasks: [] }))
      if (mountedRef.current) {
        setTasks(result.tasks ?? [])
      }
    } finally {
      if (mountedRef.current) {
        setPolling(false)
      }
    }
  }, [mountedRef, settings])

  useEffect(() => {
    void loadScenarios()
    void loadHistory()
    void pollTasks()
    const interval = setInterval(() => void pollTasks(), POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [loadScenarios, loadHistory, pollTasks])

  const handleLaunch = async (): Promise<void> => {
    if (!selectedScenario) {
      return
    }
    setLaunching(true)
    try {
      const result = await window.api.scenarios.launch(selectedScenario)
      if (!result.ok) {
        toast.error('Launch failed', { description: result.error })
        return
      }
      const target = getActiveRuntimeTarget(settings)
      await callRuntimeRpc(target, 'orchestration.run', {
        spec: `Scenario: ${result.scenarioName}`,
        from: 'formapis',
        maxConcurrent: result.taskIds.length
      })
      setRunning(true)
      toast.success(`Launched ${result.taskIds.length} tasks`)
      await pollTasks()
    } catch (error) {
      toast.error('Launch failed', { description: String(error) })
    } finally {
      if (mountedRef.current) {
        setLaunching(false)
      }
    }
  }

  const handleStop = async (): Promise<void> => {
    try {
      const target = getActiveRuntimeTarget(settings)
      await callRuntimeRpc(target, 'orchestration.runStop', {})
      setRunning(false)
      toast.success('Stopped')
    } catch (error) {
      toast.error('Stop failed', { description: String(error) })
    }
  }

  const handleExport = async (): Promise<void> => {
    try {
      const target = getActiveRuntimeTarget(settings)
      const result = await callRuntimeRpc<{
        yaml: string
        scenarioName: string
        agentRefs: string[]
        taskCount: number
        historyId: string
      }>(target, 'orchestration.exportYaml', {})
      // Download file
      const blob = new Blob([result.yaml], { type: 'text/yaml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${result.scenarioName}.yaml`
      a.click()
      URL.revokeObjectURL(url)
      // Save to Scenario library so it appears in the selector and can be re-run
      await window.api.scenarios.save(result.scenarioName, result.yaml)
      await loadScenarios()
      await loadHistory()
      toast.success(
        `Exported ${result.taskCount} tasks / ${result.agentRefs.length} agents (saved to scenarios + history)`
      )
    } catch (error) {
      toast.error('Export failed', { description: String(error) })
    }
  }

  const handleViewHistory = useCallback(
    async (historyId: string): Promise<void> => {
      try {
        const target = getActiveRuntimeTarget(settings)
        const record = await callRuntimeRpc<WorkflowHistoryRecord>(
          target,
          'workflow-history.read',
          { id: historyId }
        )
        if (mountedRef.current) {
          setSelectedHistoryId(historyId)
          // Load historical tasks into the canvas for re-inspection
          setTasks(
            record.tasks.map((t) => ({
              id: t.id,
              task_title: t.taskTitle,
              spec: `assignee: ${t.assignee}\n${t.spec}`,
              status: t.status as OrchestrationTask['status'],
              deps: JSON.stringify(t.deps)
            }))
          )
          toast.info(`Viewing history: ${record.scenarioName}`)
        }
      } catch (error) {
        toast.error('Could not load history', { description: String(error) })
      }
    },
    [mountedRef, settings]
  )

  const handleDeleteHistory = async (historyId: string): Promise<void> => {
    try {
      const target = getActiveRuntimeTarget(settings)
      await callRuntimeRpc(target, 'workflow-history.remove', { id: historyId })
      await loadHistory()
      if (selectedHistoryId === historyId) {
        setSelectedHistoryId(null)
      }
      toast.success('History deleted')
    } catch (error) {
      toast.error('Delete failed', { description: String(error) })
    }
  }

  const handleNodeClick: NodeMouseHandler = useCallback(
    async (_event, node: Node) => {
      const data = node.data as TaskNodeData | undefined
      // Always surface the clicked task's own details; resolve the full task
      // row from the polled list so the panel shows real spec/deps/status.
      const task = tasks.find((t) => t.id === node.id) ?? null
      setSelectedTask(task)
      setSidePanel('task')
      const assignee = data?.assignee && data.assignee !== 'unknown' ? data.assignee : null
      setSelectedAgent(assignee)
      setAgentYaml(null)
      if (!assignee) {
        return
      }
      try {
        const yaml = await window.api.agentsYaml.read(assignee)
        if (mountedRef.current) {
          setAgentYaml(yaml)
        }
      } catch {
        if (mountedRef.current) {
          setAgentYaml(null)
        }
      }
    },
    [mountedRef, tasks]
  )

  // Build ReactFlow nodes + edges from orchestration tasks.
  const { nodes, edges } = useMemo(() => {
    const taskById = new Map<string, OrchestrationTask>()
    for (const t of tasks) {
      taskById.set(t.id, t)
      if (t.task_title) {
        taskById.set(t.task_title, t)
      }
    }

    const rawNodes: Node[] = tasks.map((t) => {
      const { assignee, strippedSpec } = decodeAssigneeFromSpec(t.spec)
      const data: TaskNodeData = {
        label: t.task_title || t.id,
        assignee: assignee ?? 'unknown',
        status: t.status,
        specSummary: strippedSpec.slice(0, 80)
      }
      return {
        id: t.id,
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data
      }
    })

    const rawEdges: Edge[] = []
    for (const t of tasks) {
      const deps = safeParseDeps(t.deps)
      for (const dep of deps) {
        const depTask = taskById.get(dep)
        const sourceId = depTask ? depTask.id : dep
        if (taskById.has(sourceId) || tasks.some((x) => x.id === sourceId)) {
          rawEdges.push({
            id: `${sourceId}->${t.id}`,
            source: sourceId,
            target: t.id,
            animated: t.status === 'dispatched',
            className: 'stroke-amber-500/60'
          })
        }
      }
    }

    const positioned = layoutDag(rawNodes, rawEdges)
    return { nodes: positioned, edges: rawEdges }
  }, [tasks])

  const nodeTypes = useMemo(() => ({ taskNode: TaskNode }), [])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of tasks) {
      counts[t.status] = (counts[t.status] ?? 0) + 1
    }
    return counts
  }, [tasks])

  const deleteHistoryName = history.find((h) => h.id === deleteHistoryId)?.scenarioName ?? ''

  return (
    <WorkbenchShell
      title="Workflow"
      icon={<WorkflowIcon className="size-5" />}
      onBack={closeWorkflowPage}
      badge={
        <>
          <Badge variant="outline">{tasks.length} tasks</Badge>
          {running ? <Badge className="bg-amber-500/15 text-amber-600">running</Badge> : null}
        </>
      }
      toolbar={
        <>
          {polling ? <span className="text-xs text-muted-foreground/50">syncing…</span> : null}
          <Select
            value={selectedScenario ?? ''}
            onValueChange={(v) => setSelectedScenario(v || null)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select scenario" />
            </SelectTrigger>
            <SelectContent>
              {scenarios.map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  {s.name} ({s.taskCount} tasks)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {running ? (
            <Button size="sm" variant="outline" onClick={() => void handleStop()}>
              <Square className="mr-1.5 size-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void handleLaunch()}
              disabled={launching || !selectedScenario}
            >
              <Play className="mr-1.5 size-3.5" />
              Run
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleExport()}
            disabled={tasks.length === 0}
          >
            <Download className="mr-1.5 size-3.5" />
            Export YAML
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelectedTask(null)
              setSelectedAgent(null)
              setAgentYaml(null)
              setSidePanel('nodes')
            }}
          >
            <Blocks className="mr-1.5 size-3.5" />
            Nodes
          </Button>
        </>
      }
    >
      {/* Status bar */}
      {tasks.length > 0 ? (
        <div className="flex gap-2 border-b px-4 py-1 text-xs text-muted-foreground">
          {Object.entries(statusCounts).map(([status, count]) => (
            <span key={status} className="flex items-center gap-1">
              <span className={cn('size-1.5 rounded-full', taskStatusStyle(status).dot)} />
              {status}: {count}
            </span>
          ))}
        </div>
      ) : null}

      {/* Canvas + side panel */}
      <div className="relative flex min-h-0 flex-1">
        {/* History sidebar */}
        <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/20">
          <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Clock className="mr-1 inline size-3" />
            History ({history.length})
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-sleek">
            {history.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground/60">
                No runs yet. Export a workflow to capture its history.
              </p>
            ) : (
              history.map((h) => (
                <div
                  key={h.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void handleViewHistory(h.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      void handleViewHistory(h.id)
                    }
                  }}
                  className={cn(
                    'group flex w-full flex-col gap-1 border-b px-3 py-2 text-left text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    selectedHistoryId === h.id && 'bg-accent'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{h.scenarioName}</span>
                    <span
                      className={cn('size-2 shrink-0 rounded-full', historyRunDotClass(h.status))}
                    />
                  </div>
                  <span className="text-muted-foreground">
                    {h.completedCount}/{h.taskCount} done
                    {h.failedCount > 0 ? `, ${h.failedCount} failed` : ''}
                  </span>
                  <span className="text-muted-foreground/50">
                    {new Date(h.capturedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  {h.agentRefs.length > 0 ? (
                    <span className="truncate text-muted-foreground/40">
                      {h.agentRefs.join(', ')}
                    </span>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="mt-0.5 size-6 self-start text-muted-foreground hover:text-destructive"
                    aria-label={`Delete run ${h.scenarioName}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteHistoryId(h.id)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Canvas */}
        <div className="flex-1">
          {nodes.length > 0 ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={handleNodeClick}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <WorkflowIcon className="size-12 opacity-30" />
              <p className="text-sm">No active workflow. Select a scenario and click Run.</p>
              <p className="text-xs text-muted-foreground/60">
                Or use <code className="rounded bg-muted px-1">orca orchestration task-create</code>{' '}
                to add tasks via CLI.
              </p>
            </div>
          )}
        </div>

        {/* Right-side detail/nodes panel as a single edge-sliding Sheet. */}
        <Sheet
          open={sidePanel !== null}
          onOpenChange={(o) => {
            if (!o) {
              setSidePanel(null)
            }
          }}
        >
          <SheetContent side="right" className="flex flex-col gap-0 p-0">
            <SheetHeader className="flex flex-row items-center justify-between space-y-0 border-b px-4 py-2.5">
              <SheetTitle className="truncate text-sm">
                {sidePanel === 'task'
                  ? ((selectedTask?.task_title || selectedTask?.id) ?? 'Task')
                  : 'Workflow Nodes'}
              </SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
              {sidePanel === 'task' && selectedTask ? (
                <TaskDetailBody task={selectedTask} agent={selectedAgent} yaml={agentYaml} />
              ) : null}
              {sidePanel === 'nodes' ? (
                <WorkflowNodesEditorSheet open onAddedToCanvas={() => void pollTasks()} />
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <ConfirmDeleteDialog
        open={deleteHistoryId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteHistoryId(null)
          }
        }}
        title={`Delete run "${deleteHistoryName}"?`}
        onConfirm={async () => {
          if (deleteHistoryId) {
            await handleDeleteHistory(deleteHistoryId)
          }
          setDeleteHistoryId(null)
        }}
      />
    </WorkbenchShell>
  )
}

function TaskDetailBody({
  task,
  agent,
  yaml
}: {
  task: OrchestrationTask
  agent: string | null
  yaml: string | null
}): React.JSX.Element {
  const deps = safeParseDeps(task.deps)
  const strippedSpec = decodeAssigneeFromSpec(task.spec).strippedSpec
  return (
    <div className="flex flex-col">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 p-4 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd className="font-medium">{task.status}</dd>
        <dt className="text-muted-foreground">Assignee</dt>
        <dd className="font-medium">
          {agent ?? <span className="text-muted-foreground">no assignee</span>}
        </dd>
        {deps.length > 0 ? (
          <>
            <dt className="text-muted-foreground">Deps</dt>
            <dd className="font-mono text-xs">{deps.join(', ')}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Spec</dt>
        <dd>
          <pre className="whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono text-xs">
            {strippedSpec}
          </pre>
        </dd>
      </dl>
      {agent ? (
        <div className="border-t">
          <div className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Agent YAML — {agent}
          </div>
          {yaml !== null ? (
            <div className="h-[360px] px-4 pb-4">
              <YamlEditor value={yaml} onChange={() => {}} readOnly placeholder="No saved YAML" />
            </div>
          ) : (
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              No saved YAML for agent &quot;{agent}&quot;.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

// Why: history run status uses a different enum than live tasks; keep its dot colors explicit.
function historyRunDotClass(status: WorkflowHistorySummary['status']): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500'
    case 'failed':
      return 'bg-red-500'
    case 'partial':
      return 'bg-amber-500'
    default:
      return 'bg-blue-500' // running
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
