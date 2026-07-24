/**
 * Lenient MCP config parsers for discovery (read-only).
 *
 * Phase 1a only needs to discover *which* MCP servers exist in each agent's
 * config — we do not need to fully round-trip TOML/YAML. JSON configs
 * (Claude/Cursor/Gemini) are parsed natively. For TOML (Codex) and YAML
 * (Hermes) we extract server entries with a targeted scanner rather than a
 * full parser, so we avoid adding new dependencies for the MVP.
 *
 * Phase 1b (write/distribute) will need a real TOML/YAML writer and can swap
 * these implementations out without changing the call sites.
 */
import type { McpTransport } from '../../shared/resources'

/** One MCP server entry as extracted from a config file. */
export type ExtractedMcpServer = {
  name: string
  transport: McpTransport
  /** Raw command string or url, best-effort. */
  endpoint: string | null
  /** Number of env entries observed (values never leave the parser). */
  envCount: number
}

type ParsedDoc = {
  servers: Record<string, unknown>
}

/**
 * Parse a config file's text into a server map, dispatching by parser kind.
 * Returns null if the document cannot be parsed at all.
 */
export function parseMcpConfigDocument(
  content: string,
  parser: 'json' | 'toml' | 'yaml',
  serversPath: string[]
): ParsedDoc | null {
  if (parser === 'json') {
    return parseJsonDoc(content, serversPath)
  }
  if (parser === 'toml') {
    return { servers: extractTomlServerTable(content, serversPath[0] ?? 'mcp_servers') }
  }
  if (parser === 'yaml') {
    return { servers: extractYamlServerMap(content, serversPath[0] ?? 'mcp_servers') }
  }
  return null
}

function parseJsonDoc(content: string, serversPath: string[]): ParsedDoc | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  let cursor: unknown = parsed
  for (const key of serversPath) {
    if (cursor && typeof cursor === 'object' && !Array.isArray(cursor)) {
      cursor = (cursor as Record<string, unknown>)[key]
    } else {
      return { servers: {} }
    }
  }
  if (cursor && typeof cursor === 'object' && !Array.isArray(cursor)) {
    return { servers: cursor as Record<string, unknown> }
  }
  return { servers: {} }
}

/**
 * Extract the `[mcp_servers.<name>]` sub-tables from a TOML document without
 * a full TOML parser. We only need server names + a best-effort look at each
 * table's keys (command/url/env) to classify transport.
 *
 * This is intentionally simple: it scans for table headers of the form
 * `[mcp_servers.foo]` / `[mcp_servers."foo bar"]` and collects the body lines
 * until the next table header.
 */
function extractTomlServerTable(content: string, rootTable: string): Record<string, unknown> {
  const servers: Record<string, Record<string, unknown>> = {}
  const tableOpen = new RegExp(
    `^\\s*\\[\\s*${escapeRegex(rootTable)}\\.([^\\]]+?)\\s*\\]\\s*$`,
    'm'
  )
  const lines = content.split(/\r?\n/)
  let currentName: string | null = null
  let currentBody: Record<string, unknown> = {}
  for (const line of lines) {
    const headerMatch = line.match(tableOpen)
    if (headerMatch) {
      if (currentName) {
        servers[currentName] = currentBody
      }
      currentName = unquoteTomlKey(headerMatch[1])
      currentBody = {}
      continue
    }
    // A bare [mcp_servers] table or any other top-level table ends collection.
    if (/^\s*\[/.test(line)) {
      if (currentName) {
        servers[currentName] = currentBody
        currentName = null
        currentBody = {}
      }
      continue
    }
    if (currentName) {
      collectTomlBodyLine(currentBody, line)
    }
  }
  if (currentName) {
    servers[currentName] = currentBody
  }
  return servers
}

function collectTomlBodyLine(body: Record<string, unknown>, line: string): void {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)
  if (!m) {
    return
  }
  const [, key, rawValue] = m
  body[key] = rawValue.trim()
}

