import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  WORKFLOW_NODE_YAML_API_VERSION,
  WORKFLOW_NODE_YAML_KIND,
  parseWorkflowNodeYaml,
  serializeWorkflowNodeYaml,
  type WorkflowNodeYaml,
  type WorkflowNodeYamlRecord
} from '../../shared/workflow-node-yaml'

/**
 * Registry of workflow-node YAML templates: ~/.formapis/workflow-nodes/<name>.yaml.
 *
 * Each file is a single WorkflowNodeYaml document (apiVersion formapis/v1,
 * kind WorkflowNode). Mirrors the agents-yaml registry: read, validate,
 * write, delete; invalid files are still listed with errors attached.
 */

const WORKFLOW_NODES_SUBDIR = 'workflow-nodes'

/** Directory holding workflow-node YAMLs: ~/.formapis/workflow-nodes/. */
export function getWorkflowNodeYamlDir(homeDir: string = homedir()): string {
  return join(homeDir, '.formapis', WORKFLOW_NODES_SUBDIR)
}

/** Path of one node's YAML file. */
export function getWorkflowNodeYamlPath(name: string, homeDir: string = homedir()): string {
  return join(getWorkflowNodeYamlDir(homeDir), `${sanitizeWorkflowNodeName(name)}.yaml`)
}

function sanitizeWorkflowNodeName(name: string): string {
  const trimmed = name.trim().toLowerCase()
  if (!trimmed || /[\\/:]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new Error(`Unsafe workflow-node name: ${name}`)
  }
  return trimmed
}

/** List all workflow-node YAMLs, each parsed + validated. Invalid ones are still listed with errors. */
export function listWorkflowNodeYamls(homeDir: string = homedir()): WorkflowNodeYamlRecord[] {
  const dir = getWorkflowNodeYamlDir(homeDir)
  if (!existsSync(dir)) {
    return []
  }
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const records: WorkflowNodeYamlRecord[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
      continue
    }
    const filePath = join(dir, entry)
    const record = readWorkflowNodeYamlFile(filePath)
    if (record) {
      records.push(record)
    }
  }
  records.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return records
}

function readWorkflowNodeYamlFile(filePath: string): WorkflowNodeYamlRecord | null {
  let raw: string
  let stat: { mtimeMs: number }
  try {
    raw = readFileSync(filePath, 'utf-8')
    stat = statSync(filePath)
  } catch {
    return null
  }
  const validation = parseWorkflowNodeYaml(raw)
  if (validation.valid && validation.node) {
    return recordFromNode(validation.node, filePath, stat.mtimeMs, raw, true, [])
  }
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
    role: '',
    toolsMcp: [],
    toolsSkills: [],
    toolsPlugins: [],
    inputs: [],
    outputs: [],
    filePath,
    updatedAt: stat.mtimeMs,
    raw,
    valid: false,
    validationErrors: validation.errors
  } satisfies WorkflowNodeYamlRecord
}

function recordFromNode(
  node: WorkflowNodeYaml,
  filePath: string,
  updatedAt: number,
  raw: string,
  valid: boolean,
  errors: string[]
): WorkflowNodeYamlRecord {
  return {
    name: node.metadata.name,
    displayName: node.metadata.display_name ?? node.metadata.name,
    description: node.metadata.description ?? '',
    version: node.metadata.version ?? '',
    role: node.spec.role,
    toolsMcp: node.spec.tools?.mcp ?? [],
    toolsSkills: node.spec.tools?.skills ?? [],
    toolsPlugins: node.spec.tools?.plugins ?? [],
    inputs: node.spec.inputs ?? [],
    outputs: node.spec.outputs ?? [],
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
export function saveWorkflowNodeYaml(
  name: string,
  rawYaml: string,
  homeDir: string = homedir()
): { record: WorkflowNodeYamlRecord; validation: { valid: boolean; errors: string[] } } {
  const dir = getWorkflowNodeYamlDir(homeDir)
  mkdirSync(dir, { recursive: true })
  const validation = parseWorkflowNodeYaml(rawYaml)
  const targetName =
    validation.valid && validation.node
      ? validation.node.metadata.name
      : sanitizeWorkflowNodeName(name)
  const filePath = getWorkflowNodeYamlPath(targetName, homeDir)
  writeFileAtomically(filePath, rawYaml.endsWith('\n') ? rawYaml : `${rawYaml}\n`)
  const stat = statSync(filePath)
  const record =
    validation.valid && validation.node
      ? recordFromNode(validation.node, filePath, stat.mtimeMs, rawYaml, true, [])
      : ({
          name: targetName,
          displayName: targetName,
          description: '',
          version: '',
          role: '',
          toolsMcp: [],
          toolsSkills: [],
          toolsPlugins: [],
          inputs: [],
          outputs: [],
          filePath,
          updatedAt: stat.mtimeMs,
          raw: rawYaml,
          valid: false,
          validationErrors: validation.errors
        } satisfies WorkflowNodeYamlRecord)
  return { record, validation: { valid: validation.valid, errors: validation.errors } }
}

/** Create a new workflow-node YAML from a partial spec, returning the saved record. */
export function createWorkflowNodeYaml(
  input: {
    name: string
    displayName?: string
    description?: string
    role: string
  },
  homeDir: string = homedir()
): WorkflowNodeYamlRecord {
  const node: WorkflowNodeYaml = {
    apiVersion: WORKFLOW_NODE_YAML_API_VERSION,
    kind: WORKFLOW_NODE_YAML_KIND,
    metadata: {
      name: sanitizeWorkflowNodeName(input.name),
      display_name: input.displayName,
      description: input.description
    },
    spec: {
      role: input.role
    }
  }
  const raw = serializeWorkflowNodeYaml(node)
  const { record } = saveWorkflowNodeYaml(input.name, raw, homeDir)
  return record
}

/** Delete a workflow-node YAML by name. */
export function removeWorkflowNodeYaml(name: string, homeDir: string = homedir()): void {
  const filePath = getWorkflowNodeYamlPath(name, homeDir)
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true })
  }
}

/** Read raw YAML text for one node (for the editor). */
export function readWorkflowNodeYamlRaw(name: string, homeDir: string = homedir()): string | null {
  const filePath = getWorkflowNodeYamlPath(name, homeDir)
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}
