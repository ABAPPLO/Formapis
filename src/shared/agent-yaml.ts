/* eslint-disable max-lines */
/* oxlint-disable max-lines -- Why: agent-yaml.ts bundles the zod schema, types, and a self-contained minimal YAML reader/writer for the agent schema subset; splitting the parser out would orphan it from the schema it round-trips. */
import { z } from 'zod'

/**
 * YAML Agent definition schema for Formapis (apiVersion: formapis/v1).
 *
 * An Agent YAML declares a reusable agent persona + runtime binding, independent
 * of any cluster/scenario (those live in separate Scenario YAMLs in Phase 3).
 *
 *   apiVersion: formapis/v1
 *   kind: Agent
 *   metadata:
 *     name: code-reviewer
 *     display_name: 代码审查官
 *     description: 专注代码审查
 *     version: 1.0.0
 *   spec:
 *     runtime:
 *       provider: claude          # any TuiAgent (claude/codex/hermes/openclaw/...)
 *     role: |
 *       你是一个严格的代码审查官。
 *     tools:
 *       mcp: [filesystem, github]
 *       skills: [orchestration]
 *     system_prompt: |
 *       {{role}}
 *       可用工具: {{tools}}
 *     behavior:
 *       max_turns: 50
 *
 * Phase 2a covers define/load/list/validate/try-run. Phase 4 will add
 * conversational generation; Phase 3 will reference agents from Scenario YAMLs.
 */

export const AGENT_YAML_API_VERSION = 'formapis/v1'
export const AGENT_YAML_KIND = 'Agent'

/**
 * Runtime provider — must be a known TuiAgent so we can launch it via the
 * existing terminal pipeline (createTerminal + TUI_AGENT_CONFIG).
 * 'ade' = a coding-agent CLI (claude/codex/...); 'harness' = OpenClaw/Hermes.
 * The `type` field is descriptive only; launch is identical (terminal paste).
 */
export const AgentRuntimeProviderSchema = z.enum([
  'claude',
  'openclaude',
  'codex',
  'opencode',
  'gemini',
  'antigravity',
  'cursor',
  'copilot',
  'grok',
  'aider',
  'amp',
  'goose',
  'kilo',
  'kiro',
  'crush',
  'aug',
  'cline',
  'codebuff',
  'command-code',
  'continue',
  'droid',
  'kimi',
  'pi',
  'omp',
  'qwen-code',
  'rovo',
  'hermes',
  'openclaw',
  'devin',
  'ante'
])

export type AgentRuntimeProvider = z.infer<typeof AgentRuntimeProviderSchema>

export const AgentYamlSchema = z.object({
  apiVersion: z.literal(AGENT_YAML_API_VERSION),
  kind: z.literal(AGENT_YAML_KIND),
  metadata: z.object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 'name must be lowercase kebab-case'),
    display_name: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    author: z.string().optional()
  }),
  spec: z.object({
    runtime: z.object({
      type: z.enum(['ade', 'harness']).optional(),
      provider: AgentRuntimeProviderSchema,
      worktree: z
        .object({
          mode: z.enum(['shared', 'dedicated', 'ephemeral']).optional(),
          base: z.string().optional()
        })
        .optional()
    }),
    role: z.string(),
    tools: z
      .object({
        mcp: z.array(z.string()).optional(),
        skills: z.array(z.string()).optional(),
        plugins: z.array(z.string()).optional()
      })
      .optional(),
    system_prompt: z.string().optional(),
    behavior: z
      .object({
        auto_commit: z.boolean().optional(),
        ask_before_destructive: z.boolean().optional(),
        max_turns: z.number().int().positive().optional()
      })
      .optional()
  })
})

export type AgentYaml = z.infer<typeof AgentYamlSchema>

/**
 * Launch payload resolved from an AgentYaml — what the renderer needs to start
 * a try-run terminal. Defined in shared so both main and renderer reference the
 * same type without importing main-only modules.
 */
export type AgentLaunchPayload = {
  provider: AgentYaml['spec']['runtime']['provider']
  runtimeType: 'ade' | 'harness' | undefined
  /** Rendered system prompt ready to paste into the agent. */
  systemPrompt: string
  /** Suggested initial message to send after the agent starts. */
  initialMessage: string
  /** Agent display name for the terminal tab. */
  displayName: string
  /** Referenced MCP/Skill/Plugin tool names (for telemetry + future injection). */
  tools: { mcp: string[]; skills: string[]; plugins: string[] }
}

export type AgentYamlValidation = {
  valid: boolean
  errors: string[]
  /** The parsed agent if valid. */
  agent?: AgentYaml
}

/**
 * The listing record returned to the renderer — the raw text plus parsed
 * metadata so cards render without re-parsing on the client.
 */
export type AgentYamlRecord = {
  name: string
  displayName: string
  description: string
  version: string
  provider: AgentRuntimeProvider
  runtimeType: 'ade' | 'harness' | undefined
  role: string
  toolsMcp: string[]
  toolsSkills: string[]
  toolsPlugins: string[]
  /** Absolute path of the .yaml file on disk. */
  filePath: string
  updatedAt: number
  /** Raw YAML text (for the editor view). */
  raw: string
  valid: boolean
  validationErrors: string[]
}

