/* eslint-disable max-lines */
/* oxlint-disable max-lines -- Why: AgentsYamlPage pairs a list pane with an inline YAML editor + try-run actions; splitting would break the define-edit-try loop that is the whole point of the workbench. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Loader2,
  Play,
  Plus,
  Save,
  Trash2
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
import type { AgentYamlRecord } from '../../../../shared/agent-yaml'

const PROVIDERS = [
  'claude',
  'openclaude',
  'codex',
  'opencode',
  'gemini',
  'antigravity',
  'cursor',
  'copilot',
  'grok',
  'aider',
  'amp',
  'goose',
  'kilo',
  'kiro',
  'crush',
  'aug',
  'cline',
  'codebuff',
  'command-code',
  'continue',
  'droid',
  'kimi',
  'pi',
  'omp',
  'qwen-code',
  'rovo',
  'hermes',
  'openclaw',
  'devin',
  'ante'
] as const

const STARTER_YAML = `apiVersion: formapis/v1
kind: Agent
metadata:
  name: new-agent
  display_name: New Agent
  description: Describe what this agent does
  version: 1.0.0
spec:
  runtime:
    type: ade
    provider: claude
  role: |
    You are a helpful agent.
  tools:
    mcp: []
    skills: []
  system_prompt: |
    {{role}}
    Available tools: {{tools}}
  behavior:
    max_turns: 50
`

function AgentCard({
  agent,
  selected,
  onSelect
}: {
  agent: AgentYamlRecord
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors',
        selected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/50'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="truncate font-medium">{agent.displayName}</span>
        {!agent.valid ? (
          <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="outline" className="text-[10px]">
          {agent.provider}
        </Badge>
        {agent.runtimeType ? (
          <Badge variant="outline" className="text-[10px]">
            {agent.runtimeType}
          </Badge>
        ) : null}
        {agent.toolsMcp.length > 0 ? (
          <Badge variant="outline" className="text-[10px]">
            {agent.toolsMcp.length} MCP
          </Badge>
        ) : null}
      </div>
      {agent.description ? (
        <p className="line-clamp-1 text-xs text-muted-foreground">{agent.description}</p>
      ) : null}
    </button>
  )
}

export default function AgentsYamlPage(): React.JSX.Element {
  const closeAgentsYamlPage = useAppStore((s) => s.closeAgentsYamlPage)
  const mountedRef = useMountedRef()
  const [agents, setAgents] = useState<AgentYamlRecord[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const loadAgents = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.api.agentsYaml.list()
      if (mountedRef.current) {
        setAgents(list)
        // Keep selection valid; if nothing selected and list non-empty, pick first.
        if (list.length > 0) {
          const current =
            selectedName && list.some((a) => a.name === selectedName) ? selectedName : list[0].name
          if (current !== selectedName) {
            setSelectedName(current)
            const raw = await window.api.agentsYaml.read(current)
            if (mountedRef.current) {
              setDraft(raw ?? STARTER_YAML)
              setValidation({ valid: true, errors: [] })
            }
          }
        } else if (mountedRef.current) {
          setSelectedName(null)
          setDraft('')
          setValidation(null)
        }
      }
    } catch (error) {
      console.error('Failed to list agents:', error)
      if (mountedRef.current) {
        toast.error('Could not load agents')
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [mountedRef, selectedName])

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  const handleSelect = useCallback(
    async (name: string): Promise<void> => {
      setSelectedName(name)
      try {
        const raw = await window.api.agentsYaml.read(name)
        if (mountedRef.current) {
          setDraft(raw ?? '')
          const record = agents.find((a) => a.name === name)
          setValidation(record ? { valid: record.valid, errors: record.validationErrors } : null)
        }
      } catch {
        if (mountedRef.current) {
          setDraft('')
        }
      }
    },
    [agents, mountedRef]
  )

  const handleSave = async (): Promise<void> => {
    if (!selectedName) {
      return
    }
    setSaving(true)
    try {
      const result = await window.api.agentsYaml.save(selectedName, draftRef.current)
      if (mountedRef.current) {
        setValidation({ valid: result.valid, errors: result.errors })
        if (result.valid) {
          toast.success('Saved')
          // Reload to reflect any name changes + revalidated record.
          await loadAgents()
        } else {
          toast.warning('Saved with validation errors', {
            description: result.errors.slice(0, 2).join('; ')
          })
        }
      }
    } catch (error) {
      toast.error('Save failed', { description: String(error) })
    } finally {
      if (mountedRef.current) {
        setSaving(false)
      }
    }
  }

  const handleTryRun = async (): Promise<void> => {
    if (!selectedName) {
      return
    }
    try {
      const result = await window.api.agentsYaml.resolveLaunch(selectedName)
      if ('error' in result) {
        toast.error('Cannot run agent', { description: result.error })
        return
      }
      // Phase 2: show the rendered prompt so the user can copy it into a terminal.
      // Phase 3 will wire this to actual terminal creation via the terminals store.
      toast.success(`Resolved launch payload for ${result.payload.displayName}`, {
        description: `Provider: ${result.payload.provider}. System prompt rendered (${result.payload.systemPrompt.length} chars).`
      })
    } catch (error) {
      toast.error('Try-run failed', { description: String(error) })
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!selectedName) {
      return
    }
    if (!confirm(`Delete agent "${selectedName}"?`)) {
      return
    }
    try {
      await window.api.agentsYaml.remove(selectedName)
      toast.success('Deleted')
      await loadAgents()
    } catch (error) {
      toast.error('Delete failed', { description: String(error) })
    }
  }

  const selectedAgent = useMemo(
    () => agents.find((a) => a.name === selectedName) ?? null,
    [agents, selectedName]
  )

  return (
    <main className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="icon" className="size-7" onClick={closeAgentsYamlPage}>
          <ArrowLeft className="size-4" />
        </Button>
        <Bot className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Agents</h2>
        <Badge variant="outline">YAML</Badge>
        <span className="ml-2 text-sm text-muted-foreground">
          {agents.length} agent{agents.length === 1 ? '' : 's'}
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 size-3.5" />
          New
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* List pane */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r scrollbar-sleek">
          <div className="flex flex-col gap-1 p-2">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading…
              </div>
            ) : agents.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                No agents yet. Click <strong>New</strong> to define one.
              </div>
            ) : (
              agents.map((agent) => (
                <AgentCard
                  key={agent.name}
                  agent={agent}
                  selected={agent.name === selectedName}
                  onSelect={() => void handleSelect(agent.name)}
                />
              ))
            )}
          </div>
        </aside>

        {/* Editor pane */}
        <section className="flex min-w-0 flex-1 flex-col">
          {selectedAgent ? (
            <>
              <div className="flex items-center gap-2 border-b px-4 py-2">
                <span className="font-medium">{selectedAgent.displayName}</span>
                <code className="text-xs text-muted-foreground">{selectedAgent.name}</code>
                <div className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => void handleTryRun()}>
                    <Play className="mr-1.5 size-3.5" />
                    Try run
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleSave()}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 size-3.5" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void handleDelete()}
                  >
                    <Trash2 className="mr-1.5 size-3.5" />
                    Delete
                  </Button>
                </div>
              </div>

              {validation && !validation.valid ? (
                <div className="flex items-start gap-2 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">Validation errors (saved anyway):</p>
                    <ul className="ml-4 list-disc">
                      {validation.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}

              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none bg-muted/30 p-4 font-mono text-xs outline-none"
                placeholder="Edit agent YAML here…"
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Bot className="size-10 opacity-30" />
              <p>Select an agent or create a new one.</p>
            </div>
          )}
        </section>
      </div>

      <CreateAgentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (name) => {
          await loadAgents()
          await handleSelect(name)
        }}
      />
    </main>
  )
}

function CreateAgentDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState<string>('claude')
  const [role, setRole] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reset = (): void => {
    setName('')
    setDisplayName('')
    setDescription('')
    setProvider('claude')
    setRole('')
  }

  const handleSubmit = async (): Promise<void> => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    setSubmitting(true)
    try {
      const record = await window.api.agentsYaml.create({
        name: name.trim(),
        displayName: displayName.trim() || undefined,
        description: description.trim() || undefined,
        provider,
        role: role.trim() || 'You are a helpful agent.'
      })
      toast.success(`Created agent "${record.name}"`)
      reset()
      onOpenChange(false)
      onCreated(record.name)
    } catch (error) {
      toast.error('Could not create agent', { description: String(error) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New YAML agent</DialogTitle>
          <DialogDescription>
            Define an agent persona and runtime binding. You can edit the full YAML afterward.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="agent-name">Name (kebab-case)</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="code-reviewer"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-display">Display name</Label>
            <Input
              id="agent-display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="代码审查官"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-desc">Description</Label>
            <Input
              id="agent-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this agent does"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Runtime provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-role">Role (one line)</Label>
            <Input
              id="agent-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="You are a strict code reviewer."
            />
          </div>
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
