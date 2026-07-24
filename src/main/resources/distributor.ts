import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentType } from '../../shared/agent-status-types'
import type { DistributeResult, DistributionStatus, ResourceKind } from '../../shared/resources'
import { getCanonicalResourcePath } from './canonical-store'
import { inspectLinkState, linkResourceToTarget, removeOwnedResource } from './link-utils'

/**
 * Resource distribution engine.
 *
 * Phase 1b-1 handles directory-shaped resources (skills, plugins): the canonical
 * directory is symlinked (or copied on Windows without dev mode) into each
 * agent's own resources directory. MCP servers (config-file entries) are
 * handled in Phase 1b-2 via read-modify-write of each agent's config.
 *
 * The set of target agents and their skill directories mirrors the scan roots
 * in src/main/skills/skill-discovery-sources.ts so that a distributed resource
 * is discoverable by both Formapis and the agent itself.
 */

type SkillTarget = {
  agent: AgentType
  /** Absolute skills directory, e.g. ~/.codex/skills. */
  skillsDir: string
}

/**
 * All agent ecosystems that host a skills directory, with their home paths.
 * Kept in sync with buildSkillDiscoverySources() in skill-discovery-sources.ts.
 */
export function buildSkillDistributionTargets(homeDir: string = homedir()): SkillTarget[] {
  return [
    { agent: 'codex', skillsDir: join(homeDir, '.codex', 'skills') },
    { agent: 'claude', skillsDir: join(homeDir, '.claude', 'skills') },
    { agent: 'cursor', skillsDir: join(homeDir, '.cursor', 'skills') },
    { agent: 'gemini', skillsDir: join(homeDir, '.gemini', 'skills') },
    { agent: 'grok', skillsDir: join(homeDir, '.grok', 'skills') },
    { agent: 'opencode', skillsDir: join(homeDir, '.config', 'opencode', 'skills') },
    { agent: 'pi', skillsDir: join(homeDir, '.pi', 'agent', 'skills') },
    { agent: 'antigravity', skillsDir: join(homeDir, '.gemini', 'antigravity', 'skills') }
  ]
}

/**
 * Distribute a canonical resource to all applicable agents.
 *
 * For skills/plugins: symlink the canonical directory into each agent's skills
 * directory. MCP servers are reported as 'unsupported' here (Phase 1b-2).
 */
export function distributeResource(
  kind: ResourceKind,
  name: string,
  options: {
    homeDir?: string
    /** Restrict distribution to these agents; undefined = all applicable. */
    agents?: AgentType[]
    preferCopy?: boolean
  } = {}
): DistributeResult {
  const homeDir = options.homeDir ?? homedir()
  const sourcePath = getCanonicalResourcePath(kind, name, homeDir)
  const statuses: DistributionStatus[] = []

  if (kind === 'mcp') {
    // Phase 1b-2 will implement read-modify-write for MCP config entries.
    return {
      resource: { kind, name },
      statuses: buildSkillDistributionTargets(homeDir).map((t) => ({
        agent: t.agent,
        targetPath: '',
        state: 'unsupported',
        note: 'MCP server distribution arrives in Phase 1b-2'
      }))
    }
  }

  const targets = buildSkillDistributionTargets(homeDir).filter(
    (t) => !options.agents || options.agents.includes(t.agent)
  )
  for (const target of targets) {
    const targetPath = join(target.skillsDir, name)
    const markerHome = target.skillsDir
    const entryKey = `${kind}-${name}`
    try {
      const result = linkResourceToTarget(sourcePath, targetPath, markerHome, entryKey, {
        preferCopy: options.preferCopy ?? false
      })
      statuses.push({ agent: target.agent, targetPath, state: result })
    } catch (error) {
      statuses.push({
        agent: target.agent,
        targetPath,
        state: 'foreign',
        note: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return { resource: { kind, name }, statuses }
}

/**
 * Inspect the current distribution state of a canonical resource without
 * mutating anything. Used by the UI to show checkmarks per agent.
 */
export function inspectDistribution(
  kind: ResourceKind,
  name: string,
  homeDir: string = homedir()
): DistributionStatus[] {
  const sourcePath = getCanonicalResourcePath(kind, name, homeDir)
  if (kind === 'mcp') {
    return buildSkillDistributionTargets(homeDir).map((t) => ({
      agent: t.agent,
      targetPath: '',
      state: 'unsupported' as const,
      note: 'MCP server distribution arrives in Phase 1b-2'
    }))
  }
  return buildSkillDistributionTargets(homeDir).map((target) => {
    const targetPath = join(target.skillsDir, name)
    const entryKey = `${kind}-${name}`
    return {
      agent: target.agent,
      targetPath,
      state: inspectLinkState(targetPath, target.skillsDir, entryKey, sourcePath)
    }
  })
}

/**
 * Remove a resource from all agents where we own it (symlink or recorded copy).
 * Foreign content is never touched.
 */
export function undistributeResource(
  kind: ResourceKind,
  name: string,
  homeDir: string = homedir()
): DistributionStatus[] {
  if (kind === 'mcp') {
    return inspectDistribution(kind, name, homeDir)
  }
  const sourcePath = getCanonicalResourcePath(kind, name, homeDir)
  return buildSkillDistributionTargets(homeDir).map((target) => {
    const targetPath = join(target.skillsDir, name)
    const entryKey = `${kind}-${name}`
    const removed = removeOwnedResource(targetPath, target.skillsDir, entryKey, sourcePath)
    return {
      agent: target.agent,
      targetPath,
      state: removed
        ? 'missing'
        : inspectLinkState(targetPath, target.skillsDir, entryKey, sourcePath)
    }
  })
}
