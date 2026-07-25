import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  FORMAPIS_RESOURCES_DIR_NAME,
  FORMAPIS_RESOURCES_SUBDIR,
  type CanonicalMcpServerInput,
  type CanonicalResource,
  type CanonicalStoreListing,
  type ResourceKind
} from '../../shared/resources'

/**
 * Canonical Formapis resource store: ~/.formapis/resources/<kind>/<name>/.
 *
 * This is the authoritative source from which resources are distributed
 * (symlinked/copied) to each agent's own directory. Read path:
 *
 *   ~/.formapis/resources/
 *     ├── mcp/<name>.json          # one JSON definition per MCP server
 *     ├── skill/<name>/SKILL.md    # a skill directory (like bundled skills)
 *     └── plugin/<name>/           # a plugin directory
 *
 * The directory layout intentionally mirrors what each agent expects on disk
 * for skills (dir + SKILL.md), so a canonical skill can be symlinked directly
 * into ~/.codex/skills/<name>, ~/.claude/skills/<name>, etc.
 */

/** Root of the canonical store: ~/.formapis/resources/. */
export function getCanonicalStoreRoot(homeDir: string = homedir()): string {
  return join(homeDir, FORMAPIS_RESOURCES_DIR_NAME, FORMAPIS_RESOURCES_SUBDIR)
}

/** Directory for one resource kind: ~/.formapis/resources/<kind>/. */
export function getCanonicalKindDir(kind: ResourceKind, homeDir: string = homedir()): string {
  return join(getCanonicalStoreRoot(homeDir), kind)
}

/** Canonical path for a named resource (dir for skill/plugin, file for mcp). */
export function getCanonicalResourcePath(
  kind: ResourceKind,
  name: string,
  homeDir: string = homedir()
): string {
  const sanitized = sanitizeResourceName(name)
  if (kind === 'mcp') {
    return join(getCanonicalKindDir('mcp', homeDir), `${sanitized}.json`)
  }
  return join(getCanonicalKindDir(kind, homeDir), sanitized)
}

function sanitizeResourceName(name: string): string {
  // Why: the name becomes a path segment; reject path separators and dots that
  // could escape the kind directory. Mirrors how skill dirs are plain slugs.
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Resource name must not be empty')
  }
  if (/[\\/:]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new Error(`Unsafe resource name: ${trimmed}`)
  }
  return trimmed
}

