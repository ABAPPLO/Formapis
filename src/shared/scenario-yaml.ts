/* eslint-disable max-lines */
/* oxlint-disable max-lines -- Why: scenario-yaml.ts bundles the zod schema, types, assignee-spec codec, and a self-contained minimal YAML reader/writer; splitting the parser out would orphan it from the schema it round-trips. */
import { z } from 'zod'

/**
 * Scenario YAML schema for Formapis (apiVersion: formapis/v1, kind: Scenario).
 *
 * A Scenario binds multiple YAML agents (from Phase 2) into a task DAG and runs
 * it through Orca's orchestration engine. Two modes:
 *
 *   orchestrated — tasks form an explicit DAG (deps + gates); the coordinator
 *                  dispatches each task to an agent terminal.
 *   autonomous   — a supervisor agent receives the goal and orchestrates other
 *                  agents itself via the orca orchestration CLI.
 *
 * Example:
 *
 *   apiVersion: formapis/v1
 *   kind: Scenario
 *   metadata:
 *     name: release-feature
 *   spec:
 *     mode: orchestrated
 *     agents:
 *       - ref: code-reviewer
 *       - ref: test-writer
 *     tasks:
 *       - id: review
 *         assignee: code-reviewer
 *         spec: "Review PR #123 for quality and security."
 *       - id: tests
 *         assignee: test-writer
 *         spec: "Add unit tests for the new module."
 *         deps: [review]
 *       - id: release
 *         assignee: code-reviewer
 *         spec: "Merge and tag v1.2.0."
 *         deps: [tests]
 *         gate: human-approval
 */

export const SCENARIO_YAML_API_VERSION = 'formapis/v1'
export const SCENARIO_YAML_KIND = 'Scenario'

export const ScenarioTaskSchema = z.object({
  id: z.string().min(1),
  /** Agent name (must match a metadata.name from an Agent YAML). */
  assignee: z.string().min(1),
  spec: z.string().min(1),
  deps: z.array(z.string()).optional(),
  /** Gate name; when set, the task blocks at a decision_gate until resolved. */
  gate: z.string().optional()
})

export const ScenarioYamlSchema = z.object({
  apiVersion: z.literal(SCENARIO_YAML_API_VERSION),
  kind: z.literal(SCENARIO_YAML_KIND),
  metadata: z.object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 'name must be lowercase kebab-case'),
    description: z.string().optional(),
    version: z.string().optional()
  }),
  spec: z.object({
    mode: z.enum(['orchestrated', 'autonomous']).default('orchestrated'),
    agents: z.array(z.object({ ref: z.string().min(1) })).min(1, 'at least one agent is required'),
    /** Required for orchestrated mode; ignored for autonomous. */
    tasks: z.array(ScenarioTaskSchema).optional(),
    /** Required for autonomous mode: the supervisor agent name. */
    supervisor: z.string().optional(),
    /** Goal text handed to the supervisor in autonomous mode. */
    goal: z.string().optional(),
    /** Coordinator concurrency (defaults to agent count). */
    maxConcurrent: z.number().int().positive().optional()
  })
})

export type ScenarioYaml = z.infer<typeof ScenarioYamlSchema>
export type ScenarioTask = z.infer<typeof ScenarioTaskSchema>

export type ScenarioValidation = {
  valid: boolean
  errors: string[]
  scenario?: ScenarioYaml
}

/** Listing record returned to the renderer. */
export type ScenarioRecord = {
  name: string
  description: string
  mode: 'orchestrated' | 'autonomous'
  agentRefs: string[]
  taskCount: number
  filePath: string
  updatedAt: number
  raw: string
  valid: boolean
  validationErrors: string[]
}

/**
 * Encode an assignee into a task spec as a parseable header line, mirroring
 * Orca's `allow-stale-base: true` spec convention (see coordinator.ts
 * parseAllowStaleBaseFromSpec). The coordinator does not yet route by agent
 * (Phase 3b), so this is informational + used by the task board to render
 * the intended assignee. Format: `assignee: <name>\n<real spec>`.
 */
export const ASSIGNEE_SPEC_PREFIX = 'assignee:'

export function encodeAssigneeInSpec(assignee: string, spec: string): string {
  return `${ASSIGNEE_SPEC_PREFIX} ${assignee}\n${spec}`
}

