import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  AGENT_YAML_API_VERSION,
  AGENT_YAML_KIND,
  parseAgentYaml,
  serializeAgentYaml,
  type AgentYaml,
  type AgentYamlRecord
} from '../../shared/agent-yaml'

/**
 * Registry of YAML agent definitions: ~/.formapis/agents/<name>.yaml.
 *
 * Each file is a single AgentYaml document (apiVersion formapis/v1, kind Agent).
 * The registry reads, validates, writes, and deletes these files. Distribution
 * and try-run live in distributor.ts / runner.ts.
 */

const AGENTS_SUBDIR = 'agents'

/** Directory holding agent YAMLs: ~/.formapis/agents/. */
export function getAgentYamlDir(homeDir: string = homedir()): string {
  return join(homeDir, '.formapis', AGENTS_SUBDIR)
}

/** Path of one agent's YAML file. */
export function getAgentYamlPath(name: string, homeDir: string = homedir()): string {
  return join(getAgentYamlDir(homeDir), `${sanitizeAgentName(name)}.yaml`)
}

function sanitizeAgentName(name: string): string {
  const trimmed = name.trim().toLowerCase()
  if (!trimmed || /[\\/:]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new Error(`Unsafe agent name: ${name}`)
  }
  return trimmed
}

/** List all agent YAMLs, each parsed + validated. Invalid ones are still listed with errors. */
export function listAgentYamls(homeDir: string = homedir()): AgentYamlRecord[] {
  const dir = getAgentYamlDir(homeDir)
  if (!existsSync(dir)) {
    return []
  }
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const records: AgentYamlRecord[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
      continue
    }
    const filePath = join(dir, entry)
    const record = readAgentYamlFile(filePath)
    if (record) {
      records.push(record)
    }
  }
  records.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return records
}

function readAgentYamlFile(filePath: string): AgentYamlRecord | null {
  let raw: string
  let stat: { mtimeMs: number }
  try {
    raw = readFileSync(filePath, 'utf-8')
    stat = statSync(filePath)
  } catch {
    return null
  }
  const validation = parseAgentYaml(raw)
  if (validation.valid && validation.agent) {
    return recordFromAgent(validation.agent, filePath, stat.mtimeMs, raw, true, [])
  }
  // Invalid YAML — still surface it so the editor can show errors; derive name from filename.
  const fallbackName =
    filePath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.ya?ml$/, '') ?? 'unknown'
  return {
    name: fallbackName,
    displayName: fallbackName,
    description: '',
    version: '',
    provider: 'claude',
    runtimeType: undefined,
    role: '',
    toolsMcp: [],
    toolsSkills: [],
    toolsPlugins: [],
    filePath,
    updatedAt: stat.mtimeMs,
    raw,
    valid: false,
    validationErrors: validation.errors
  } satisfies AgentYamlRecord
}

function recordFromAgent(
  agent: AgentYaml,
  filePath: string,
  updatedAt: number,
  raw: string,
  valid: boolean,
  errors: string[]
): AgentYamlRecord {
  return {
    name: agent.metadata.name,
    displayName: agent.metadata.display_name ?? agent.metadata.name,
    description: agent.metadata.description ?? '',
    version: agent.metadata.version ?? '',
    provider: agent.spec.runtime.provider,
    runtimeType: agent.spec.runtime.type,
    role: agent.spec.role,
    toolsMcp: agent.spec.tools?.mcp ?? [],
    toolsSkills: agent.spec.tools?.skills ?? [],
    toolsPlugins: agent.spec.tools?.plugins ?? [],
    filePath,
    updatedAt,
    raw,
    valid,
    validationErrors: errors
  }
}

/**
 * Save raw YAML text to <name>.yaml. Validates first; returns the validation
 * result so the UI can report errors. Even invalid YAML is saved (so the user
 * can keep editing) but flagged.
 */
export function saveAgentYaml(
  name: string,
  rawYaml: string,
  homeDir: string = homedir()
): { record: AgentYamlRecord; validation: { valid: boolean; errors: string[] } } {
  const dir = getAgentYamlDir(homeDir)
  mkdirSync(dir, { recursive: true })
  const validation = parseAgentYaml(rawYaml)
  const targetName =
    validation.valid && validation.agent ? validation.agent.metadata.name : sanitizeAgentName(name)
  const filePath = getAgentYamlPath(targetName, homeDir)
  writeFileAtomically(filePath, rawYaml.endsWith('\n') ? rawYaml : `${rawYaml}\n`)
  const stat = statSync(filePath)
  const record =
    validation.valid && validation.agent
      ? recordFromAgent(validation.agent, filePath, stat.mtimeMs, rawYaml, true, [])
      : ({
          name: targetName,
          displayName: targetName,
          description: '',
          version: '',
          provider: 'claude',
          runtimeType: undefined,
          role: '',
          toolsMcp: [],
          toolsSkills: [],
          toolsPlugins: [],
          filePath,
          updatedAt: stat.mtimeMs,
          raw: rawYaml,
          valid: false,
          validationErrors: validation.errors
        } satisfies AgentYamlRecord)
  return { record, validation: { valid: validation.valid, errors: validation.errors } }
}

/** Create a new agent YAML from a partial spec, returning the saved record. */
export function createAgentYaml(
  input: {
    name: string
    displayName?: string
    description?: string
    provider: AgentYaml['spec']['runtime']['provider']
    role: string
  },
  homeDir: string = homedir()
): AgentYamlRecord {
  const agent: AgentYaml = {
    apiVersion: AGENT_YAML_API_VERSION,
    kind: AGENT_YAML_KIND,
    metadata: {
      name: sanitizeAgentName(input.name),
      display_name: input.displayName,
      description: input.description
    },
    spec: {
      runtime: { provider: input.provider },
      role: input.role
    }
  }
  const raw = serializeAgentYaml(agent)
  const { record } = saveAgentYaml(input.name, raw, homeDir)
  return record
}

/** Delete an agent YAML by name. */
export function removeAgentYaml(name: string, homeDir: string = homedir()): void {
  const filePath = getAgentYamlPath(name, homeDir)
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true })
  }
}

/** Read raw YAML text for one agent (for the editor). */
export function readAgentYamlRaw(name: string, homeDir: string = homedir()): string | null {
  const filePath = getAgentYamlPath(name, homeDir)
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}
