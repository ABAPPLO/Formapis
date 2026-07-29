/* eslint-disable max-lines */
/* oxlint-disable max-lines -- Why: workflow-node-yaml.ts bundles the zod schema, types, and a self-contained minimal YAML reader/writer for the node schema subset; splitting the parser out would orphan it from the schema it round-trips. */
import { z } from 'zod'

/**
 * WorkflowNode YAML schema for Formapis (apiVersion: formapis/v1, kind: WorkflowNode).
 *
 * A WorkflowNode is a reusable node template for the workflow canvas. Like an
 * Agent it declares a role + tools, but it is a logical node rather than a
 * bound CLI: which agent runs it (and thus which provider) is decided when the
 * node is placed into a Scenario/task. Optional inputs/outputs describe the
 * node's data contract for future canvas data-flow wiring.
 *
 *   apiVersion: formapis/v1
 *   kind: WorkflowNode
 *   metadata:
 *     name: review-pr
 *     display_name: 代码审查节点
 *     description: 审查 PR 质量
 *   spec:
 *     role: |
 *       你是一个严格的代码审查节点。
 *     tools:
 *       mcp: [filesystem, github]
 *       skills: [orchestration]
 *     inputs: [pr_url]
 *     outputs: [review_summary]
 *     behavior:
 *       max_turns: 30
 *
 * Phase 1 covers define/load/list/validate/edit/save. Phase 2 wires nodes into
 * the canvas via orchestration.taskCreate.
 */

export const WORKFLOW_NODE_YAML_API_VERSION = 'formapis/v1'
export const WORKFLOW_NODE_YAML_KIND = 'WorkflowNode'

const kebabName = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 'name must be lowercase kebab-case')

export const WorkflowNodeYamlSchema = z.object({
  apiVersion: z.literal(WORKFLOW_NODE_YAML_API_VERSION),
  kind: z.literal(WORKFLOW_NODE_YAML_KIND),
  metadata: z.object({
    name: kebabName,
    display_name: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional()
  }),
  spec: z.object({
    role: z.string(),
    tools: z
      .object({
        mcp: z.array(z.string()).optional(),
        skills: z.array(z.string()).optional(),
        plugins: z.array(z.string()).optional()
      })
      .optional(),
    inputs: z.array(z.string()).optional(),
    outputs: z.array(z.string()).optional(),
    behavior: z
      .object({
        max_turns: z.number().int().positive().optional()
      })
      .optional()
  })
})

export type WorkflowNodeYaml = z.infer<typeof WorkflowNodeYamlSchema>

export type WorkflowNodeYamlValidation = {
  valid: boolean
  errors: string[]
  node?: WorkflowNodeYaml
}

/**
 * Listing record returned to the renderer. Denormalized so the list pane
 * renders without re-parsing; carries raw text + validity for the editor.
 */
export type WorkflowNodeYamlRecord = {
  name: string
  displayName: string
  description: string
  version: string
  role: string
  toolsMcp: string[]
  toolsSkills: string[]
  toolsPlugins: string[]
  inputs: string[]
  outputs: string[]
  filePath: string
  updatedAt: number
  raw: string
  valid: boolean
  validationErrors: string[]
}

// ─── minimal YAML reader/writer for the node schema subset ──────────────────
//
// Why custom: the project has no YAML dependency, and node YAML uses only a
// small subset (nested maps, string lists, multi-line block scalars, plain
// scalars). Mirrors the agent-yaml/scenario-yaml per-file parser convention.