export function decodeAssigneeFromSpec(spec: string): {
  assignee: string | null
  strippedSpec: string
} {
  const lines = spec.split('\n')
  if (lines.length > 0) {
    const first = lines[0].trim()
    if (first.startsWith(ASSIGNEE_SPEC_PREFIX)) {
      const assignee = first.slice(ASSIGNEE_SPEC_PREFIX.length).trim()
      if (assignee) {
        return { assignee, strippedSpec: lines.slice(1).join('\n') }
      }
    }
  }
  return { assignee: null, strippedSpec: spec }
}

// ─── minimal YAML round-trip for ScenarioYaml (reuses agent-yaml patterns) ──

export function serializeScenarioYaml(scenario: ScenarioYaml): string {
  const lines: string[] = []
  lines.push(`apiVersion: ${scenario.apiVersion}`)
  lines.push(`kind: ${scenario.kind}`)
  lines.push('metadata:')
  lines.push(`  name: ${scenario.metadata.name}`)
  if (scenario.metadata.description) {
    lines.push(`  description: ${yamlScalar(scenario.metadata.description)}`)
  }
  if (scenario.metadata.version) {
    lines.push(`  version: ${scenario.metadata.version}`)
  }
  lines.push('spec:')
  lines.push(`  mode: ${scenario.spec.mode}`)
  lines.push('  agents:')
  for (const a of scenario.spec.agents) {
    lines.push(`    - ref: ${a.ref}`)
  }
  if (scenario.spec.supervisor) {
    lines.push(`  supervisor: ${scenario.spec.supervisor}`)
  }
  if (scenario.spec.goal) {
    lines.push(`  goal: ${yamlBlockOrScalar(scenario.spec.goal)}`)
  }
  if (scenario.spec.maxConcurrent !== undefined) {
    lines.push(`  maxConcurrent: ${scenario.spec.maxConcurrent}`)
  }
  if (scenario.spec.tasks && scenario.spec.tasks.length > 0) {
    lines.push('  tasks:')
    for (const t of scenario.spec.tasks) {
      lines.push(`    - id: ${t.id}`)
      lines.push(`      assignee: ${t.assignee}`)
      lines.push(`      spec: ${yamlBlockOrScalar(t.spec)}`)
      if (t.deps && t.deps.length > 0) {
        lines.push('      deps:')
        for (const d of t.deps) {
          lines.push(`        - ${d}`)
        }
      }
      if (t.gate) {
        lines.push(`      gate: ${t.gate}`)
      }
    }
  }
  return `${lines.join('\n')}\n`
}

export function parseScenarioYaml(text: string): ScenarioValidation {
  let parsed: unknown
  try {
    parsed = parseYamlSubset(text)
  } catch (error) {
    return {
      valid: false,
      errors: [`YAML parse error: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
  const result = ScenarioYamlSchema.safeParse(parsed)
  if (result.success) {
    return { valid: true, errors: [], scenario: result.data }
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  }
}

function yamlScalar(value: string): string {
  if (/[:#@\n!'"{},&*?|>%@`]/.test(value) || /^\s|\s$/.test(value) || value === '') {
    return JSON.stringify(value)
  }
  return value
}

function yamlBlockOrScalar(value: string): string {
  if (value.includes('\n')) {
    const indented = value
      .split('\n')
      .map((l) => `        ${l}`)
      .join('\n')
    return `|\n${indented}`
  }
  return yamlScalar(value)
}

// Minimal YAML parser (same subset as agent-yaml.ts: maps, lists, block scalars).
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
    if (curIndent < indent || line.trimStart().startsWith('- ')) {
      break
    }
    if (curIndent > indent) {
      idx++
      continue
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
        const peekIdx = skipBlank(lines, idx)
        if (peekIdx < lines.length && lines[peekIdx].trimStart().startsWith('- ')) {
          const listChild = parseList(lines, peekIdx, lineIndent(lines[peekIdx]))
          result[key] = listChild.value
          idx = listChild.nextIdx
        } else {
          const child = parseBlock(lines, idx, indent + 1)
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
    if (curIndent < indent || curIndent > indent) {
      if (curIndent < indent) {
        break
      }
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
    } else if (itemValue.includes(':')) {
      // inline key: value as a single-item map (e.g. "- ref: claude")
      const childLine = `${' '.repeat(indent + 2)}${itemValue}`
      const child = parseMap([childLine, ...lines.slice(idx)], 0, indent + 2)
      result.push(child.value)
      idx = child.nextIdx >= 1 ? idx : idx
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
