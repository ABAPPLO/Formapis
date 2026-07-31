import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { AgentRuntimeProviderSchema } from '../../../../shared/agent-yaml'

// Why: single source of truth — every "assignee" picks from the agents-yaml
// registry, never free text. The inline ＋ creates a new agent in that same
// registry, so creation anywhere converges back to the Agents page.
export function AgentPicker({
  value,
  onChange,
  className
}: {
  value: string
  onChange: (agentName: string) => void
  className?: string
}): React.JSX.Element {
  const [agents, setAgents] = useState<{ name: string }[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('claude')
  const [role, setRole] = useState('')
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async () => {
    try {
      const list = await window.api.agentsYaml.list()
      setAgents(Array.isArray(list) ? list.map((a) => ({ name: a.name })) : [])
    } catch {
      // silent — picker renders empty until the registry is reachable
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  const handleCreate = async (): Promise<void> => {
    if (!name.trim() || !role.trim()) {
      toast.error('Name and role are required')
      return
    }
    setCreating(true)
    try {
      const rec = await window.api.agentsYaml.create({
        name: name.trim(),
        provider: provider.trim() || 'claude',
        role: role.trim()
      })
      await reload()
      onChange(rec.name)
      setCreateOpen(false)
      setName('')
      setRole('')
      toast.success(`Agent "${rec.name}" created`)
    } catch (error) {
      toast.error('Could not create agent', { description: String(error) })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Select
        value={value || undefined}
        onValueChange={onChange}
        onOpenChange={(open) => {
          if (open) {
            void reload()
          }
        }}
      >
        <SelectTrigger className="min-w-0 flex-1">
          <SelectValue placeholder="Select agent" />
        </SelectTrigger>
        <SelectContent>
          {agents.map((a) => (
            <SelectItem key={a.name} value={a.name}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="New agent">
            <Plus className="size-3.5" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New agent</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="bug-fixer"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger>
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  {AgentRuntimeProviderSchema.options.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Role</Label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Fix reported bugs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={creating} onClick={() => void handleCreate()}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
