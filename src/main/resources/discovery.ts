import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentType } from '../../shared/agent-status-types'
import type {
  DiscoveredResource,
  ResourceDiscoveryResult,
  ResourceDiscoverySource,
  ResourceScanRoot
} from '../../shared/resources'
import { discoverSkills } from '../skills/discovery'
import type { DiscoveredSkill } from '../../shared/skills'
import { buildMcpHomeCandidates, type McpHomeCandidate } from './mcp-discovery-sources'
import { parseMcpConfigDocument, summarizeExtractedServer } from './mcp-config-parsers'

/**
 * Unified resource discovery entry point.
 *
 * Aggregates three resource kinds:
 *  - skills: reuses Orca's mature discoverSkills() and reshapes each result.
 *  - mcp: scans each agent home config (buildMcpHomeCandidates) + the current
 *         workspace .mcp.json, parsing json/toml/yaml leniently.
 *  - plugin: reserved (Phase 1b). For now we return an empty list so the UI
 *            can show the tab as "coming soon".
 *
 * Dedup is by canonical id (kind + name + primaryPath hash) so the same MCP
 * server visible in two agents shows once with merged providers, mirroring
 * the skill discovery merge in src/main/skills/discovery.ts.
 */
export async function discoverResources(args: {
  cwd?: string | null
  homeDir?: string
}): Promise<ResourceDiscoveryResult> {
  const homeDir = args.homeDir ?? homedir()

  const mcpRoots = buildMcpScanRootsWithExistence(homeDir)
  const [mcpResources, skillResources, pluginResources] = await Promise.all([
    discoverMcpResources(mcpRoots, homeDir, args.cwd),
    discoverSkillResources({ homeDir, cwd: args.cwd }),
    Promise.resolve([] as DiscoveredResource[])
  ])

  const all = [...mcpResources, ...skillResources, ...pluginResources]
  const merged = dedupAndMerge(all)
  merged.sort(compareResources)

  return {
    resources: merged,
    sources: mcpRoots,
    scannedAt: Date.now()
  }
}

// ---------------------------------------------------------------------------
// Skills: reshape Orca's DiscoveredSkill into DiscoveredResource.
// ---------------------------------------------------------------------------

async function discoverSkillResources(args: {
  homeDir: string
  cwd?: string | null
}): Promise<DiscoveredResource[]> {
  let skillResult
  try {
    skillResult = await discoverSkills({ homeDir: args.homeDir, cwd: args.cwd ?? undefined })
  } catch {
    // Skill discovery should never block the whole resource view.
    return []
  }
  return skillResult.skills.map((s) => reshapeSkill(s))
}

function reshapeSkill(s: DiscoveredSkill): DiscoveredResource {
  return {
    id: stableResourceId(`skill:${s.skillFilePath}`),
    kind: 'skill',
    name: s.name,
    description: s.description,
    providers: [...s.providers] as AgentType[],
    owner: null,
    sourceKind: mapSkillSourceKind(s.sourceKind),
    sourceLabel: s.sourceLabel,
    rootPaths: s.rootPaths ?? [s.rootPath],
    status: s.installed ? 'active' : 'unknown',
    updatedAt: s.updatedAt,
    primaryPath: s.skillFilePath,
    detail: {
      kind: 'skill',
      skillFilePath: s.skillFilePath,
      fileCount: s.fileCount
    }
  }
}

function mapSkillSourceKind(kind: DiscoveredSkill['sourceKind']): DiscoveredResource['sourceKind'] {
  switch (kind) {
    case 'home':
      return 'home'
    case 'repo':
      return 'repo'
    case 'bundled':
      return 'bundled'
    case 'plugin':
      return 'plugin'
  }
}

// ---------------------------------------------------------------------------
// MCP: scan agent homes + workspace, parse, summarize.
// ---------------------------------------------------------------------------

async function discoverMcpResources(
  roots: ResourceDiscoverySource[],
  homeDir: string,
  cwd?: string | null
): Promise<DiscoveredResource[]> {
  const candidates = buildMcpHomeCandidates(homeDir)
  const out: DiscoveredResource[] = []

  for (const root of roots) {
    if (!root.exists) {
      continue
    }
    const candidate = candidates.find((c) => c.absolutePath === root.path)
    if (!candidate) {
      continue
    }
    const resources = await scanMcpCandidate(root, candidate)
    out.push(...resources)
  }

  // Workspace .mcp.json (the one Orca already understands).
  if (cwd) {
    const wsResources = await scanWorkspaceMcp(cwd)
    out.push(...wsResources)
  }

  return out
}

