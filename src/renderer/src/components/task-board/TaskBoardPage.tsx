/* eslint-disable max-lines -- Why: TaskBoardPage combines scenario launching with a live task kanban (polled) + gate display; splitting would break the launch→watch loop. */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardList,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Square
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { decodeAssigneeFromSpec } from '../../../../shared/scenario-yaml'
import type { ScenarioRecord } from '../../../../shared/scenario-yaml'

// TaskRow shape returned by orchestration.taskList (subset we render).
type OrchestrationTask = {
  id: string
  task_title: string | null
  spec: string
  status: 'pending' | 'ready' | 'dispatched' | 'completed' | 'failed' | 'blocked'
  deps: string
  result: string | null
}

type OrchestrationGate = {
  id: string
  task_id: string
  question: string
  status: 'pending' | 'resolved' | 'timeout'
  resolution: string | null
}

const COLUMNS: { key: OrchestrationTask['status']; label: string; tone: string }[] = [
  { key: 'pending', label: 'Pending', tone: 'border-muted-foreground/20' },
  { key: 'ready', label: 'Ready', tone: 'border-blue-500/40' },
  { key: 'dispatched', label: 'Dispatched', tone: 'border-amber-500/40' },
  { key: 'blocked', label: 'Blocked', tone: 'border-purple-500/40' },
  { key: 'completed', label: 'Completed', tone: 'border-emerald-500/40' },
  { key: 'failed', label: 'Failed', tone: 'border-red-500/40' }
]

const POLL_INTERVAL_MS = 1500

