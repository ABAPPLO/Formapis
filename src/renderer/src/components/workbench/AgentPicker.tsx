import { useCallback, useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

// Why: single source of truth — every "assignee" picks from the agents-yaml
// registry, never free text, so a task always binds to a real, routable agent.
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
  return (
    <Select
      value={value || undefined}
      onValueChange={onChange}
      onOpenChange={(open) => {
        if (open) {
          void reload()
        }
      }}
    >
      <SelectTrigger className={className}>
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
  )
}
