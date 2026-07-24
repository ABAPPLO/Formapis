import type { AgentType } from './agent-status-types'

/**
 * Unified resource layer for Formapis.
 *
 * Orca already has a mature skill discovery framework (src/shared/skills.ts,
 * src/main/skills/). This module generalizes that pattern to cover three
 * resource kinds — MCP servers, Skills, and Plugins — so they can be discovered
 * and (in later phases) distributed from a single canonical source
 * (~/.formapis/resources/) to each agent's own config directory.
 *
 * Phase 1a (this file + discovery): read-only aggregation. We discover what
 * each agent already has on disk and surface it in one view.
 * Phase 1b (later): write/distribute — canonical definitions + symlink/copy
 * to agent homes, reusing codex-home-paths.ts ownership-marker approach.
 */

/** The three resource kinds Formapis unifies. */
export type ResourceKind = 'mcp' | 'skill' | 'plugin'

/**
 * Where a discovered resource record lives.
 *
 * Mirrors SkillSourceKind ('home' | 'repo' | 'bundled' | 'plugin') but adds
 * `canonical` — the Formapis-managed authoritative copy under
 * ~/.formapis/resources/. Agent-owned copies are `home`; repo-scoped are `repo`;
 * bundled-with-app are `bundled`; third-party plugin caches stay `plugin`.
 */
export type ResourceSourceKind = 'canonical' | 'home' | 'repo' | 'bundled' | 'plugin'

/** Transport for an MCP server (mirrors src/shared/mcp-config.ts). */
export type McpTransport = 'stdio' | 'http' | 'sse' | 'unknown'

/** Status of a single discovered resource, uniform across kinds. */
export type ResourceStatus = 'active' | 'disabled' | 'invalid' | 'unknown'

/**
 * Per-kind payload. Kept as a discriminated union so the UI can render
 * kind-specific detail (e.g. MCP transport/command, skill file count) while
 * the shared fields (name/description/providers/owner/sourceKind) stay uniform.
 */
export type McpResourceDetail = {
  transport: McpTransport
  /** stdio command or http/sse url, whichever applies. */
  endpoint: string | null
  /** Number of env vars (values are never sent to the renderer — masked upstream). */
  envCount: number
}

export type SkillResourceDetail = {
  /** Absolute path of the SKILL.md file. */
  skillFilePath: string
  /** Number of files in the skill directory (bounded, like skill discovery). */
  fileCount: number
}

export type PluginResourceDetail = {
  /** Plugin version if declared in its manifest, else null. */
  version: string | null
  /** Absolute path of the plugin manifest/root. */
  pluginPath: string
}

export type ResourceDetail =
  | ({ kind: 'mcp' } & McpResourceDetail)
  | ({ kind: 'skill' } & SkillResourceDetail)
  | ({ kind: 'plugin' } & PluginResourceDetail)

/**
 * One discovered resource record. Analogous to DiscoveredSkill but generalized.
 *
 * `providers` follows the SkillProvider semantics: which agent ecosystems
 * can see this resource. `owner: null` marks the explicit shared scope
 * (e.g. ~/.agents/skills or ~/.formapis/resources/).
 */
export type DiscoveredResource = {
  /** Stable id derived from canonical path + kind (see stableResourceId). */
  id: string
  kind: ResourceKind
  name: string
  description: string | null
  /** Agent ecosystems that can see this resource. */
  providers: AgentType[]
  /** Owning agent; null = shared scope. Mirrors SkillDiscoverySource.owner. */
  owner: AgentType | null
  sourceKind: ResourceSourceKind
  /** Human-readable origin label, e.g. "Claude home", "Workspace", "Canonical". */
  sourceLabel: string
  /** Every scan root that reached this resource (survives canonical dedup). */
  rootPaths: string[]
  status: ResourceStatus
  updatedAt: number | null
  /** Absolute path of the resource's primary file/dir on the scanning host. */
  primaryPath: string
  /** Kind-specific fields. */
  detail: ResourceDetail
}

/**
 * A scan root for resource discovery. Generalizes SkillScanRoot
 * (Omit<SkillDiscoverySource,'exists'|'skippedReason'>) with a `kind` axis.
 */
export type ResourceScanRoot = {
  id: string
  kind: ResourceKind
  label: string
  path: string
  sourceKind: ResourceSourceKind
  providers: AgentType[]
  owner: AgentType | null
}

/** A scan root annotated with on-disk existence (returned to the renderer). */
export type ResourceDiscoverySource = ResourceScanRoot & {
  exists: boolean
  skippedReason?: 'missing'
}

export type ResourceDiscoveryResult = {
  resources: DiscoveredResource[]
  sources: ResourceDiscoverySource[]
  scannedAt: number
}

/** Canonical Formapis resource directory: ~/.formapis/resources/<kind>/. */
export const FORMAPIS_RESOURCES_DIR_NAME = '.formapis'
export const FORMAPIS_RESOURCES_SUBDIR = 'resources'

/** Filter state for the ResourcesPage (mirrors SkillsFilterState). */
export type ResourcesFilterState = {
  query: string
  kind: ResourceKind | 'all'
  sourceKind: ResourceSourceKind | 'all'
}