/** List every canonical resource across all kinds. */
export function listCanonicalResources(homeDir: string = homedir()): CanonicalStoreListing {
  const root = getCanonicalStoreRoot(homeDir)
  const kinds: ResourceKind[] = ['mcp', 'skill', 'plugin']
  const resources: CanonicalResource[] = []
  for (const kind of kinds) {
    const kindDir = join(root, kind)
    if (!existsSync(kindDir)) {
      continue
    }
    let entries: string[]
    try {
      entries = readdirSync(kindDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const resource = readCanonicalEntry(kind, kindDir, entry)
      if (resource) {
        resources.push(resource)
      }
    }
  }
  resources.sort((a, b) => {
    if (a.kind !== b.kind) {
      const order: Record<string, number> = { mcp: 0, skill: 1, plugin: 2 }
      return order[a.kind] - order[b.kind]
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  return { resources, scannedAt: Date.now() }
}

function readCanonicalEntry(
  kind: ResourceKind,
  kindDir: string,
  entry: string
): CanonicalResource | null {
  const fullPath = join(kindDir, entry)
  try {
    const stat = statSync(fullPath)
    if (kind === 'mcp') {
      if (!stat.isFile() || !entry.endsWith('.json')) {
        return null
      }
      const name = entry.slice(0, -5) // strip .json
      const parsed = safeReadJson(fullPath)
      return {
        kind: 'mcp',
        name,
        description: typeof parsed?.description === 'string' ? parsed.description : null,
        canonicalPath: fullPath,
        updatedAt: stat.mtimeMs
      }
    }
    // skill / plugin: directory
    if (!stat.isDirectory()) {
      return null
    }
    const description = readDirDescription(kind, fullPath)
    return {
      kind,
      name: entry,
      description,
      canonicalPath: fullPath,
      updatedAt: stat.mtimeMs
    }
  } catch {
    return null
  }
}

function readDirDescription(kind: ResourceKind, dirPath: string): string | null {
  if (kind === 'skill') {
    // Skill description lives in SKILL.md frontmatter.
    const skillFile = join(dirPath, 'SKILL.md')
    if (existsSync(skillFile)) {
      try {
        const text = readFileSync(skillFile, 'utf-8')
        const match = text.match(/^---\n[\s\S]*?description:\s*([\s\S]*?)\n---/m)
        if (match) {
          return match[1].trim().replace(/^['"]|['"]$/g, '')
        }
      } catch {
        // fall through
      }
    }
  }
  return null
}

function safeReadJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  return null
}

/**
 * Create a canonical MCP server definition file.
 * Overwrites if a definition with the same name already exists.
 */
export function createCanonicalMcpServer(
  input: CanonicalMcpServerInput,
  homeDir: string = homedir()
): string {
  const sanitized = sanitizeResourceName(input.name)
  const definition = {
    name: sanitized,
    description: input.description ?? null,
    transport: input.transport,
    command: input.command ?? null,
    args: input.args ?? [],
    url: input.url ?? null,
    env: input.env ?? {}
  }
  const targetPath = getCanonicalResourcePath('mcp', sanitized, homeDir)
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileAtomically(targetPath, `${JSON.stringify(definition, null, 2)}\n`)
  return targetPath
}

/**
 * Create a canonical skill directory with a starter SKILL.md.
 * Overwrites the SKILL.md if the directory already exists.
 */
export function createCanonicalSkill(
  name: string,
  description: string,
  homeDir: string = homedir()
): string {
  const sanitized = sanitizeResourceName(name)
  const dirPath = getCanonicalResourcePath('skill', sanitized, homeDir)
  mkdirSync(dirPath, { recursive: true })
  const skillMd = join(dirPath, 'SKILL.md')
  const content = `---
name: ${sanitized}
description: ${escapeYamlScalar(description)}
---

# ${sanitized}

${description || 'A Formapis-managed skill.'}
`
  writeFileAtomically(skillMd, content)
  return dirPath
}

function escapeYamlScalar(value: string): string {
  // Why: keep the frontmatter parseable for simple single-line descriptions.
  if (/[:#\n]/.test(value)) {
    return JSON.stringify(value)
  }
  return value
}

/** Remove a canonical resource (and its distributions are left as-is). */
export function removeCanonicalResource(
  kind: ResourceKind,
  name: string,
  homeDir: string = homedir()
): void {
  const path = getCanonicalResourcePath(kind, name, homeDir)
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true })
  }
}

/** Stable id for a canonical resource (used for distribution tracking). */
export function canonicalResourceId(kind: ResourceKind, name: string): string {
  return `canon-${createHash('sha1').update(`${kind}:${name}`).digest('hex').slice(0, 16)}`
}

/** The on-disk shape of a canonical MCP server definition file. */
export type CanonicalMcpFile = {
  name: string
  description: string | null
  transport: 'stdio' | 'http'
  command: string | null
  args: string[]
  url: string | null
  env: Record<string, string>
}

/** Read a canonical MCP server definition; returns null if missing or invalid. */
export function readCanonicalMcpServer(
  name: string,
  homeDir: string = homedir()
): CanonicalMcpFile | null {
  const filePath = getCanonicalResourcePath('mcp', name, homeDir)
  const parsed = safeReadJson(filePath)
  if (!parsed) {
    return null
  }
  const transport = parsed.transport === 'http' ? 'http' : 'stdio'
  return {
    name: typeof parsed.name === 'string' ? parsed.name : name,
    description: typeof parsed.description === 'string' ? parsed.description : null,
    transport,
    command: typeof parsed.command === 'string' ? parsed.command : null,
    args: Array.isArray(parsed.args)
      ? (parsed.args as unknown[]).filter((a): a is string => typeof a === 'string')
      : [],
    url: typeof parsed.url === 'string' ? parsed.url : null,
    env:
      parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
        ? Object.fromEntries(
            Object.entries(parsed.env as Record<string, unknown>).filter(
              ([, v]) => typeof v === 'string'
            ) as [string, string][]
          )
        : {}
  }
}
