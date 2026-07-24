import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CanonicalMcpServerInput, ResourceKind } from '../../../../shared/resources'

export function CreateCanonicalDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [kind, setKind] = useState<Extract<ResourceKind, 'skill' | 'mcp'>>('skill')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [envText, setEnvText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reset = (): void => {
    setName('')
    setDescription('')
    setTransport('stdio')
    setCommand('')
    setArgs('')
    setUrl('')
    setEnvText('')
  }

  const close = (): void => {
    onOpenChange(false)
  }

  const handleSubmit = async (): Promise<void> => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    setSubmitting(true)
    try {
      if (kind === 'skill') {
        await window.api.resources.canonical.createSkill(name.trim(), description.trim())
        toast.success(`Created canonical skill "${name.trim()}"`)
      } else {
        if (transport === 'stdio' && !command.trim()) {
          toast.error('Command is required for stdio transport')
          setSubmitting(false)
          return
        }
        if (transport === 'http' && !url.trim()) {
          toast.error('URL is required for http transport')
          setSubmitting(false)
          return
        }
        const env = parseEnvText(envText)
        const input: CanonicalMcpServerInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          transport,
          command: transport === 'stdio' ? command.trim() : undefined,
          args: transport === 'stdio' ? splitArgs(args) : undefined,
          url: transport === 'http' ? url.trim() : undefined,
          env: Object.keys(env).length > 0 ? env : undefined
        }
        await window.api.resources.canonical.createMcp(input)
        toast.success(`Created canonical MCP server "${name.trim()}"`)
      }
      reset()
      close()
      onCreated()
    } catch (error) {
      toast.error('Could not create resource', { description: String(error) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create canonical resource</DialogTitle>
          <DialogDescription>
            Define a resource once in ~/.formapis/resources/, then distribute it to agents.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 py-1">
          {(['skill', 'mcp'] as const).map((k) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={kind === k ? 'default' : 'outline'}
              onClick={() => setKind(k)}
            >
              {k === 'mcp' ? 'MCP Server' : 'Skill'}
            </Button>
          ))}
        </div>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="canon-name">Name</Label>
            <Input
              id="canon-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === 'skill' ? 'my-reviewer' : 'filesystem'}
              autoFocus
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="canon-desc">Description</Label>
            <textarea
              id="canon-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this resource does"
              rows={2}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

          {kind === 'mcp' ? (
            <>
              <div className="flex gap-2">
                {(['stdio', 'http'] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={transport === t ? 'default' : 'outline'}
                    onClick={() => setTransport(t)}
                  >
                    {t.toUpperCase()}
                  </Button>
                ))}
              </div>
              {transport === 'stdio' ? (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="canon-cmd">Command</Label>
                    <Input
                      id="canon-cmd"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="npx"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="canon-args">Args (space separated)</Label>
                    <Input
                      id="canon-args"
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                    />
                  </div>
                </>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="canon-url">URL</Label>
                  <Input
                    id="canon-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com/mcp"
                  />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="canon-env">Env (KEY=value per line)</Label>
                <textarea
                  id="canon-env"
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder={'API_KEY=xxx\nDEBUG=true'}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={submitting}>
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

function parseEnvText(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) {
      continue
    }
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (key) {
      env[key] = value
    }
  }
  return env
}

function splitArgs(args: string): string[] {
  return args.split(/\s+/).filter(Boolean)
}
