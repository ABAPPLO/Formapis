import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  SquareArrowOutUpRight,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { useAppStore } from '@/store'
import { CreateNodeDialog } from './CreateNodeDialog'
import { WorkflowNodeCard } from './WorkflowNodeCard'
import { ConfirmDeleteDialog } from '../workbench/ConfirmDeleteDialog'
import { YamlEditor } from '../workbench/YamlEditor'
import type { WorkflowNodeYamlRecord } from '../../../../shared/workflow-node-yaml'

const STARTER_YAML = `apiVersion: formapis/v1
kind: WorkflowNode
metadata:
  name: new-node
  display_name: 新节点
  description: 节点用途
spec:
  role: |
    你是一个……的节点。
  tools:
    mcp: []
    skills: []
  inputs: []
  outputs: []
  behavior:
    max_turns: 30
`

/**
 * Inline panel body for managing the global workflow-node library. Embedded in
 * the Workflow page's right side Sheet. Nodes are global templates
 * (~/.formapis/workflow-nodes/*.yaml); "Add to canvas" pushes one into the
 * running DAG via orchestration.taskCreate and notifies the caller to refresh.
 * `open` controls mount so the parent can toggle it.
 */
export function WorkflowNodesEditorSheet({
  open,
  composeMode = false,
  onDraftAdd,
  onAddedToCanvas
}: {
  open: boolean
  composeMode?: boolean
  onDraftAdd?: (record: { name: string; displayName: string }) => void
  onAddedToCanvas?: () => void
}) {
  const settings = useAppStore((s) => s.settings)
  const mountedRef = useMountedRef()
  const [nodes, setNodes] = useState<WorkflowNodeYamlRecord[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const loadNodes = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.api.workflowNodesYaml.list()
      if (mountedRef.current) {
        setNodes(list)
        if (list.length > 0) {
          const current =
            selectedName && list.some((n) => n.name === selectedName) ? selectedName : list[0].name
          if (current !== selectedName) {
            setSelectedName(current)
            const raw = await window.api.workflowNodesYaml.read(current)
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
      console.error('Failed to list workflow nodes:', error)
      if (mountedRef.current) {
        toast.error('Could not load workflow nodes')
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [mountedRef, selectedName])

  // Load on first open; skip reloading when closing/reopening to keep edits.
  useEffect(() => {
    if (open && nodes.length === 0 && !loading) {
      void loadNodes()
    }
  }, [open, loadNodes, nodes.length, loading])

  const handleSelect = useCallback(
    async (name: string): Promise<void> => {
      setSelectedName(name)
      try {
        const raw = await window.api.workflowNodesYaml.read(name)
        if (mountedRef.current) {
          setDraft(raw ?? '')
          const record = nodes.find((n) => n.name === name)
          setValidation(record ? { valid: record.valid, errors: record.validationErrors } : null)
        }
      } catch {
        if (mountedRef.current) {
          setDraft('')
        }
      }
    },
    [nodes, mountedRef]
  )

  const handleSave = async (): Promise<void> => {
    if (!selectedName) {
      return
    }
    setSaving(true)
    try {
      const result = await window.api.workflowNodesYaml.save(selectedName, draftRef.current)
      if (mountedRef.current) {
        setValidation({ valid: result.valid, errors: result.errors })
        if (result.valid) {
          toast.success('Saved')
          await loadNodes()
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

  // Push this node into the running workflow DAG as a new task; the canvas
  // polls orchestration.taskList, and onAddedToCanvas lets it refresh at once.
  const handleAddToCanvas = async (): Promise<void> => {
    if (!selectedName) {
      return
    }
    const node = nodes.find((n) => n.name === selectedName)
    if (!node) {
      return
    }
    if (composeMode && onDraftAdd) {
      onDraftAdd({ name: node.name, displayName: node.displayName })
      return
    }
    try {
      const target = getActiveRuntimeTarget(settings)
      const spec = `assignee: ${node.name}\n${node.role}`
      await callRuntimeRpc(target, 'orchestration.taskCreate', {
        spec,
        taskTitle: node.displayName,
        displayName: node.displayName
      })
      toast.success(`Added "${node.displayName}" to the workflow canvas`)
      onAddedToCanvas?.()
    } catch (error) {
      toast.error('Could not add node to canvas', { description: String(error) })
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!selectedName) {
      return
    }
    try {
      await window.api.workflowNodesYaml.remove(selectedName)
      toast.success('Deleted')
      await loadNodes()
    } catch (error) {
      toast.error('Delete failed', { description: String(error) })
    }
  }

  const selectedNode = useMemo(
    () => nodes.find((n) => n.name === selectedName) ?? null,
    [nodes, selectedName]
  )

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="text-xs text-muted-foreground">
          {nodes.length} node{nodes.length === 1 ? '' : 's'}
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 size-3.5" />
          New
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* List pane */}
        <aside className="w-56 shrink-0 overflow-y-auto border-r scrollbar-sleek">
          <div className="flex flex-col gap-1 p-2">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading…
              </div>
            ) : nodes.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                No nodes yet. Click <strong>New</strong>.
              </div>
            ) : (
              nodes.map((node) => (
                <WorkflowNodeCard
                  key={node.name}
                  node={node}
                  selected={node.name === selectedName}
                  onSelect={() => void handleSelect(node.name)}
                />
              ))
            )}
          </div>
        </aside>

        {/* Editor pane */}
        <section className="flex min-w-0 flex-1 flex-col">
          {selectedNode ? (
            <>
              <div className="flex items-center gap-2 border-b px-4 py-2">
                <span className="truncate font-medium">{selectedNode.displayName}</span>
                <code className="truncate text-xs text-muted-foreground">{selectedNode.name}</code>
                <div className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => void handleAddToCanvas()}>
                    <SquareArrowOutUpRight className="mr-1.5 size-3.5" />
                    Add to canvas
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
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="mr-1.5 size-3.5" />
                  </Button>
                </div>
              </div>

              {validation && !validation.valid ? (
                <div className="flex items-start gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
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

              <div className="min-h-0 flex-1">
                <YamlEditor
                  value={draft}
                  onChange={setDraft}
                  onSave={(v) => {
                    draftRef.current = v
                    void handleSave()
                  }}
                  placeholder="Edit node YAML…"
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <CheckCircle2 className="size-10 opacity-30" />
              <p>Select a node or create a new one.</p>
            </div>
          )}
        </section>
      </div>

      <CreateNodeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (name) => {
          await loadNodes()
          await handleSelect(name)
        }}
      />
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete node "${selectedName ?? ''}"?`}
        onConfirm={async () => {
          await handleDelete()
          setDeleteOpen(false)
        }}
      />
    </div>
  )
}
