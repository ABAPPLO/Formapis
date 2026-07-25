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
  ArrowLeft,
  Clock,
  Download,
  Play,
  Square,
  Trash2,
  Workflow as WorkflowIcon,
  X
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
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { decodeAssigneeFromSpec } from '../../../../shared/scenario-yaml'
import type { ScenarioRecord } from '../../../../shared/scenario-yaml'
import { TaskNode, type TaskNodeData } from './TaskNode'
import { layoutDag } from './layout'

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
  const [agentYaml, setAgentYaml] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [history, setHistory] = useState<WorkflowHistorySummary[]>([])
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)

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
      if (!data?.assignee) {
        return
      }
      setSelectedAgent(data.assignee)
      setAgentYaml(null)
      try {
        const yaml = await window.api.agentsYaml.read(data.assignee)
        if (mountedRef.current) {
          setAgentYaml(yaml)
        }
      } catch {
        if (mountedRef.current) {
          setAgentYaml(null)
        }
      }
    },
    [mountedRef]
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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <Button variant="ghost" size="icon" className="size-7" onClick={closeWorkflowPage}>
          <ArrowLeft className="size-4" />
        </Button>
        <WorkflowIcon className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Workflow</h2>
        <Badge variant="outline">{tasks.length} tasks</Badge>
        {running ? <Badge className="bg-amber-500/15 text-amber-600">running</Badge> : null}
        {polling ? <span className="text-xs text-muted-foreground/50">syncing…</span> : null}

        <div className="ml-auto flex items-center gap-2">
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
        </div>
      </header>

      {/* Status bar */}
      {tasks.length > 0 ? (
        <div className="flex gap-2 border-b px-4 py-1 text-xs text-muted-foreground">
          {Object.entries(statusCounts).map(([status, count]) => (
            <span key={status} className="flex items-center gap-1">
              <span className={cn('size-1.5 rounded-full', statusDotClass(status))} />
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
                <button
                  key={h.id}
                  type="button"
                  onClick={() => void handleViewHistory(h.id)}
                  className={cn(
                    'group flex w-full flex-col gap-1 border-b px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50',
                    selectedHistoryId === h.id && 'bg-primary/5'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate font-medium">{h.scenarioName}</span>
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        h.status === 'completed'
                          ? 'bg-emerald-500'
                          : h.status === 'failed'
                            ? 'bg-red-500'
                            : h.status === 'partial'
                              ? 'bg-amber-500'
                              : 'bg-blue-500'
                      )}
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
                  <span
                    className="mt-0.5 hidden items-center gap-1 text-destructive group-hover:flex"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDeleteHistory(h.id)
                    }}
                  >
                    <Trash2 className="size-3" /> Delete
                  </span>
                </button>
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

        {/* Agent YAML side panel */}
        {selectedAgent ? (
          <aside className="absolute right-0 top-0 flex h-full w-96 flex-col border-l bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-sm font-medium">{selectedAgent}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => {
                  setSelectedAgent(null)
                  setAgentYaml(null)
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-sleek">
              {agentYaml !== null ? (
                <pre className="p-4 font-mono text-xs">{agentYaml}</pre>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  Agent &quot;{selectedAgent}&quot; has no saved YAML definition. It may have been
                  created via CLI without a Formapis agent YAML.
                </p>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
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

function statusDotClass(status: string): string {
  switch (status) {
    case 'pending':
      return 'bg-muted-foreground/40'
    case 'ready':
      return 'bg-blue-500'
    case 'dispatched':
      return 'bg-amber-500 animate-pulse'
    case 'blocked':
      return 'bg-purple-500'
    case 'completed':
      return 'bg-emerald-500'
    case 'failed':
      return 'bg-red-500'
    default:
      return 'bg-muted-foreground/40'
  }
}
