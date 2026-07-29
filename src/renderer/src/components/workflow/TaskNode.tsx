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

function TaskNodeComponent({ data }: { data: TaskNodeData }): React.JSX.Element {
  const style = taskStatusStyle(data.status)
  return (
    <div
      className={cn(
        // Why: 文档「轻微浮起」= shadow-xs + 单 token border;原 shadow-md + border-2 超出三级阴影。
        'relative rounded-lg border bg-card px-3 py-2 shadow-xs transition-colors',
        style.border
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground/40" />
      <div className="flex items-center gap-1.5">
        <span className={cn('size-2 shrink-0 rounded-full', style.dot)} />
        <span className="truncate text-sm font-medium">{data.label}</span>
      </div>
      {data.provider ? (
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{data.provider}</span>
      ) : null}
      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/80">{data.specSummary}</p>
      <span className="mt-1 inline-block rounded bg-muted/50 px-1 text-[10px] text-muted-foreground">
        {style.label}
      </span>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground/40" />
    </div>
  )
}

export const TaskNode = memo(TaskNodeComponent)
