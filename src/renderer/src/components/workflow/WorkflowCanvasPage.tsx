/* eslint-disable max-lines -- Why: WorkflowCanvasPage combines the DAG canvas (dual monitor/compose mode), node-template inspector, and export in one surface; splitting would break the click-node→see-template→run loop. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  SelectionMode,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type ReactFlowInstance
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { parse as parseYaml } from 'yaml'
import {
  Blocks,
  ChevronLeft,
  Clock,
  Copy,
  Download,
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
  Upload,
  Workflow as WorkflowIcon
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import {
  decodeAssigneeFromSpec,
  serializeScenarioYaml,
  SCENARIO_YAML_API_VERSION,
  SCENARIO_YAML_KIND
} from '../../../../shared/scenario-yaml'
import type { ScenarioRecord, ScenarioTask, ScenarioYaml } from '../../../../shared/scenario-yaml'
import { TaskNode, type TaskNodeData } from './TaskNode'
import { layoutDag } from './layout'
import { WorkflowNodesEditorSheet } from '../workflow-nodes-yaml/WorkflowNodesEditorSheet'
import { WorkbenchShell } from '../workbench/WorkbenchShell'
import { taskStatusStyle } from '../workbench/task-status-style'
import { ConfirmDeleteDialog } from '../workbench/ConfirmDeleteDialog'
import { YamlEditor } from '../workbench/YamlEditor'
import { AgentPicker } from '../workbench/AgentPicker'

const POLL_INTERVAL_MS = 2000
const DRAFT_STORAGE_KEY = 'formapis:draft-workflow'

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
  // From orchestration.taskList (Task 7): the agent the coordinator actually
  // dispatched to, and any per-task dispatch failure reason.
  resolved_agent?: string | null
  dispatch_error?: string | null
}

type SidePanelMode = 'task' | 'nodes' | null
type CanvasMode = 'monitor' | 'compose'

type DraftNode = Node

function loadDraft(): { nodes: DraftNode[]; edges: Edge[] } {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { nodes?: DraftNode[]; edges?: Edge[] }
      return { nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] }
    }
  } catch {
    // ignore malformed draft
  }
  return { nodes: [], edges: [] }
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
  const [selectedTask, setSelectedTask] = useState<OrchestrationTask | null>(null)
  const [sidePanel, setSidePanel] = useState<SidePanelMode>(null)
  const [nodeTemplateYaml, setNodeTemplateYaml] = useState<string | null | undefined>(undefined)
  const [launching, setLaunching] = useState(false)
  const [history, setHistory] = useState<WorkflowHistorySummary[]>([])
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [deleteHistoryId, setDeleteHistoryId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('compose')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const initialDraft = useMemo(loadDraft, [])
  const [draftNodes, setDraftNodes, onDraftNodesChange] = useNodesState(initialDraft.nodes)
  const [draftEdges, setDraftEdges, onDraftEdgesChange] = useEdgesState(initialDraft.edges)

  // Persist the composed graph so a refresh doesn't lose work.
  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({ nodes: draftNodes, edges: draftEdges })
      )
    } catch {
      // storage full / unavailable — non-fatal
    }
  }, [draftNodes, draftEdges])

  // Compose: keep the authored graph in the same neat dagre layout as the
  // execution view. Re-layout only when structure (node/edge identity) changes,
  // so manual drags persist — drag changes positions, not identity.
  const draftEdgesRef = useRef(draftEdges)
  draftEdgesRef.current = draftEdges
  const draftStructureKey = `${draftNodes.map((n) => n.id).join(',')}|${draftEdges.map((e) => `${e.source}->${e.target}`).join(',')}`
  useEffect(() => {
    setDraftNodes((nds) => {
      if (nds.length === 0) {
        return nds
      }
      const laidById = new Map(layoutDag(nds, draftEdgesRef.current).map((n) => [n.id, n]))
      return nds.map((n) => {
        const laid = laidById.get(n.id)
        // Apply dagre position + the fixed 220px width so draft nodes match the
        // execution nodes (layoutDag sets style.width).
        return laid ? { ...n, position: laid.position, style: laid.style } : n
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-layout only on structure change
  }, [draftStructureKey, setDraftNodes])

  const loadHistory = useCallback(async (): Promise<void> => {
    try {
      const target = getActiveRuntimeTarget(settings)
      const result = await callRuntimeRpc<{ items: WorkflowHistorySummary[] }>(
        target,
        'workflow-history.list',
        {}
      ).catch(() => ({ items: [] as WorkflowHistorySummary[] }))
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
        toastLaunchFailure(result)
        return
      }
      const target = getActiveRuntimeTarget(settings)
      await callRuntimeRpc(target, 'orchestration.run', {
        spec: `Scenario: ${result.scenarioName}`,
        from: 'formapis',
        maxConcurrent: result.taskIds.length
      })
      setRunning(true)
      setCanvasMode('monitor')
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

  // Compose mode: serialize the authored graph into a Scenario YAML (nodes→tasks,
  // edges→deps) and launch it, so the run respects order and matches the composition.
  const buildDraftScenario = useCallback((): { name: string; yaml: string } => {
    const nodeData = (n: DraftNode): TaskNodeData => n.data as TaskNodeData
    const assigneeOf = (n: DraftNode): string => {
      const a = nodeData(n).assignee
      return a && a !== 'unknown' ? a : 'agent'
    }
    const agentRefs = Array.from(new Set(draftNodes.map(assigneeOf)))
    const tasks: ScenarioTask[] = draftNodes.map((n) => {
      const deps = draftEdges.filter((e) => e.target === n.id).map((e) => e.source)
      const t: ScenarioTask = {
        id: n.id,
        assignee: assigneeOf(n),
        spec: nodeData(n).label || n.id
      }
      if (deps.length > 0) {
        t.deps = deps
      }
      return t
    })
    const scenario: ScenarioYaml = {
      apiVersion: SCENARIO_YAML_API_VERSION,
      kind: SCENARIO_YAML_KIND,
      metadata: { name: `draft-${Date.now()}` },
      spec: {
        mode: 'orchestrated',
        agents: agentRefs.map((ref) => ({ ref })),
        tasks
      }
    }
    return { name: scenario.metadata.name, yaml: serializeScenarioYaml(scenario) }
  }, [draftNodes, draftEdges])

  const saveDraftAsScenario = async (): Promise<void> => {
    if (draftNodes.length === 0) {
      toast.error('Add some nodes first')
      return
    }
    try {
      const { name, yaml } = buildDraftScenario()
      await window.api.scenarios.save(name, yaml)
      await loadScenarios()
      toast.success(`Saved as scenario "${name}"`)
    } catch (error) {
      toast.error('Save failed', { description: String(error) })
    }
  }

  const runComposition = async (): Promise<void> => {
    if (draftNodes.length === 0) {
      return
    }
    setLaunching(true)
    try {
      const { name, yaml } = buildDraftScenario()
      await window.api.scenarios.save(name, yaml)
      const result = await window.api.scenarios.launch(name)
      if (!result.ok) {
        toastLaunchFailure(result)
        return
      }
      const target = getActiveRuntimeTarget(settings)
      await callRuntimeRpc(target, 'orchestration.run', {
        spec: `Scenario: ${result.scenarioName}`,
        from: 'formapis',
        maxConcurrent: result.taskIds.length
      })
      setRunning(true)
      setCanvasMode('monitor')
      setSelectedScenario(name)
      await loadScenarios()
      toast.success(`Launched ${result.taskIds.length} tasks`)
      await pollTasks()
    } catch (error) {
      toast.error('Run failed', { description: String(error) })
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
      const blob = new Blob([result.yaml], { type: 'text/yaml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${result.scenarioName}.yaml`
      a.click()
      URL.revokeObjectURL(url)
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
          {
            id: historyId
          }
        )
        if (mountedRef.current) {
          setSelectedHistoryId(historyId)
          setTasks(
            record.tasks.map((t) => ({
              id: t.id,
              task_title: t.taskTitle,
              spec: `assignee: ${t.assignee}\n${t.spec}`,
              status: t.status as OrchestrationTask['status'],
              deps: JSON.stringify(t.deps)
            }))
          )
          setCanvasMode('monitor')
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
      const task = tasks.find((t) => t.id === node.id) ?? null
      setSelectedTask(
        task ??
          ({
            id: node.id,
            task_title: data?.label ?? null,
            spec: '',
            status: 'pending',
            deps: '[]'
          } as OrchestrationTask)
      )
      setSidePanel('task')
      const assignee = data?.assignee && data.assignee !== 'unknown' ? data.assignee : null
      setSelectedAgent(assignee)
      setNodeTemplateYaml(assignee ? undefined : null)
      if (!assignee) {
        return
      }
      try {
        const yaml = await window.api.workflowNodesYaml.read(assignee)
        if (mountedRef.current) {
          setNodeTemplateYaml(yaml && yaml.trim() ? yaml : null)
        }
      } catch {
        if (mountedRef.current) {
          setNodeTemplateYaml(null)
        }
      }
    },
    [mountedRef, tasks]
  )

  // Compose: draw dependency edges by hand.
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return
      }
      if (wouldCreateCycle(draftEdges, connection.source, connection.target)) {
        toast.warning('Cannot connect: it would create a cycle')
        return
      }
      setDraftEdges((eds) =>
        addEdge({ ...connection, animated: true, className: 'stroke-amber-500/60' }, eds)
      )
    },
    [draftEdges, setDraftEdges]
  )

  // Compose: append a node from a Workflow Node template.
  const addDraftNode = useCallback(
    (record: { name: string; displayName: string; description?: string }) => {
      setDraftNodes((nds) => {
        const id = `${record.name}-${nds.length + 1}`
        const position = {
          x: 80 + (nds.length % 5) * 240,
          y: 60 + Math.floor(nds.length / 5) * 120
        }
        const node: DraftNode = {
          id,
          type: 'taskNode',
          position,
          data: {
            label: record.displayName || record.name,
            assignee: record.name,
            status: 'ready',
            specSummary: record.description ?? ''
          }
        }
        return [...nds, node]
      })
      setCanvasMode('compose')
      toast.success(`Added "${record.displayName || record.name}" to canvas`)
    },
    [setDraftNodes]
  )

  // Canvas interactions (compose): instance ref + context menu.
  const rfRef = useRef<ReactFlowInstance | null>(null)
  const clipboardRef = useRef<DraftNode[]>([])
  const [undoStack, setUndoStack] = useState<{ nodes: DraftNode[]; edges: Edge[] }[]>([])
  const [redoStack, setRedoStack] = useState<{ nodes: DraftNode[]; edges: Edge[] }[]>([])
  const committedRef = useRef<{ nodes: DraftNode[]; edges: Edge[] }>(initialDraft)
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const undo = useCallback(() => {
    const prev = undoStack.at(-1)
    if (!prev) {
      return
    }
    setRedoStack((r) => [...r, committedRef.current])
    setUndoStack((s) => s.slice(0, -1))
    committedRef.current = prev
    setDraftNodes(prev.nodes)
    setDraftEdges(prev.edges)
  }, [undoStack, setDraftNodes, setDraftEdges])

  const redo = useCallback(() => {
    const next = redoStack.at(-1)
    if (!next) {
      return
    }
    setUndoStack((s) => [...s, committedRef.current])
    setRedoStack((r) => r.slice(0, -1))
    committedRef.current = next
    setDraftNodes(next.nodes)
    setDraftEdges(next.edges)
  }, [redoStack, setDraftNodes, setDraftEdges])
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(
    null
  )

  useEffect(() => {
    if (!ctxMenu) {
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCtxMenu(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctxMenu])

  const addDraftNodeAt = useCallback(
    (position: { x: number; y: number }) => {
      const id = `node-${Date.now()}`
      setDraftNodes((nds) => [
        ...nds.map((n) => ({ ...n, selected: false })),
        {
          id,
          type: 'taskNode',
          position,
          data: { label: 'New task', assignee: 'unknown', status: 'ready', specSummary: '' },
          selected: true
        }
      ])
      setSelectedTask({ id, task_title: 'New task', spec: '', status: 'pending', deps: '[]' })
      setSidePanel('task')
    },
    [setDraftNodes]
  )

  const duplicateDraftNode = useCallback(
    (nodeId: string) => {
      setDraftNodes((nds) => {
        const src = nds.find((n) => n.id === nodeId)
        if (!src) {
          return nds
        }
        const data = src.data as TaskNodeData
        const newId = `${data.assignee !== 'unknown' ? data.assignee : 'node'}-${Date.now()}`
        return nds
          .map((n) => ({ ...n, selected: false }))
          .concat({
            id: newId,
            type: 'taskNode',
            position: { x: (src.position?.x ?? 0) + 40, y: (src.position?.y ?? 0) + 40 },
            data: { ...data },
            selected: true
          })
      })
    },
    [setDraftNodes]
  )

  const deleteDraftNode = useCallback(
    (nodeId: string) => {
      setDraftNodes((nds) => nds.filter((n) => n.id !== nodeId))
      setDraftEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
      if (selectedTask?.id === nodeId) {
        setSelectedTask(null)
        setSidePanel(null)
      }
      setCtxMenu(null)
    },
    [setDraftNodes, setDraftEdges, selectedTask]
  )

  const editDraftNode = useCallback(
    (nodeId: string) => {
      const n = draftNodes.find((x) => x.id === nodeId)
      if (!n) {
        return
      }
      const d = n.data as TaskNodeData
      setSelectedTask({ id: nodeId, task_title: d.label, spec: '', status: 'pending', deps: '[]' })
      setSidePanel('task')
      setCtxMenu(null)
    },
    [draftNodes]
  )

  const onNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
    event.preventDefault()
    setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
  }, [])

  // Compose: import a scenario/workflow YAML into the canvas.
  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text()
        const parsed = parseYaml(text) as {
          tasks?: { assignee?: string; title?: string; spec?: string; deps?: string[] }[]
        } | null
        const list = Array.isArray(parsed?.tasks) ? parsed!.tasks : []
        if (list.length === 0) {
          toast.error('No tasks found in YAML')
          return
        }
        const newNodes: DraftNode[] = list.map((t, i) => ({
          id: `imp-${i}`,
          type: 'taskNode',
          position: { x: 80 + (i % 5) * 240, y: 60 + Math.floor(i / 5) * 120 },
          data: {
            label: t.title || t.assignee || `task-${i}`,
            assignee: t.assignee || 'unknown',
            status: 'ready',
            specSummary: t.spec ?? ''
          }
        }))
        const newEdges: Edge[] = []
        list.forEach((t, i) => {
          for (const dep of t.deps ?? []) {
            const src = list.findIndex(
              (x, idx) => idx !== i && (x.assignee === dep || x.title === dep)
            )
            if (src >= 0) {
              newEdges.push({ id: `imp-${src}-${i}`, source: `imp-${src}`, target: `imp-${i}` })
            }
          }
        })
        setDraftNodes(newNodes)
        setDraftEdges(newEdges)
        setCanvasMode('compose')
        toast.success(`Imported ${newNodes.length} nodes`)
      } catch (error) {
        toast.error('Import failed', { description: String(error) })
      }
    },
    [setDraftNodes, setDraftEdges]
  )

  // Monitor-mode graph: derived from polled tasks (read-only, dagre layout).
  const monitorGraph = useMemo(() => {
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
        // Prefer the coordinator's resolved agent over the spec-encoded assignee.
        assignee: t.resolved_agent ?? assignee ?? 'unknown',
        status: t.status,
        specSummary: strippedSpec.slice(0, 80)
      }
      return { id: t.id, type: 'taskNode', position: { x: 0, y: 0 }, data }
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
    return { nodes: layoutDag(rawNodes, rawEdges), edges: rawEdges }
  }, [tasks])

  const nodeTypes = useMemo(() => ({ taskNode: TaskNode }), [])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of tasks) {
      counts[t.status] = (counts[t.status] ?? 0) + 1
    }
    return counts
  }, [tasks])

  const progress = useMemo(() => {
    const done = tasks.filter((t) => t.status === 'completed').length
    const failed = tasks.filter((t) => t.status === 'failed').length
    return { total: tasks.length, done, failed }
  }, [tasks])

  const isCompose = canvasMode === 'compose'
  const selectedDraftNode =
    isCompose && selectedTask ? (draftNodes.find((n) => n.id === selectedTask.id) ?? null) : null

  // Copy/paste selected nodes (compose): Cmd/Ctrl+C then V. Ignored while an
  // input/textarea/Monaco has focus so normal text copy/paste still works.
  useEffect(() => {
    if (!isCompose) {
      return
    }
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el?.isContentEditable ?? false)) {
        return
      }
      const mod = navigator.userAgent.includes('Mac') ? e.metaKey : e.ctrlKey
      if (!mod) {
        return
      }
      if (e.key === 'c' || e.key === 'C') {
        const sel = draftNodes.filter((n) => n.selected)
        if (sel.length > 0) {
          clipboardRef.current = sel
          e.preventDefault()
        }
      } else if (e.key === 'v' || e.key === 'V') {
        const clip = clipboardRef.current
        if (clip.length === 0) {
          return
        }
        e.preventDefault()
        const stamp = Date.now()
        setDraftNodes((nds) => [
          ...nds.map((n) => ({ ...n, selected: false })),
          ...clip.map((n, i) => ({
            id: `paste-${stamp}-${i}`,
            type: 'taskNode' as const,
            position: { x: (n.position?.x ?? 0) + 40, y: (n.position?.y ?? 0) + 40 },
            data: { ...(n.data as TaskNodeData) },
            selected: true
          }))
        ])
      } else if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        if (e.shiftKey) {
          redo()
        } else {
          undo()
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isCompose, draftNodes, setDraftNodes, undo, redo])

  // Auto-snapshot the draft (debounced) so undo/redo cover drags + edits;
  // rapid changes (a drag) coalesce into one history entry.
  useEffect(() => {
    if (!isCompose) {
      return
    }
    if (historyTimer.current) {
      clearTimeout(historyTimer.current)
    }
    historyTimer.current = setTimeout(() => {
      const cur = { nodes: draftNodes, edges: draftEdges }
      const last = committedRef.current
      const same =
        last.nodes.length === cur.nodes.length &&
        last.edges.length === cur.edges.length &&
        JSON.stringify(last) === JSON.stringify(cur)
      if (!same) {
        setUndoStack((s) => [...s.slice(-49), last])
        setRedoStack([])
        committedRef.current = cur
      }
    }, 500)
    return () => {
      if (historyTimer.current) {
        clearTimeout(historyTimer.current)
      }
    }
  }, [draftNodes, draftEdges, isCompose])
  const rfNodes = isCompose ? draftNodes : monitorGraph.nodes
  const rfEdges = isCompose ? draftEdges : monitorGraph.edges

  const deleteHistoryName = history.find((h) => h.id === deleteHistoryId)?.scenarioName ?? ''

  return (
    <WorkbenchShell
      title="Workflow"
      icon={<WorkflowIcon className="size-5" />}
      onBack={closeWorkflowPage}
      badge={
        isCompose ? (
          <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-muted-foreground">
            Composing
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Monitoring
          </span>
        )
      }
      toolbar={
        <>
          {isCompose ? (
            <>
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-1.5 size-3.5" />
                Import
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void saveDraftAsScenario()}
                disabled={draftNodes.length === 0}
              >
                <Save className="mr-1.5 size-3.5" />
                Save
              </Button>
              <span className="h-5 w-px bg-border" aria-hidden />
              <Button
                size="sm"
                onClick={() => void runComposition()}
                disabled={draftNodes.length === 0 || launching}
              >
                {launching ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Play className="mr-1.5 size-3.5" />
                )}
                Run
              </Button>
            </>
          ) : (
            <>
              <Select
                value={selectedScenario ?? ''}
                onValueChange={(v) => setSelectedScenario(v || null)}
              >
                <SelectTrigger className="w-44">
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
              <span className="h-5 w-px bg-border" aria-hidden />
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
              <span className="h-5 w-px bg-border" aria-hidden />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => void handleExport()}
                    disabled={tasks.length === 0}
                    aria-label="Export YAML"
                  >
                    <Download className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4}>
                  Export
                </TooltipContent>
              </Tooltip>
            </>
          )}
          <span className="h-5 w-px bg-border" aria-hidden />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  setSelectedTask(null)
                  setSelectedAgent(null)
                  setNodeTemplateYaml(undefined)
                  setSidePanel('nodes')
                }}
                aria-label="Workflow nodes"
              >
                <Blocks className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              Nodes
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setHistoryOpen((o) => !o)}
                aria-label="Toggle history"
                data-active={historyOpen ? 'true' : undefined}
              >
                <History className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              History ({history.length})
            </TooltipContent>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) {
                void handleImportFile(f)
              }
              e.target.value = ''
            }}
          />
        </>
      }
    >
      {/* Status bar (monitor only) */}
      {!isCompose && tasks.length > 0 ? (
        <div className="flex gap-2 border-b px-4 py-1 text-xs text-muted-foreground">
          {Object.entries(statusCounts).map(([status, count]) => (
            <span key={status} className="flex items-center gap-1">
              <span className={cn('size-1.5 rounded-full', taskStatusStyle(status).dot)} />
              {status}: {count}
            </span>
          ))}
          <span className="ml-auto flex items-center gap-1.5">
            <span className="flex items-center gap-0.5">
              {tasks.slice(0, 16).map((t) => (
                <span
                  key={t.id}
                  className={cn('size-1.5 rounded-full', taskStatusStyle(t.status).dot)}
                />
              ))}
            </span>
            <b className="font-semibold text-foreground">
              {progress.done}/{progress.total}
            </b>
            {progress.failed > 0 ? (
              <span className="text-red-500">· {progress.failed} failed</span>
            ) : null}
          </span>
        </div>
      ) : null}

      {/* Canvas + side panel */}
      <div className="relative flex min-h-0 flex-1">
        {/* History — collapsible rail */}
        {historyOpen ? (
          <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/20">
            <div className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Clock className="size-3" />
              History ({history.length})
              {polling ? (
                <Loader2 className="size-3 animate-spin text-muted-foreground/50" />
              ) : null}
              <Button
                variant="ghost"
                size="icon-xs"
                className="ml-auto size-5"
                onClick={() => setHistoryOpen(false)}
                aria-label="Collapse history"
              >
                <ChevronLeft className="size-3.5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-sleek">
              {history.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 px-3 py-10 text-center text-xs text-muted-foreground/60">
                  <Clock className="size-6 opacity-40" />
                  <p>No runs yet.</p>
                  <p className="text-muted-foreground/50">
                    Export a workflow to capture its history.
                  </p>
                </div>
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
                      'group relative flex w-full flex-col gap-0.5 border-b py-2.5 pl-3.5 pr-3 text-left text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      selectedHistoryId === h.id && 'bg-accent'
                    )}
                  >
                    {selectedHistoryId === h.id ? (
                      <span
                        className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
                        aria-hidden
                      />
                    ) : null}
                    <div className="flex items-center gap-1.5 pr-5">
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          historyRunDotClass(h.status)
                        )}
                      />
                      <span className="truncate font-medium">{h.scenarioName}</span>
                    </div>
                    <span className="text-muted-foreground">
                      {h.completedCount}/{h.taskCount} done
                      {h.failedCount > 0 ? (
                        <span className="text-red-500"> · {h.failedCount} failed</span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground/50">
                      {new Date(h.capturedAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute right-1 top-1 size-5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-focus-within:opacity-100 group-hover:opacity-100"
                      aria-label={`Delete run ${h.scenarioName}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteHistoryId(h.id)
                      }}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label={`Show history (${history.length})`}
            className="flex w-9 shrink-0 cursor-pointer flex-col items-center gap-2 border-r bg-muted/20 pt-2.5 text-muted-foreground transition-colors hover:bg-accent"
          >
            <Clock className="size-3.5" />
            <span className="rounded-full border border-border px-1.5 text-[10px]">
              {history.length}
            </span>
            <span className="mt-auto [writing-mode:vertical-rl] rotate-180 pb-2 text-[10px] uppercase tracking-widest text-muted-foreground/60">
              History
            </span>
          </button>
        )}

        {/* Canvas */}
        <div
          className="flex-1"
          onDoubleClick={(e) => {
            if (!isCompose) {
              return
            }
            const target = e.target as HTMLElement
            if (!target.classList.contains('react-flow__pane')) {
              return
            }
            const pos = rfRef.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY })
            if (pos) {
              addDraftNodeAt(pos)
            }
          }}
        >
          {rfNodes.length > 0 ? (
            <ReactFlow
              onInit={(instance) => {
                rfRef.current = instance
              }}
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onNodeClick={(event, node) => {
                setCtxMenu(null)
                return handleNodeClick(event, node)
              }}
              nodesDraggable={isCompose}
              nodesConnectable={isCompose}
              onNodesChange={isCompose ? onDraftNodesChange : undefined}
              onEdgesChange={isCompose ? onDraftEdgesChange : undefined}
              onConnect={isCompose ? onConnect : undefined}
              onReconnect={
                isCompose
                  ? (oldEdge, newConnection) => {
                      if (!newConnection.source || !newConnection.target) {
                        return
                      }
                      const without = draftEdges.filter((e) => e.id !== oldEdge.id)
                      if (wouldCreateCycle(without, newConnection.source, newConnection.target)) {
                        toast.warning('Cannot reconnect: it would create a cycle')
                        return
                      }
                      setDraftEdges((eds) =>
                        addEdge(
                          { ...newConnection, animated: true, className: 'stroke-amber-500/60' },
                          eds.filter((e) => e.id !== oldEdge.id)
                        )
                      )
                    }
                  : undefined
              }
              onNodeContextMenu={isCompose ? onNodeContextMenu : undefined}
              onPaneContextMenu={
                isCompose
                  ? (event) => {
                      event.preventDefault()
                      setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: null })
                    }
                  : undefined
              }
              deleteKeyCode={isCompose ? ['Backspace', 'Delete'] : null}
              selectionOnDrag={isCompose}
              panOnDrag={isCompose ? [1, 2] : true}
              selectionMode={isCompose ? SelectionMode.Partial : undefined}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={isCompose} />
              <MiniMap
                pannable
                zoomable
                className="!bg-card"
                nodeColor={(n) => miniNodeColor((n.data as TaskNodeData)?.status)}
              />
            </ReactFlow>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <WorkflowIcon className="size-12 opacity-30" />
              {isCompose ? (
                <>
                  <p className="text-sm">
                    Compose a workflow: add nodes, drag to arrange, connect to set order.
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    Use <strong>Nodes</strong> to add templates, <strong>Import</strong> a scenario
                    YAML, then <strong>Run</strong>.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm">
                    No active workflow. Select a scenario and click Run, or open History.
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    Or use{' '}
                    <code className="rounded bg-muted px-1">orca orchestration task-create</code> to
                    add tasks via CLI.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right-side panel as a single edge-sliding Sheet; width varies by mode. */}
        <Sheet
          open={sidePanel !== null}
          onOpenChange={(o) => {
            if (!o) {
              setSidePanel(null)
            }
          }}
        >
          <SheetContent
            side="right"
            className={cn(
              'flex flex-col gap-0 p-0',
              sidePanel === 'nodes' ? 'sm:max-w-[720px]' : 'sm:max-w-[420px]'
            )}
          >
            <SheetHeader className="flex flex-row items-center justify-between space-y-0 border-b px-4 py-2.5">
              <SheetTitle className="truncate text-sm">
                {sidePanel === 'task'
                  ? ((selectedTask?.task_title || selectedTask?.id) ?? 'Task')
                  : 'Workflow Nodes'}
              </SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-hidden">
              {sidePanel === 'task' && selectedTask ? (
                isCompose && selectedDraftNode ? (
                  <ComposeNodeEditor
                    node={selectedDraftNode}
                    onUpdate={(patch) =>
                      setDraftNodes((nds) =>
                        nds.map((n) =>
                          n.id === selectedDraftNode.id
                            ? { ...n, data: { ...(n.data as TaskNodeData), ...patch } }
                            : n
                        )
                      )
                    }
                    onDelete={() => {
                      setDraftNodes((nds) => nds.filter((n) => n.id !== selectedDraftNode.id))
                      setDraftEdges((eds) =>
                        eds.filter(
                          (e) =>
                            e.source !== selectedDraftNode.id && e.target !== selectedDraftNode.id
                        )
                      )
                      setSidePanel(null)
                      setSelectedTask(null)
                    }}
                  />
                ) : (
                  <NodeTemplateView
                    name={selectedAgent}
                    yaml={nodeTemplateYaml}
                    task={selectedTask}
                  />
                )
              ) : null}
              {sidePanel === 'nodes' ? (
                <WorkflowNodesEditorSheet
                  open
                  composeMode={isCompose}
                  onDraftAdd={addDraftNode}
                  onAddedToCanvas={() => void pollTasks()}
                />
              ) : null}
            </div>
          </SheetContent>
        </Sheet>

        {/* Compose context menu (right-click). */}
        {ctxMenu ? (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setCtxMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setCtxMenu(null)
              }}
            />
            <div
              className="fixed z-50 min-w-[168px] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
            >
              {ctxMenu.nodeId ? (
                <>
                  <CtxItem
                    icon={<Pencil className="size-3.5" />}
                    label="Edit"
                    onClick={() => editDraftNode(ctxMenu.nodeId!)}
                  />
                  <CtxItem
                    icon={<Copy className="size-3.5" />}
                    label="Duplicate"
                    onClick={() => {
                      duplicateDraftNode(ctxMenu.nodeId!)
                      setCtxMenu(null)
                    }}
                  />
                  <CtxItem
                    icon={<Trash2 className="size-3.5" />}
                    label="Delete"
                    danger
                    onClick={() => deleteDraftNode(ctxMenu.nodeId!)}
                  />
                </>
              ) : (
                <CtxItem
                  icon={<Plus className="size-3.5" />}
                  label="Add node here"
                  onClick={() => {
                    const pos = rfRef.current?.screenToFlowPosition({ x: ctxMenu.x, y: ctxMenu.y })
                    if (pos) {
                      addDraftNodeAt(pos)
                    }
                    setCtxMenu(null)
                  }}
                />
              )}
            </div>
          </>
        ) : null}
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

function NodeTemplateView({
  name,
  yaml,
  task
}: {
  name: string | null
  yaml: string | null | undefined
  task: OrchestrationTask | null
}): React.JSX.Element {
  // Resolved agent = what the coordinator actually dispatched to, falling back
  // to the spec-encoded assignee, then 'unknown'.
  const resolvedAgent =
    task?.resolved_agent ?? decodeAssigneeFromSpec(task?.spec ?? '').assignee ?? null
  return (
    <div className="flex h-full flex-col">
      {/* Monitor task dispatch meta: actual agent + any per-task failure. */}
      {task ? (
        <div className="flex flex-col gap-1 border-b px-4 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Dispatched agent</span>
            <span className="font-medium text-foreground">{resolvedAgent ?? 'unknown'}</span>
          </div>
          {task.dispatch_error ? <p className="text-destructive">{task.dispatch_error}</p> : null}
        </div>
      ) : null}
      {typeof yaml === 'string' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <span className="text-sm font-semibold">{name}</span>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              node
            </Badge>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              read-only
            </Badge>
          </div>
          <div className="min-h-0 flex-1">
            <YamlEditor value={yaml} onChange={() => {}} readOnly placeholder="No node YAML" />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground/60">
          <Blocks className="size-8 opacity-30" />
          <p>{name ? `No workflow node for &quot;${name}&quot;.` : 'This task has no assignee.'}</p>
        </div>
      )}
    </div>
  )
}

function ComposeNodeEditor({
  node,
  onUpdate,
  onDelete
}: {
  node: Node
  onUpdate: (patch: Partial<TaskNodeData>) => void
  onDelete: () => void
}): React.JSX.Element {
  const data = node.data as TaskNodeData
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="text-sm font-semibold">Edit node</span>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          draft
        </Badge>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Label</Label>
          <Input value={data.label} onChange={(e) => onUpdate({ label: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Assignee (agent)</Label>
          <AgentPicker
            value={data.assignee === 'unknown' ? '' : data.assignee}
            onChange={(name) => onUpdate({ assignee: name })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Description</Label>
          <textarea
            value={data.specSummary}
            onChange={(e) => onUpdate({ specSummary: e.target.value })}
            rows={5}
            spellCheck={false}
            className="min-h-[80px] w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
      </div>
      <div className="border-t p-3">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 className="mr-1.5 size-3.5" />
          Delete node
        </Button>
      </div>
    </div>
  )
}

function miniNodeColor(status?: string): string {
  switch (status) {
    case 'completed':
      return '#34d399'
    case 'dispatched':
      return '#fbbf24'
    case 'failed':
      return '#f87171'
    case 'ready':
      return '#60a5fa'
    case 'blocked':
      return '#c084fc'
    default:
      return '#6b6b6b'
  }
}

function CtxItem({
  icon,
  label,
  onClick,
  danger
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent',
        danger && 'text-destructive hover:bg-destructive/10'
      )}
    >
      {icon}
      {label}
    </button>
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

// True if adding source->target would close a dependency cycle (or a self-loop).
function wouldCreateCycle(edges: Edge[], source: string, target: string): boolean {
  if (source === target) {
    return true
  }
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    const list = adj.get(e.source)
    if (list) {
      list.push(e.target)
    } else {
      adj.set(e.source, [e.target])
    }
  }
  const stack = [target]
  const seen = new Set<string>([target])
  while (stack.length > 0) {
    const n = stack.pop() as string
    if (n === source) {
      return true
    }
    for (const next of adj.get(n) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        stack.push(next)
      }
    }
  }
  return false
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

// Why: unknown-assignee refusal is actionable (register the agent first), so
// surface it distinctly from a generic launch error.
function toastLaunchFailure(result: { error: string; unknownAssignees?: string[] }): void {
  if (result.unknownAssignees && result.unknownAssignees.length > 0) {
    toast.error('Scenario not started', {
      description: `Unknown agent(s): ${result.unknownAssignees.join(', ')}`
    })
  } else {
    toast.error('Launch failed', { description: result.error })
  }
}
