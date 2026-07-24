import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  parseScenarioYaml,
  serializeScenarioYaml,
  SCENARIO_YAML_API_VERSION,
  SCENARIO_YAML_KIND,
  type ScenarioRecord,
  type ScenarioYaml
} from '../../shared/scenario-yaml'

/**
 * Registry of Scenario YAMLs: ~/.formapis/scenarios/<name>.yaml.
 * Mirrors agents-yaml/registry.ts in shape.
 */

const SCENARIOS_SUBDIR = 'scenarios'

export function getScenarioYamlDir(homeDir: string = homedir()): string {
  return join(homeDir, '.formapis', SCENARIOS_SUBDIR)
}

export function getScenarioYamlPath(name: string, homeDir: string = homedir()): string {
  return join(getScenarioYamlDir(homeDir), `${sanitizeScenarioName(name)}.yaml`)
}

function sanitizeScenarioName(name: string): string {
  const trimmed = name.trim().toLowerCase()
  if (!trimmed || /[\\/:]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new Error(`Unsafe scenario name: ${name}`)
  }
  return trimmed
}

export function listScenarioYamls(homeDir: string = homedir()): ScenarioRecord[] {
  const dir = getScenarioYamlDir(homeDir)
  if (!existsSync(dir)) {
    return []
  }
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const records: ScenarioRecord[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
      continue
    }
    const filePath = join(dir, entry)
    const record = readScenarioFile(filePath)
    if (record) {
      records.push(record)
    }
  }
  records.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return records
}

function readScenarioFile(filePath: string): ScenarioRecord | null {
  let raw: string
  let stat: { mtimeMs: number }
  try {
    raw = readFileSync(filePath, 'utf-8')
    stat = statSync(filePath)
  } catch {
    return null
  }
  const validation = parseScenarioYaml(raw)
  if (validation.valid && validation.scenario) {
    return recordFromScenario(validation.scenario, filePath, stat.mtimeMs, raw, true, [])
  }
  const fallbackName =
    filePath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.ya?ml$/, '') ?? 'unknown'
  return {
    name: fallbackName,
    description: '',
    mode: 'orchestrated',
    agentRefs: [],
    taskCount: 0,
    filePath,
    updatedAt: stat.mtimeMs,
    raw,
    valid: false,
    validationErrors: validation.errors
  } satisfies ScenarioRecord
}

function recordFromScenario(
  scenario: ScenarioYaml,
  filePath: string,
  updatedAt: number,
  raw: string,
  valid: boolean,
  errors: string[]
): ScenarioRecord {
  return {
    name: scenario.metadata.name,
    description: scenario.metadata.description ?? '',
    mode: scenario.spec.mode,
    agentRefs: scenario.spec.agents.map((a) => a.ref),
    taskCount: scenario.spec.tasks?.length ?? 0,
    filePath,
    updatedAt,
    raw,
    valid,
    validationErrors: errors
  }
}

export function saveScenarioYaml(
  name: string,
  rawYaml: string,
  homeDir: string = homedir()
): { record: ScenarioRecord; valid: boolean; errors: string[] } {
  const dir = getScenarioYamlDir(homeDir)
  mkdirSync(dir, { recursive: true })
  const validation = parseScenarioYaml(rawYaml)
  const targetName =
    validation.valid && validation.scenario
      ? validation.scenario.metadata.name
      : sanitizeScenarioName(name)
  const filePath = getScenarioYamlPath(targetName, homeDir)
  writeFileAtomically(filePath, rawYaml.endsWith('\n') ? rawYaml : `${rawYaml}\n`)
  const stat = statSync(filePath)
  const record =
    validation.valid && validation.scenario
      ? recordFromScenario(validation.scenario, filePath, stat.mtimeMs, rawYaml, true, [])
      : ({
          name: targetName,
          description: '',
          mode: 'orchestrated',
          agentRefs: [],
          taskCount: 0,
          filePath,
          updatedAt: stat.mtimeMs,
          raw: rawYaml,
          valid: false,
          validationErrors: validation.errors
        } satisfies ScenarioRecord)
  return { record, valid: validation.valid, errors: validation.errors }
}

export function createScenarioYaml(
  input: {
    name: string
    description?: string
    mode?: 'orchestrated' | 'autonomous'
    agentRefs: string[]
    supervisor?: string
    goal?: string
  },
  homeDir: string = homedir()
): ScenarioRecord {
  const scenario: ScenarioYaml = {
    apiVersion: SCENARIO_YAML_API_VERSION,
    kind: SCENARIO_YAML_KIND,
    metadata: {
      name: sanitizeScenarioName(input.name),
      description: input.description
    },
    spec: {
      mode: input.mode ?? 'orchestrated',
      agents: input.agentRefs.map((ref) => ({ ref })),
      supervisor: input.supervisor,
      goal: input.goal
    }
  }
  const raw = serializeScenarioYaml(scenario)
  const { record } = saveScenarioYaml(input.name, raw, homeDir)
  return record
}

export function removeScenarioYaml(name: string, homeDir: string = homedir()): void {
  const filePath = getScenarioYamlPath(name, homeDir)
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true })
  }
}

export function readScenarioYamlRaw(name: string, homeDir: string = homedir()): string | null {
  const filePath = getScenarioYamlPath(name, homeDir)
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}
