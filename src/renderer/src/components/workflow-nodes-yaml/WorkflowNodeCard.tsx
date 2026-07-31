import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { WorkflowNodeYamlRecord } from '../../../../shared/workflow-node-yaml'

/** Compact list-row card for a workflow node template. */
export function WorkflowNodeCard({
  node,
  selected,
  onSelect
}: {
  node: WorkflowNodeYamlRecord
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
        <span className="truncate font-medium">{node.displayName}</span>
        {!node.valid ? (
          <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {node.suggestedAgent ? (
          <Badge variant="outline" className="text-[10px]">
            → {node.suggestedAgent}
          </Badge>
        ) : null}
        {node.inputs.length > 0 ? (
          <Badge variant="outline" className="text-[10px]">
            {node.inputs.length} in
          </Badge>
        ) : null}
        {node.outputs.length > 0 ? (
          <Badge variant="outline" className="text-[10px]">
            {node.outputs.length} out
          </Badge>
        ) : null}
      </div>
      {node.description ? (
        <p className="line-clamp-1 text-xs text-muted-foreground">{node.description}</p>
      ) : null}
    </button>
  )
}
