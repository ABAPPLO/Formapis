import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import { isPlainObject } from '../agent-hooks/hooks-json-read'
import type { CanonicalMcpFile } from './canonical-store'
import { parseMcpConfigDocument, summarizeExtractedServer } from './mcp-config-parsers'

/**
 * MCP config writers — the write half of the resource layer for MCP servers.
 *
 * Phase 1b-2 implements JSON config read-modify-write (Claude / Cursor / Gemini).
 * TOML (Codex) and YAML (Hermes) stay unsupported until a real writer is added
 * (the read-only scanners in mcp-config-parsers.ts are lossy and cannot round-trip).
 *
 * Each write is an upsert on a single server key: the rest of the user's config
 * file (other MCP servers, unrelated top-level keys) is preserved untouched.
 */

/**
 * Convert a canonical MCP definition into the entry shape agents expect in
 * their config file. stdio → {command, args, env?}; http → {type, url}.
 */
export function canonicalToAgentEntry(def: CanonicalMcpFile): Record<string, unknown> {
  if (def.transport === 'http') {
    const entry: Record<string, unknown> = { type: 'http', url: def.url ?? '' }
    if (Object.keys(def.env).length > 0) {
      entry.env = def.env
    }
    return entry
  }
  const entry: Record<string, unknown> = {
    command: def.command ?? '',
    ...(def.args.length > 0 ? { args: def.args } : {})
  }
  if (Object.keys(def.env).length > 0) {
    entry.env = def.env
  }
  return entry
}

/**
 * Insert or update one MCP server in a JSON config file (e.g. ~/.claude.json).
 * Reads the full file, upserts only serversPath[serverName], writes back
 * atomically. Preserves all other keys. Returns 'inserted' | 'updated'.
 */
export function upsertMcpServerIntoJsonConfig(
  configPath: string,
  serverName: string,
  entry: Record<string, unknown>,
  serversPath: string[]
): 'inserted' | 'updated' {
  const root = readJsonConfigRoot(configPath)

  // Navigate to the servers map (creating intermediate objects as needed).
  let cursor: Record<string, unknown> = root
  for (const key of serversPath.slice(0, -1)) {
    if (!isPlainObject(cursor[key])) {
      cursor[key] = {}
    }
    cursor = cursor[key] as Record<string, unknown>
  }
  const leafKey = serversPath.at(-1)!
  if (!isPlainObject(cursor[leafKey])) {
    cursor[leafKey] = {}
  }
  const servers = cursor[leafKey] as Record<string, unknown>

  const existed = serverName in servers
  servers[serverName] = entry

  mkdirSync(dirname(configPath), { recursive: true })
  writeFileAtomically(configPath, `${JSON.stringify(root, null, 2)}\n`)
  return existed ? 'updated' : 'inserted'
}

/**
 * Remove one MCP server from a JSON config file. Preserves all other keys.
 * Returns 'removed' if the server was present, 'missing' otherwise.
 */
export function removeMcpServerFromJsonConfig(
  configPath: string,
  serverName: string,
  serversPath: string[]
): 'removed' | 'missing' {
  if (!existsSync(configPath)) {
    return 'missing'
  }
  const root = readJsonConfigRoot(configPath)

  // Navigate to the servers map.
  let cursor: Record<string, unknown> = root
  for (const key of serversPath.slice(0, -1)) {
    if (!isPlainObject(cursor[key])) {
      return 'missing'
    }
    cursor = cursor[key] as Record<string, unknown>
  }
  const leafKey = serversPath.at(-1)!
  if (!isPlainObject(cursor[leafKey])) {
    return 'missing'
  }
  const servers = cursor[leafKey] as Record<string, unknown>
  if (!(serverName in servers)) {
    return 'missing'
  }
  delete servers[serverName]
  writeFileAtomically(configPath, `${JSON.stringify(root, null, 2)}\n`)
  return 'removed'
}

/**
 * Check whether a server name exists in a config file (any parser).
 * Returns true if present, false if missing or file unreadable.
 */
export function serverExistsInConfig(
  configPath: string,
  serverName: string,
  parser: 'json' | 'toml' | 'yaml',
  serversPath: string[]
): boolean {
  if (!existsSync(configPath)) {
    return false
  }
  let content: string
  try {
    content = readFileSync(configPath, 'utf-8')
  } catch {
    return false
  }
  const doc = parseMcpConfigDocument(content, parser, serversPath)
  if (!doc) {
    return false
  }
  if (!(serverName in doc.servers)) {
    return false
  }
  // For JSON we can confirm via the parsed entry; for toml/yaml the scanner
  // already populated doc.servers, so presence is sufficient.
  return true
}

/**
 * Read the current entry for a server from a config file (any parser), used by
 * inspectDistribution to render the distribution state. Returns null if the
 * server or file is absent.
 */
export function readServerEntry(
  configPath: string,
  serverName: string,
  parser: 'json' | 'toml' | 'yaml',
  serversPath: string[]
): { transport: string; endpoint: string | null } | null {
  if (!existsSync(configPath)) {
    return null
  }
  let content: string
  try {
    content = readFileSync(configPath, 'utf-8')
  } catch {
    return null
  }
  const doc = parseMcpConfigDocument(content, parser, serversPath)
  if (!doc || !(serverName in doc.servers)) {
    return null
  }
  const summary = summarizeExtractedServer(serverName, doc.servers[serverName])
  return { transport: summary.transport, endpoint: summary.endpoint }
}

function readJsonConfigRoot(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf-8'))
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    // Why: if the existing file is corrupt, start fresh rather than clobbering
    // silently — the atomic write will replace it with valid JSON.
    return {}
  }
}
