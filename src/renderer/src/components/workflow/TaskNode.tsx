import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'

export type TaskNodeData = {
  label: string
  assignee: string
  provider?: string
  status: string
  specSummary: string
}

const statusStyles: Record<string, { border: string; dot: string; label: string }> = {
  pending: { border: 'border-muted-foreground/30', dot: 'bg-muted-foreground/40', label: '等待' },
  ready: { border: 'border-blue-500/50', dot: 'bg-blue-500', label: '就绪' },
  dispatched: { border: 'border-amber-500/60', dot: 'bg-amber-500 animate-pulse', label: '执行中' },
  blocked: { border: 'border-purple-500/50', dot: 'bg-purple-500', label: '阻塞' },
  completed: { border: 'border-emerald-500/50', dot: 'bg-emerald-500', label: '完成' },
  failed: { border: 'border-red-500/50', dot: 'bg-red-500', label: '失败' }
}

function TaskNodeComponent({ data }: { data: TaskNodeData }): React.JSX.Element {
  const style = statusStyles[data.status] ?? statusStyles.pending
  return (
    <div
      className={cn(
        'relative rounded-lg border-2 bg-card px-3 py-2 shadow-md transition-colors',
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