export default function TaskBoardPage(): React.JSX.Element {
  const closeTaskBoardPage = useAppStore((s) => s.closeTaskBoardPage)
  const settings = useAppStore((s) => s.settings)
  const mountedRef = useMountedRef()
  const [scenarios, setScenarios] = useState<ScenarioRecord[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [tasks, setTasks] = useState<OrchestrationTask[]>([])
  const [gates, setGates] = useState<OrchestrationGate[]>([])
  const [launching, setLaunching] = useState(false)
  const [running, setRunning] = useState(false)
  const [polling, setPolling] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const pollingRef = useRef(false)

  const loadScenarios = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.scenarios.list()
      if (mountedRef.current) {
        setScenarios(list)
        if (list.length > 0 && !selectedName) {
          setSelectedName(list[0].name)
        }
      }
    } catch (error) {
      console.error('Failed to list scenarios:', error)
    }
  }, [mountedRef, selectedName])

  useEffect(() => {
    void loadScenarios()
  }, [loadScenarios])

  const pollTasks = useCallback(async (): Promise<void> => {
    if (pollingRef.current || !mountedRef.current) {
      return
    }
    pollingRef.current = true
    setPolling(true)
    try {
      const target = getActiveRuntimeTarget(settings)
      const [taskResult, gateResult] = await Promise.all([
        callRuntimeRpc<{ tasks: OrchestrationTask[] }>(target, 'orchestration.taskList', {}).catch(
          () => ({ tasks: [] })
        ),
        callRuntimeRpc<{ gates: OrchestrationGate[] }>(target, 'orchestration.gateList', {}).catch(
          () => ({ gates: [] })
        )
      ])
      if (mountedRef.current) {
        setTasks(taskResult.tasks ?? [])
        setGates(gateResult.gates ?? [])
      }
    } finally {
      pollingRef.current = false
      if (mountedRef.current) {
        setPolling(false)
      }
    }
  }, [mountedRef, settings])

  // Poll while the page is open.
  useEffect(() => {
    const interval = setInterval(() => {
      void pollTasks()
    }, POLL_INTERVAL_MS)
    void pollTasks()
    return () => clearInterval(interval)
  }, [pollTasks])

  const handleLaunch = async (): Promise<void> => {
    if (!selectedName) {
      return
    }
    setLaunching(true)
    try {
      const result = await window.api.scenarios.launch(selectedName)
      if (!result.ok) {
        toast.error('Launch failed', { description: result.error })
        return
      }
      toast.success(
        `Prepared ${result.taskIds.length} tasks for "${result.scenarioName}" (${result.mode})`
      )
      // Start the coordinator run via the existing orchestration.run RPC.
      const target = getActiveRuntimeTarget(settings)
      await callRuntimeRpc(target, 'orchestration.run', {
        spec: `Scenario: ${result.scenarioName}`,
        from: 'formapis',
        maxConcurrent: result.taskIds.length
      })
      setRunning(true)
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
      toast.success('Stopped coordinator run')
    } catch (error) {
      toast.error('Stop failed', { description: String(error) })
    }
  }

  const handleResolveGate = async (gateId: string, resolution: string): Promise<void> => {
    try {
      const target = getActiveRuntimeTarget(settings)
      await callRuntimeRpc(target, 'orchestration.gateResolve', { id: gateId, resolution })
      toast.success('Gate resolved')
      await pollTasks()
    } catch (error) {
      toast.error('Could not resolve gate', { description: String(error) })
    }
  }

  const selectedScenario = scenarios.find((s) => s.name === selectedName) ?? null
  const tasksByColumn = COLUMNS.map((col) => ({
    ...col,
    items: tasks.filter((t) => t.status === col.key)
  }))

  return (
    <main className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="icon" className="size-7" onClick={closeTaskBoardPage}>
          <ArrowLeft className="size-4" />
        </Button>
        <ClipboardList className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Task Board</h2>
        <Badge variant="outline">{tasks.length} tasks</Badge>
        {running ? <Badge className="bg-amber-500/15 text-amber-600">running</Badge> : null}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          onClick={() => void pollTasks()}
          title="Refresh"
        >
          <RefreshCw className={cn('size-4', polling && 'animate-spin')} />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Scenario list */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r scrollbar-sleek">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Scenarios
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="size-6 p-0"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <div className="flex flex-col gap-1 px-2 pb-2">
            {scenarios.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No scenarios. Create one referencing your YAML agents.
              </p>
            ) : (
              scenarios.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => setSelectedName(s.name)}
                  className={cn(
                    'flex flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors',
                    s.name === selectedName
                      ? 'border-primary bg-primary/5'
                      : 'border-transparent hover:bg-muted/50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    {!s.valid ? <AlertTriangle className="size-3 shrink-0 text-amber-500" /> : null}
                  </div>
                  <div className="flex gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      {s.mode}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {s.taskCount} tasks
                    </Badge>
                  </div>
                  {s.agentRefs.length > 0 ? (
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {s.agentRefs.join(', ')}
                    </p>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Board */}
        <section className="flex min-w-0 flex-1 flex-col">
          {selectedScenario ? (
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
              <span className="font-medium">{selectedScenario.name}</span>
              {selectedScenario.description ? (
                <span className="truncate text-xs text-muted-foreground">
                  {selectedScenario.description}
                </span>
              ) : null}
              <div className="ml-auto flex gap-1">
                {running ? (
                  <Button size="sm" variant="outline" onClick={() => void handleStop()}>
                    <Square className="mr-1.5 size-3.5" />
                    Stop
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void handleLaunch()} disabled={launching}>
                    {launching ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 size-3.5" />
                    )}
                    Launch
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="border-b px-4 py-2 text-sm text-muted-foreground">
              Select a scenario to launch.
            </div>
          )}

          {/* Gates */}
          {gates.filter((g) => g.status === 'pending').length > 0 ? (
            <div className="border-b bg-purple-500/5 px-4 py-2">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-purple-600">
                Decision gates
              </p>
              {gates
                .filter((g) => g.status === 'pending')
                .map((g) => (
                  <GateRow key={g.id} gate={g} onResolve={handleResolveGate} />
                ))}
            </div>
          ) : null}

          {/* Kanban columns */}
          <div className="scrollbar-sleek flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
            {tasksByColumn.map((col) => (
              <div
                key={col.key}
                className={cn('flex w-64 shrink-0 flex-col rounded-md border-t-2', col.tone)}
              >
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide">{col.label}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {col.items.length}
                  </Badge>
                </div>
                <div className="flex flex-col gap-2 px-2 pb-2">
                  {col.items.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                  {col.items.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground/50">—</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <CreateScenarioDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (name) => {
          await loadScenarios()
          setSelectedName(name)
        }}
      />
    </main>
  )
}

function TaskCard({ task }: { task: OrchestrationTask }): React.JSX.Element {
  const { assignee, strippedSpec } = decodeAssigneeFromSpec(task.spec)
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card p-2.5 text-sm shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{task.task_title ?? task.id}</span>
        {assignee ? (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {assignee}
          </Badge>
        ) : null}
      </div>
      <p className="line-clamp-3 text-xs text-muted-foreground">{strippedSpec}</p>
      {task.result ? (
        <p className="line-clamp-2 rounded bg-muted/40 px-1.5 py-1 font-mono text-[10px] text-muted-foreground">
          {task.result}
        </p>
      ) : null}
    </div>
  )
}

function GateRow({
  gate,
  onResolve
}: {
  gate: OrchestrationGate
  onResolve: (id: string, resolution: string) => Promise<void>
}) {
  const [resolution, setResolution] = useState('approved')
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span className="truncate text-xs text-muted-foreground">{gate.question}</span>
      <Input
        value={resolution}
        onChange={(e) => setResolution(e.target.value)}
        className="h-7 w-40 text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        onClick={() => void onResolve(gate.id, resolution)}
      >
        Resolve
      </Button>
    </div>
  )
}

function CreateScenarioDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'orchestrated' | 'autonomous'>('orchestrated')
  const [agentRefsText, setAgentRefsText] = useState('')
  const [supervisor, setSupervisor] = useState('')
  const [goal, setGoal] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reset = (): void => {
    setName('')
    setMode('orchestrated')
    setAgentRefsText('')
    setSupervisor('')
    setGoal('')
  }

  const handleSubmit = async (): Promise<void> => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    const agentRefs = agentRefsText
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (agentRefs.length === 0) {
      toast.error('At least one agent ref is required')
      return
    }
    if (mode === 'autonomous' && !supervisor.trim()) {
      toast.error('Autonomous mode requires a supervisor agent')
      return
    }
    setSubmitting(true)
    try {
      const record = await window.api.scenarios.create({
        name: name.trim(),
        mode,
        agentRefs,
        supervisor: mode === 'autonomous' ? supervisor.trim() : undefined,
        goal: goal.trim() || undefined
      })
      toast.success(`Created scenario "${record.name}"`)
      reset()
      onOpenChange(false)
      onCreated(record.name)
    } catch (error) {
      toast.error('Could not create scenario', { description: String(error) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New scenario</DialogTitle>
          <DialogDescription>
            Bind YAML agents into a task DAG (orchestrated) or a supervisor-led swarm (autonomous).
            Edit the full YAML afterward.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="scn-name">Name (kebab-case)</Label>
            <Input
              id="scn-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="release-feature"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            {(['orchestrated', 'autonomous'] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? 'default' : 'outline'}
                onClick={() => setMode(m)}
              >
                {m}
              </Button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="scn-agents">Agents (comma or space separated YAML agent names)</Label>
            <Input
              id="scn-agents"
              value={agentRefsText}
              onChange={(e) => setAgentRefsText(e.target.value)}
              placeholder="code-reviewer, test-writer"
            />
          </div>
          {mode === 'autonomous' ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="scn-supervisor">Supervisor agent</Label>
                <Input
                  id="scn-supervisor"
                  value={supervisor}
                  onChange={(e) => setSupervisor(e.target.value)}
                  placeholder="release-manager"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="scn-goal">Goal</Label>
                <Input
                  id="scn-goal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="Ship the v1.2.0 release."
                />
              </div>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
