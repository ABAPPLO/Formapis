/* eslint-disable max-lines -- Why: AgentBuilderConversation is a multi-step wizard with live YAML preview; splitting the steps from the preview would break the iterate-and-watch loop. */
import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Bot, Check, Loader2, MessageSquarePlus, Save } from 'lucide-react'
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

const PROVIDERS = [
  'claude',
  'openclaude',
  'codex',
  'opencode',
  'gemini',
  'cursor',
  'copilot',
  'grok',
  'hermes',
  'openclaw',
  'aider',
  'pi'
] as const

type Answers = {
  name: string
  displayName: string
  description: string
  provider: string
  runtimeType: 'ade' | 'harness'
  role: string
  toolsText: string
  askBeforeDestructive: boolean
  maxTurns: number
}

const STEPS: { id: string; title: string }[] = [
  { id: 'identity', title: 'Identity' },
  { id: 'runtime', title: 'Runtime' },
  { id: 'role', title: 'Role & expertise' },
  { id: 'tools', title: 'Tools & behavior' },
  { id: 'review', title: 'Review & generate' }
]

const INITIAL_ANSWERS: Answers = {
  name: '',
  displayName: '',
  description: '',
  provider: 'claude',
  runtimeType: 'ade',
  role: '',
  toolsText: '',
  askBeforeDestructive: true,
  maxTurns: 50
}

