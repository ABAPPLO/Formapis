import { useEffect, useState } from 'react'
import { useMountedRef } from '@/hooks/useMountedRef'
import { cn } from '@/lib/utils'

// Why: single source of truth — the canvas's "Nodes" are agents. This panel lists
// the agents-yaml registry; clicking one drops a task node bound to it on the canvas.
export function AddAgentNodePanel({
  onAdd,
  onManage
}: {
  onAdd: (agentName: string) => void
  onManage?: () => void
}): React.JSX.Element {
  const [agents, setAgents] = useState<{ name: string }[]>([])
  const mountedRef = useMountedRef()
  useEffect(() => {
    window.api.agentsYaml
      .list()
      .then((list) => {
        if (mountedRef.current) {
          setAgents(Array.isArray(list) ? list.map((a) => ({ name: a.name })) : [])
        }
      })
      .catch(() => {
        // silent — empty list until the registry is reachable
      })
  }, [mountedRef])
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
        <span>
          {agents.length} agent{agents.length === 1 ? '' : 's'} · click to add a node
        </span>
        {onManage ? (
          <button type="button" onClick={onManage} className="ml-auto text-primary hover:underline">
            Manage in Agents →
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
        {agents.map((a) => (
          <button
            key={a.name}
            type="button"
            onClick={() => onAdd(a.name)}
            className={cn(
              'flex w-full flex-col gap-0.5 border-b border-transparent px-4 py-2 text-left',
              'hover:bg-muted/50 hover:border-border'
            )}
          >
            <span className="truncate text-sm font-medium">{a.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
