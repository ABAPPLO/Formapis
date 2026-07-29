// Why: TaskNode、Workflow 状态栏圆点、历史圆点三处共用这一份状态→样式映射,避免漂移。
export type TaskStatusStyle = { dot: string; border: string; label: string }

const STATUS_STYLES: Record<string, TaskStatusStyle> = {
  pending: { dot: 'bg-muted-foreground/40', border: 'border-muted-foreground/30', label: '等待' },
  ready: { dot: 'bg-blue-500', border: 'border-blue-500/50', label: '就绪' },
  dispatched: { dot: 'bg-amber-500 animate-pulse', border: 'border-amber-500/60', label: '执行中' },
  blocked: { dot: 'bg-purple-500', border: 'border-purple-500/50', label: '阻塞' },
  completed: { dot: 'bg-emerald-500', border: 'border-emerald-500/50', label: '完成' },
  failed: { dot: 'bg-red-500', border: 'border-red-500/50', label: '失败' }
}

const FALLBACK: TaskStatusStyle = STATUS_STYLES.pending

export function taskStatusStyle(status: string): TaskStatusStyle {
  return STATUS_STYLES[status] ?? FALLBACK
}