// ─── minimal YAML reader/writer for the agent schema subset ─────────────────
//
// Why custom: the project has no YAML dependency, and agent YAML uses only a
// small subset (nested maps, string lists, multi-line block scalars, simple
// scalars). A full library would be overkill for Phase 2 and would add bundle
// weight. This implementation round-trips the AgentYaml schema only.

/** Serialize an AgentYaml object to YAML text (formapis/v1 layout). */
export function serializeAgentYaml(agent: AgentYaml): string {
  const lines: string[] = []
  lines.push(`apiVersion: ${agent.apiVersion}`)
  lines.push(`kind: ${agent.kind}`)
  lines.push('metadata:')
  lines.push(`  name: ${agent.metadata.name}`)
  if (agent.metadata.display_name) {
    lines.push(`  display_name: ${yamlScalar(agent.metadata.display_name)}`)
  }
  if (agent.metadata.description) {
    lines.push(`  description: ${yamlScalar(agent.metadata.description)}`)
  }
  if (agent.metadata.version) {
    lines.push(`  version: ${agent.metadata.version}`)
  }
  if (agent.metadata.author) {
    lines.push(`  author: ${yamlScalar(agent.metadata.author)}`)
  }
  lines.push('spec:')
  lines.push('  runtime:')
  if (agent.spec.runtime.type) {
    lines.push(`    type: ${agent.spec.runtime.type}`)
  }
  lines.push(`    provider: ${agent.spec.runtime.provider}`)
  if (agent.spec.runtime.worktree) {
    lines.push('    worktree:')
    if (agent.spec.runtime.worktree.mode) {
      lines.push(`      mode: ${agent.spec.runtime.worktree.mode}`)
    }
    if (agent.spec.runtime.worktree.base) {
      lines.push(`      base: ${agent.spec.runtime.worktree.base}`)
    }
  }
  lines.push(`  role: ${yamlBlockOrScalar(agent.spec.role)}`)
  if (agent.spec.tools) {
    lines.push('  tools:')
    if (agent.spec.tools.mcp && agent.spec.tools.mcp.length > 0) {
      lines.push('    mcp:')
      for (const m of agent.spec.tools.mcp) {
        lines.push(`      - ${m}`)
      }
    }
    if (agent.spec.tools.skills && agent.spec.tools.skills.length > 0) {
      lines.push('    skills:')
      for (const s of agent.spec.tools.skills) {
        lines.push(`      - ${s}`)
      }
    }
    if (agent.spec.tools.plugins && agent.spec.tools.plugins.length > 0) {
      lines.push('    plugins:')
      for (const p of agent.spec.tools.plugins) {
        lines.push(`      - ${p}`)
      }
    }
  }
  if (agent.spec.system_prompt) {
    lines.push(`  system_prompt: ${yamlBlockOrScalar(agent.spec.system_prompt)}`)
  }
  if (agent.spec.behavior) {
    lines.push('  behavior:')
    if (agent.spec.behavior.auto_commit !== undefined) {
      lines.push(`    auto_commit: ${agent.spec.behavior.auto_commit}`)
    }
    if (agent.spec.behavior.ask_before_destructive !== undefined) {
      lines.push(`    ask_before_destructive: ${agent.spec.behavior.ask_before_destructive}`)
    }
    if (agent.spec.behavior.max_turns !== undefined) {
      lines.push(`    max_turns: ${agent.spec.behavior.max_turns}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** Parse and validate YAML text into an AgentYaml. Throws on invalid YAML. */
export function parseAgentYaml(text: string): AgentYamlValidation {
  let parsed: unknown
  try {
    parsed = parseYamlSubset(text)
  } catch (error) {
    return {
      valid: false,
      errors: [`YAML parse error: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
  const result = AgentYamlSchema.safeParse(parsed)
  if (result.success) {
    return { valid: true, errors: [], agent: result.data }
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
  const root = parseBlock(lines, 0, 0).value
  return root
}

function parseBlock(
  lines: string[],
  startIdx: number,
  indent: number
): { value: YamlValue; nextIdx: number } {
  // Peek at the first non-empty, non-comment line to decide map vs list.
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
  const isList = firstLine.trimStart().startsWith('- ')
  if (isList) {
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
      // Unexpected over-indent without a parent key; skip defensively.
      idx++
      continue
    }
    if (line.trimStart().startsWith('- ')) {
      // A list at the same indent ends this map.
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
        // block scalar — gather indented continuation lines
        const block = gatherBlockScalar(lines, idx, indent, after === '|')
        result[key] = block.value
        idx = block.nextIdx
      } else {
        // nested map or list
        const child = parseBlock(lines, idx, indent + 1)
        if (isObject(child.value) && Object.keys(child.value).length === 0) {
          // Check whether the child was actually a list
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
      // nested structure under the dash
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
  // Trim trailing empties, then re-add a single trailing newline for literal blocks.
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
  // Why: strip surrounding quotes if present.
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
  // strip inline comments
  const commentIdx = trimmed.indexOf(' #')
  return commentIdx >= 0 ? trimmed.slice(0, commentIdx).trim() : trimmed
}

function lineIndent(line: string): number {
  return line.length - line.trimStart().length
}

function findColon(line: string): number {
  // Why: find the first `: ` or trailing `:` that separates key from value.
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
