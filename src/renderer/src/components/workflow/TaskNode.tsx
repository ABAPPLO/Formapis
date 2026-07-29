import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { taskStatusStyle } from '../workbench/task-status-style'

export type TaskNodeData = {
  label: string
  assignee: string
  provider?: string
  status: string
  specSummary: string
}

function assigneeInitial(assignee: string): string {
  return assignee && assignee !== 'unknown' ? assignee.charAt(0).toUpperCase() : '?'
}

function TaskNodeComponent({ data }: { data: TaskNodeData }): React.JSX.Element {
  const style = taskStatusStyle(data.status)
  const hasAssignee = data.assignee && data.assignee !== 'unknown'
  return (
    <div className="relative flex w-full overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      {/* left status edge — same hue as the status dot (dispatched pulses) */}
      <span className={cn('w-[3px] shrink-0', style.dot)} />
      <div className="min-w-0 flex-1 px-2.5 py-2">
        <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="grid size-4 shrink-0 place-items-center rounded bg-muted-foreground/20 text-[9px] font-bold text-muted-foreground">
            {assigneeInitial(data.assignee)}
          </span>
          <span className="truncate">{hasAssignee ? data.assignee : 'unassigned'}</span>
        </div>
        <div className="truncate text-[13px] font-semibold">{data.label}</div>
        {data.specSummary ? (
          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/80">
            {data.specSummary}
          </p>
        ) : null}
        <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className={cn('size-1.5 rounded-full', style.dot)} />
          {style.label}
        </span>
      </div>
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground/40" />
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground/40" />
    </div>
  )
}

export const TaskNode = memo(TaskNodeComponent)