async function scanMcpCandidate(
  root: ResourceScanRoot,
  candidate: McpHomeCandidate
): Promise<DiscoveredResource[]> {
  let content: string
  try {
    content = await readFile(candidate.absolutePath, 'utf-8')
  } catch {
    return []
  }
  const doc = parseMcpConfigDocument(content, candidate.parser, candidate.serversPath)
  if (!doc) {
    return []
  }

  return Object.entries(doc.servers).map(([name, body]) => {
    const summary = summarizeExtractedServer(name, body)
    return {
      id: stableResourceId(`mcp:${candidate.absolutePath}:${name}`),
      kind: 'mcp' as const,
      name,
      description: null,
      providers: [candidate.agent],
      owner: candidate.agent,
      sourceKind: root.sourceKind,
      sourceLabel: root.label,
      rootPaths: [candidate.absolutePath],
      status: summary.transport === 'unknown' ? 'invalid' : 'active',
      updatedAt: null,
      primaryPath: candidate.absolutePath,
      detail: {
        kind: 'mcp' as const,
        transport: summary.transport,
        endpoint: summary.endpoint,
        envCount: summary.envCount
      }
    }
  })
}

async function scanWorkspaceMcp(cwd: string): Promise<DiscoveredResource[]> {
  // The workspace .mcp.json is the cross-agent shared MCP config; mark owner null.
  // We only parse json here (the documented workspace format).
  const wsPath = join(cwd, '.mcp.json')
  let content: string
  try {
    content = await readFile(wsPath, 'utf-8')
  } catch {
    return []
  }
  const doc = parseMcpConfigDocument(content, 'json', ['mcpServers'])
  if (!doc) {
    return []
  }
  return Object.entries(doc.servers).map(([name, body]) => {
    const summary = summarizeExtractedServer(name, body)
    return {
      id: stableResourceId(`mcp:${wsPath}:${name}`),
      kind: 'mcp' as const,
      name,
      description: null,
      providers: [],
      owner: null,
      sourceKind: 'repo' as const,
      sourceLabel: 'Workspace (.mcp.json)',
      rootPaths: [wsPath],
      status: summary.transport === 'unknown' ? 'invalid' : 'active',
      updatedAt: null,
      primaryPath: wsPath,
      detail: {
        kind: 'mcp' as const,
        transport: summary.transport,
        endpoint: summary.endpoint,
        envCount: summary.envCount
      }
    }
  })
}

function buildMcpScanRootsWithExistence(homeDir: string): ResourceDiscoverySource[] {
  const candidates = buildMcpHomeCandidates(homeDir)
  return candidates.map((c, index) => {
    const exists = existsSync(c.absolutePath)
    return {
      id: `mcp-home-${c.agent}-${index}`,
      kind: 'mcp' as const,
      label: c.label,
      path: c.absolutePath,
      sourceKind: 'home' as const,
      providers: [c.agent],
      owner: c.agent,
      exists,
      skippedReason: exists ? undefined : ('missing' as const)
    }
  })
}

// ---------------------------------------------------------------------------
// Dedup + merge (mirrors skill discovery merge logic).
// ---------------------------------------------------------------------------

function dedupAndMerge(resources: DiscoveredResource[]): DiscoveredResource[] {
  const seen = new Map<string, DiscoveredResource>()
  for (const r of resources) {
    const key = `${r.kind}:${r.name.toLowerCase()}:${stableHash(r.primaryPath)}`
    const existing = seen.get(key)
    if (existing) {
      // Merge providers and rootPaths; keep the first record's identity fields.
      for (const p of r.providers) {
        if (!existing.providers.includes(p)) {
          existing.providers.push(p)
        }
      }
      for (const rp of r.rootPaths) {
        if (!existing.rootPaths.includes(rp)) {
          existing.rootPaths.push(rp)
        }
      }
      continue
    }
    seen.set(key, { ...r, providers: [...r.providers], rootPaths: [...r.rootPaths] })
  }
  return Array.from(seen.values())
}

function compareResources(a: DiscoveredResource, b: DiscoveredResource): number {
  if (a.kind !== b.kind) {
    const order: Record<string, number> = { mcp: 0, skill: 1, plugin: 2 }
    return order[a.kind] - order[b.kind]
  }
  if (a.name !== b.name) {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  }
  return a.sourceLabel.localeCompare(b.sourceLabel, undefined, { sensitivity: 'base' })
}

function stableHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 16)
}

function stableResourceId(value: string): string {
  return `res-${createHash('sha1').update(value).digest('hex').slice(0, 16)}`
}
