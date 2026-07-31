import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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

/** "New workflow node" creation form. Mirrors the agents-yaml create dialog. */
export function CreateNodeDialog({
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
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const reset = (): void => {
    setName('')
    setDisplayName('')
    setDescription('')
    setTask('')
  }
  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    setBusy(true)
    try {
      const record = await window.api.workflowNodesYaml.create({
        name: name.trim(),
        displayName: displayName.trim() || undefined,
        description: description.trim() || undefined,
        task: task.trim() || 'Describe what this task should do.'
      })
      toast.success(`Created node "${record.name}"`)
      reset()
      onOpenChange(false)
      onCreated(record.name)
    } catch (error) {
      toast.error('Could not create node', { description: String(error) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New workflow node</DialogTitle>
          <DialogDescription>
            Define a reusable task template. Bind an agent when adding it to the canvas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="node-name">Name (kebab-case)</Label>
            <Input
              id="node-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="review-pr"
              autoFocus={true}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="node-display">Display name</Label>
            <Input
              id="node-display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="代码审查节点"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="node-desc">Description</Label>
            <Input
              id="node-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this node does"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="node-task">Task (what to do)</Label>
            <Input
              id="node-task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Review the PR for quality and security."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
