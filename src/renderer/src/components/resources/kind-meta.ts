import { Blocks, Plug, Server } from 'lucide-react'
import type { ResourceKind } from '../../../../shared/resources'

export const kindLabels: Record<ResourceKind, string> = {
  mcp: 'MCP',
  skill: 'Skill',
  plugin: 'Plugin'
}

export const kindIcons: Record<ResourceKind, typeof Server> = {
  mcp: Server,
  skill: Blocks,
  plugin: Plug
}