function unquoteTomlKey(key: string): string {
  const trimmed = key.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Extract a top-level `mcp_servers:` map from a YAML document without a full
 * YAML parser. Handles the common shape:
 *
 *   mcp_servers:
 *     fs:
 *       command: npx
 *       args: [...]
 *     http-thing:
 *       url: https://...
 *
 * We detect the indentation under the root key and group consecutive lines
 * whose indentation is strictly greater than the root key's.
 */
function extractYamlServerMap(content: string, rootKey: string): Record<string, unknown> {
  const servers: Record<string, Record<string, unknown>> = {}
  const lines = content.split(/\r?\n/)
  const rootIndent = detectYamlKeyIndent(lines, rootKey)
  if (rootIndent === null) {
    return servers
  }
  let i = 0
  // Advance to the line after the root key.
  while (i < lines.length && detectYamlKeyIndent(lines.slice(i), rootKey) !== 0) {
    i++
  }
  i++ // skip the root key line itself
  let currentName: string | null = null
  let currentBody: Record<string, unknown> = {}
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue
    }
    const indent = line.length - line.trimStart().length
    // A line at or below the root indent ends the block.
    if (indent <= rootIndent) {
      if (currentName) {
        servers[currentName] = currentBody
        currentName = null
        currentBody = {}
      }
      break
    }
    // Direct child of the root key → a server name entry ("name:" indented one level).
    const serverMatch = line.match(/^(\s+)([A-Za-z0-9_.-]+)\s*:\s*$/)
    if (serverMatch && serverMatch[1].length === rootIndent + 1 && !currentName) {
      // Actually any indentation > rootIndent that introduces a key with empty value
      // is a potential server entry; we treat the shallowest such indent as the
      // server level.
      currentName = serverMatch[2]
      currentBody = {}
      continue
    }
    // If this line is at a deeper indent than the current server name, it's a body field.
    if (currentName) {
      const fieldMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
      if (fieldMatch) {
        currentBody[fieldMatch[1]] = fieldMatch[2].trim()
      }
    }
  }
  if (currentName) {
    servers[currentName] = currentBody
  }
  return servers
}

function detectYamlKeyIndent(lines: string[], key: string): number | null {
  for (const line of lines) {
    if (line.trim().startsWith('#')) {
      continue
    }
    const m = line.match(/^(\s*)[A-Za-z0-9_.-]+\s*:/)
    if (m && line.trimStart().startsWith(`${key}:`)) {
      return m[1].length
    }
  }
  return null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Summarize one extracted server into the unified transport/endpoint shape.
 * Mirrors the transport classification in src/shared/mcp-config.ts
 * (resolveTransport) but operates on our loosely-typed body.
 */
export function summarizeExtractedServer(name: string, body: unknown): ExtractedMcpServer {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { name, transport: 'unknown', endpoint: null, envCount: 0 }
  }
  const raw = body as Record<string, unknown>
  const command = readAsString(raw.command)
  const url = readAsString(raw.url) ?? readAsString(raw.endpoint)
  const transport = resolveTransport(command, url)
  const envCount = countEnv(raw.env)
  return {
    name,
    transport,
    endpoint: url ?? command,
    envCount
  }
}

function readAsString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    // Strip surrounding TOML/YAML quotes.
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1)
    }
    return trimmed
  }
  return null
}

function resolveTransport(command: string | null, url: string | null): McpTransport {
  if (url) {
    if (/^https?:\/\//i.test(url)) {
      return 'http'
    }
    // Why: escape the second slash so the lexer doesn't read `// i` as a comment / division.
    if (/^sse:\/\//i.test(url) || /\/sse\b/i.test(url)) {
      return 'sse'
    }
    return 'http'
  }
  if (command) {
    return 'stdio'
  }
  return 'unknown'
}

function countEnv(env: unknown): number {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return 0
  }
  return Object.keys(env as Record<string, unknown>).length
}
