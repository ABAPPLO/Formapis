import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentType } from '../../shared/agent-status-types'
import type { ResourceScanRoot } from '../../shared/resources'

/**
 * MCP config locations per agent ecosystem.
 *
 * Orca's src/shared/mcp-config.ts only knows about *workspace*-relative
 * candidates (.mcp.json, .cursor/mcp.json, .claude.json, .claude/mcp.json).
 * For the unified resource layer we additionally scan each agent's *home*
 * config, because that is where users actually keep their shared MCP servers.
 *
 * The `parser` axis lets the discovery engine dispatch to json/toml/yaml.
 * The `serversPath` is the dotted path to the server map inside the parsed
 * document (JSON path components, like mcp-config.ts serversPath).
 *
 * Paths are absolute under the user's home. WSL/SSH runtimes are handled by
 * the caller passing a different homeDir / path resolver.
 */
export type McpHomeCandidate = {
  /** Agent ecosystem that owns this config file. */
  agent: AgentType
  /** Human-readable label for the UI. */
  label: string
  /** Absolute path of the config file (or null if it cannot be expressed statically). */
  absolutePath: string
  /** Config format / parser to use. */
  parser: 'json' | 'toml' | 'yaml'
  /** Path components from the parsed root to the { serverName: config } map. */
  serversPath: string[]
}

/**
 * Build the list of home-level MCP config candidates for the current host.
 *
 * Note: codex's real config lives at ~/.codex/config.toml with a [mcp_servers]
 * table. Claude reads ~/.claude.json (root-level mcpServers) and also
 * ~/.claude/mcp_settings.json on some setups. Cursor uses ~/.cursor/mcp.json.
 * Gemini reads ~/.gemini/settings.json. Hermes uses ~/.hermes/config.yaml.
 *
 * We intentionally keep this list conservative — only well-known, documented
 * locations. Unknown / custom paths are out of scope for discovery.
 */
export function buildMcpHomeCandidates(homeDir: string = homedir()): McpHomeCandidate[] {
  const home = homeDir
  return [
    {
      agent: 'claude',
      label: 'Claude home',
      absolutePath: join(home, '.claude.json'),
      parser: 'json',
      serversPath: ['mcpServers']
    },
    {
      agent: 'claude',
      label: 'Claude home (.claude/mcp.json)',
      absolutePath: join(home, '.claude', 'mcp.json'),
      parser: 'json',
      serversPath: ['mcpServers']
    },
    {
      agent: 'codex',
      label: 'Codex home',
      absolutePath: join(home, '.codex', 'config.toml'),
      parser: 'toml',
      serversPath: ['mcp_servers']
    },
    {
      agent: 'cursor',
      label: 'Cursor home',
      absolutePath: join(home, '.cursor', 'mcp.json'),
      parser: 'json',
      serversPath: ['mcpServers']
    },
    {
      agent: 'gemini',
      label: 'Gemini home',
      absolutePath: join(home, '.gemini', 'settings.json'),
      parser: 'json',
      serversPath: ['mcpServers']
    },
    {
      agent: 'hermes',
      label: 'Hermes home',
      absolutePath: join(home, '.hermes', 'config.yaml'),
      parser: 'yaml',
      serversPath: ['mcp_servers']
    }
  ]
}

/**
 * Convert MCP home candidates into generic ResourceScanRoot entries.
 * Each candidate is one scan root of kind 'mcp'.
 */
export function buildMcpScanRoots(homeDir: string = homedir()): ResourceScanRoot[] {
  return buildMcpHomeCandidates(homeDir).map((c, index) => ({
    id: `mcp-home-${c.agent}-${index}`,
    kind: 'mcp',
    label: c.label,
    path: c.absolutePath,
    sourceKind: 'home',
    providers: [c.agent],
    owner: c.agent
  }))
}