/** Serialize a WorkflowNodeYaml object to YAML text (formapis/v1 layout). */
export function serializeWorkflowNodeYaml(node: WorkflowNodeYaml): string {
  const lines: string[] = []
  lines.push(`apiVersion: ${node.apiVersion}`)
  lines.push(`kind: ${node.kind}`)
  lines.push('metadata:')
  lines.push(`  name: ${node.metadata.name}`)
  if (node.metadata.display_name) {
    lines.push(`  display_name: ${yamlScalar(node.metadata.display_name)}`)
  }
  if (node.metadata.description) {
    lines.push(`  description: ${yamlScalar(node.metadata.description)}`)
  }
  if (node.metadata.version) {
    lines.push(`  version: ${node.metadata.version}`)
  }
  lines.push('spec:')
  lines.push(`  role: ${yamlBlockOrScalar(node.spec.role)}`)
  if (node.spec.tools) {
    lines.push('  tools:')
    emitStringList(lines, '    mcp', node.spec.tools.mcp)
    emitStringList(lines, '    skills', node.spec.tools.skills)
    emitStringList(lines, '    plugins', node.spec.tools.plugins)
  }
  emitStringList(lines, '  inputs', node.spec.inputs)
  emitStringList(lines, '  outputs', node.spec.outputs)
  if (node.spec.behavior) {
    lines.push('  behavior:')
    if (node.spec.behavior.max_turns !== undefined) {
      lines.push(`    max_turns: ${node.spec.behavior.max_turns}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function emitStringList(lines: string[], header: string, items: string[] | undefined): void {
  if (!items || items.length === 0) {
    return
  }
  lines.push(`${header}:`)
  for (const item of items) {
    lines.push(`      - ${item}`)
  }
}

/** Parse and validate YAML text into a WorkflowNodeYaml. Never throws. */
export function parseWorkflowNodeYaml(text: string): WorkflowNodeYamlValidation {
  let parsed: unknown
  try {
    parsed = parseYamlSubset(text)
  } catch (error) {
    return {
      valid: false,
      errors: [`YAML parse error: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
  const result = WorkflowNodeYamlSchema.safeParse(parsed)
  if (result.success) {
    return { valid: true, errors: [], node: result.data }
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  }
}

function yamlScalar(value: string): string {
  // Why: quote strings that could be misread (contain : # @ or start with special chars).
  if (/[:#@\n!'"{},&*?|>%@`]/.test(value) || /^\s|\s$/.test(value) || value === '') {
    return JSON.stringify(value)
  }
  return value
}

function yamlBlockOrScalar(value: string): string {
  // Why: multi-line strings use the | block scalar; single-line use inline.
  if (value.includes('\n')) {
    const indented = value
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n')
    return `|\n${indented}`
  }
  return yamlScalar(value)
}

// ─── minimal YAML parser (subset: maps, lists, block scalars, plain scalars) ─

// eslint-disable-next-line consistent-indexed-object-style -- Why: Record<string, YamlValue> triggers a circular type-alias reference (TS2456); an index signature is the only form that supports recursive type aliases here.
type YamlValue = string | number | boolean | YamlValue[] | { [key: string]: YamlValue }

function parseYamlSubset(text: string): unknown {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  return parseBlock(lines, 0, 0).value
}

function parseBlock(
  lines: string[],
  startIdx: number,
  indent: number
): { value: YamlValue; nextIdx: number } {
  let idx = startIdx
  while (idx < lines.length && (lines[idx].trim() === '' || lines[idx].trim().startsWith('#'))) {
    idx++
  }
  if (idx >= lines.length) {
    return { value: {}, nextIdx: idx }
  }
  const firstLine = lines[idx]
  const firstIndent = lineIndent(firstLine)
  if (firstIndent < indent) {
    return { value: {}, nextIdx: idx }
  }
  if (firstLine.trimStart().startsWith('- ')) {
    return parseList(lines, idx, firstIndent)
  }
  return parseMap(lines, idx, firstIndent)
}

function parseMap(
  lines: string[],
  startIdx: number,
  indent: number
): { value: Record<string, YamlValue>; nextIdx: number } {
  const result: Record<string, YamlValue> = {}
  let idx = startIdx
  while (idx < lines.length) {
    const line = lines[idx]
    if (line.trim() === '' || line.trim().startsWith('#')) {
      idx++
      continue
    }
    const curIndent = lineIndent(line)
    if (curIndent < indent) {
      break
    }
    if (curIndent > indent) {
      idx++
      continue
    }
    if (line.trimStart().startsWith('- ')) {
      break
    }
    const colonIdx = findColon(line)
    if (colonIdx < 0) {
      idx++
      continue
    }
    const key = line.slice(indent, colonIdx).trim()
    const after = line.slice(colonIdx + 1).trim()
    idx++
    if (after === '' || after === '|' || after === '>') {
      if (after === '|' || after === '>') {
        const block = gatherBlockScalar(lines, idx, indent, after === '|')
        result[key] = block.value
        idx = block.nextIdx
      } else {
        const child = parseBlock(lines, idx, indent + 1)
        if (isObject(child.value) && Object.keys(child.value).length === 0) {
          const peekIdx = skipBlank(lines, idx)
          if (peekIdx < lines.length && lines[peekIdx].trimStart().startsWith('- ')) {
            const listChild = parseList(lines, peekIdx, lineIndent(lines[peekIdx]))
            result[key] = listChild.value
            idx = listChild.nextIdx
          } else {
            result[key] = child.value
            idx = child.nextIdx
          }
        } else {
          result[key] = child.value
          idx = child.nextIdx
        }
      }
    } else {
      result[key] = parseScalar(after)
    }
  }
  return { value: result, nextIdx: idx }
}

function parseList(
  lines: string[],
  startIdx: number,
  indent: number
): { value: YamlValue[]; nextIdx: number } {
  const result: YamlValue[] = []
  let idx = startIdx
  while (idx < lines.length) {
    const line = lines[idx]
    if (line.trim() === '' || line.trim().startsWith('#')) {
      idx++
      continue
    }
    const curIndent = lineIndent(line)
    if (curIndent < indent) {
      break
    }
    if (curIndent > indent) {
      idx++
      continue
    }
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('- ')) {
      break
    }
    const itemValue = trimmed.slice(2).trim()
    idx++
    if (itemValue === '') {
      const child = parseBlock(lines, idx, indent + 1)
      result.push(child.value)
      idx = child.nextIdx
    } else {
      result.push(parseScalar(itemValue))
    }
  }
  return { value: result, nextIdx: idx }
}

function gatherBlockScalar(
  lines: string[],
  startIdx: number,
  parentIndent: number,
  literal: boolean
): { value: string; nextIdx: number } {
  const collected: string[] = []
  let idx = startIdx
  let blockIndent = -1
  while (idx < lines.length) {
    const line = lines[idx]
    if (line.trim() === '') {
      collected.push('')
      idx++
      continue
    }
    const curIndent = lineIndent(line)
    if (curIndent <= parentIndent) {
      break
    }
    if (blockIndent < 0) {
      blockIndent = curIndent
    }
    collected.push(line.slice(blockIndent))
    idx++
  }
  while (collected.length > 0 && collected.at(-1) === '') {
    collected.pop()
  }
  return {
    value: literal ? collected.join('\n') : collected.join(' ').replace(/\s+/g, ' '),
    nextIdx: idx
  }
}

function parseScalar(raw: string): YamlValue {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  if (trimmed === 'true') {
    return true
  }
  if (trimmed === 'false') {
    return false
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10)
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return Number.parseFloat(trimmed)
  }
  const commentIdx = trimmed.indexOf(' #')
  return commentIdx >= 0 ? trimmed.slice(0, commentIdx).trim() : trimmed
}

function lineIndent(line: string): number {
  return line.length - line.trimStart().length
}

function findColon(line: string): number {
  const trimmed = line.trimStart()
  const colonIdx = trimmed.indexOf(':')
  return colonIdx >= 0 ? line.length - trimmed.length + colonIdx : -1
}

function skipBlank(lines: string[], idx: number): number {
  while (idx < lines.length && (lines[idx].trim() === '' || lines[idx].trim().startsWith('#'))) {
    idx++
  }
  return idx
}

function isObject(value: unknown): value is Record<string, YamlValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