export function AgentBuilderConversation({
  open,
  onOpenChange,
  onGenerated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerated: (name: string) => void
}) {
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<Answers>(INITIAL_ANSWERS)
  const [generatedYaml, setGeneratedYaml] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)

  const reset = (): void => {
    setStepIndex(0)
    setAnswers(INITIAL_ANSWERS)
    setGeneratedYaml(null)
  }

  const close = (): void => {
    onOpenChange(false)
  }

  const handleNext = (): void => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1)
    }
  }

  const handleBack = (): void => {
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1)
    }
  }

  const handleGenerate = async (): Promise<void> => {
    setGenerating(true)
    try {
      const tools = answers.toolsText
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
      const result = await window.api.agentsYaml.generateFromConversation({
        name: answers.name,
        displayName: answers.displayName,
        description: answers.description,
        provider: answers.provider,
        runtimeType: answers.runtimeType,
        role: answers.role,
        toolsMcp: tools,
        toolsSkills: [],
        behavior: {
          askBeforeDestructive: answers.askBeforeDestructive,
          maxTurns: answers.maxTurns
        }
      })
      if (!result.ok) {
        toast.error('Could not generate agent', { description: result.errors.join('; ') })
        return
      }
      setGeneratedYaml(result.rawYaml)
      toast.success('Agent YAML generated')
    } catch (error) {
      toast.error('Generation failed', { description: String(error) })
    } finally {
      setGenerating(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!generatedYaml) {
      return
    }
    setSaving(true)
    try {
      const result = await window.api.agentsYaml.save(answers.name, generatedYaml)
      if (!result.valid) {
        toast.warning('Saved with validation issues', {
          description: result.errors.slice(0, 2).join('; ')
        })
      } else {
        toast.success(`Agent "${answers.name}" saved`)
      }
      reset()
      close()
      onGenerated(answers.name)
    } catch (error) {
      toast.error('Save failed', { description: String(error) })
    } finally {
      setSaving(false)
    }
  }

  const canProceed = useMemo((): boolean => {
    switch (STEPS[stepIndex].id) {
      case 'identity':
        return answers.name.trim() !== '' && answers.displayName.trim() !== ''
      case 'runtime':
        // provider + runtimeType always have defaults; nothing to block on.
        return true
      case 'role':
        return answers.role.trim() !== ''
      default:
        return true
    }
  }, [stepIndex, answers])

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset()
        }
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="size-5" />
            Build an agent conversationally
          </DialogTitle>
          <DialogDescription>
            Answer a few questions; we&apos;ll assemble a valid YAML agent you can refine.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-1">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex flex-1 items-center">
              <div
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
                  i < stepIndex
                    ? 'bg-primary text-primary-foreground'
                    : i === stepIndex
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {i < stepIndex ? <Check className="size-3" /> : i + 1}
              </div>
              {i < STEPS.length - 1 ? (
                <div
                  className={cn('mx-1 h-px flex-1', i < stepIndex ? 'bg-primary' : 'bg-muted')}
                />
              ) : null}
            </div>
          ))}
        </div>
        <p className="px-1 text-sm font-medium">{STEPS[stepIndex].title}</p>

        {/* Step content */}
        <div className="max-h-[50vh] overflow-y-auto pr-1 scrollbar-sleek">
          {stepIndex === 0 ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cv-name">Agent name (kebab-case)</Label>
                <Input
                  id="cv-name"
                  value={answers.name}
                  onChange={(e) => setAnswers({ ...answers, name: e.target.value })}
                  placeholder="code-reviewer"
                  autoFocus
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cv-display">Display name</Label>
                <Input
                  id="cv-display"
                  value={answers.displayName}
                  onChange={(e) => setAnswers({ ...answers, displayName: e.target.value })}
                  placeholder="代码审查官"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cv-desc">One-line description</Label>
                <Input
                  id="cv-desc"
                  value={answers.description}
                  onChange={(e) => setAnswers({ ...answers, description: e.target.value })}
                  placeholder="Reviews code for quality and security"
                />
              </div>
            </div>
          ) : null}

          {stepIndex === 1 ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Runtime provider</Label>
                <Select
                  value={answers.provider}
                  onValueChange={(v) => setAnswers({ ...answers, provider: v })}
                >
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
                <Label>Runtime type</Label>
                <div className="flex gap-2">
                  {(['ade', 'harness'] as const).map((t) => (
                    <Button
                      key={t}
                      size="sm"
                      variant={answers.runtimeType === t ? 'default' : 'outline'}
                      onClick={() => setAnswers({ ...answers, runtimeType: t })}
                    >
                      {t === 'ade' ? 'ADE (coding CLI)' : 'Harness (orchestrator)'}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {stepIndex === 2 ? (
            <div className="grid gap-1.5">
              <Label htmlFor="cv-role">Describe the agent&apos;s role and expertise</Label>
              <textarea
                id="cv-role"
                value={answers.role}
                onChange={(e) => setAnswers({ ...answers, role: e.target.value })}
                placeholder="You are a strict code reviewer focused on security, performance, and maintainability. Flag any vulnerabilities or anti-patterns..."
                rows={6}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                This becomes the agent&apos;s system prompt. Be specific about what it should focus
                on and what to avoid.
              </p>
            </div>
          ) : null}

          {stepIndex === 3 ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cv-tools">Tools (MCP servers / skills, comma-separated)</Label>
                <Input
                  id="cv-tools"
                  value={answers.toolsText}
                  onChange={(e) => setAnswers({ ...answers, toolsText: e.target.value })}
                  placeholder="filesystem, github"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cv-maxturns">Max turns</Label>
                <Input
                  id="cv-maxturns"
                  type="number"
                  min={1}
                  value={answers.maxTurns}
                  onChange={(e) =>
                    setAnswers({ ...answers, maxTurns: Number.parseInt(e.target.value, 10) || 50 })
                  }
                  className="w-32"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={answers.askBeforeDestructive}
                  onChange={(e) =>
                    setAnswers({ ...answers, askBeforeDestructive: e.target.checked })
                  }
                  className="size-4 rounded border-input"
                />
                Ask before destructive actions
              </label>
            </div>
          ) : null}

          {stepIndex === 4 ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{answers.provider}</Badge>
                <Badge variant="outline">{answers.runtimeType}</Badge>
                {answers.toolsText.trim() ? (
                  <Badge variant="outline">
                    {answers.toolsText.split(/[,\s]+/).filter(Boolean).length} tools
                  </Badge>
                ) : null}
              </div>
              {generatedYaml ? (
                <div className="rounded-md border bg-muted/30 p-3">
                  <pre className="max-h-64 overflow-y-auto font-mono text-xs scrollbar-sleek">
                    {generatedYaml}
                  </pre>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-8 text-muted-foreground">
                  <Bot className="size-8 opacity-40" />
                  <p className="text-sm">Ready to generate your agent YAML.</p>
                  <Button onClick={() => void handleGenerate()} disabled={generating}>
                    {generating ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <MessageSquarePlus className="mr-1.5 size-3.5" />
                    )}
                    Generate YAML
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-row items-center justify-between">
          <Button variant="ghost" size="sm" onClick={handleBack} disabled={stepIndex === 0}>
            <ArrowLeft className="mr-1.5 size-3.5" />
            Back
          </Button>
          <div className="flex gap-2">
            {stepIndex < STEPS.length - 1 ? (
              <Button size="sm" onClick={handleNext} disabled={!canProceed}>
                Next
                <ArrowRight className="ml-1.5 size-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={!generatedYaml || saving}
              >
                {saving ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 size-3.5" />
                )}
                Save agent
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
