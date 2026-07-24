import {
  AGENT_YAML_API_VERSION,
  AGENT_YAML_KIND,
  serializeAgentYaml,
  type AgentYaml,
  type AgentRuntimeProvider
} from '../../shared/agent-yaml'

/**
 * Conversational agent builder.
 *
 * Phase 4a uses a deterministic, guide-driven flow: the user answers a fixed
 * set of questions (role, tools, constraints), and the engine assembles a valid
 * AgentYaml from those answers. No external LLM call is needed, so this works
 * offline and with zero new dependencies.
 *
 * Phase 4b will optionally route the user's free-form description through an
 * LLM (reusing the speech/openai-* client pattern) to auto-fill the answers;
 * the ConversationAnswers shape stays the contract between both phases.
 */

/** Answers collected from the conversation wizard. */
export type ConversationAnswers = {
  name: string
  displayName: string
  description: string
  provider: AgentRuntimeProvider
  runtimeType: 'ade' | 'harness'
  role: string
  toolsMcp: string[]
  toolsSkills: string[]
  behavior: {
    askBeforeDestructive: boolean
    maxTurns: number
  }
}

/**
 * Wizard step definition. The renderer walks these in order, collecting answers
 * into ConversationAnswers. `key` maps to a field on ConversationAnswers.
 */
export type ConversationStep = {
  id: string
  key: keyof ConversationAnswers | 'behavior'
  prompt: string
  hint?: string
  inputType: 'text' | 'textarea' | 'provider-select' | 'runtime-type' | 'tools' | 'behavior'
  required: boolean
}

/** The ordered steps the wizard presents. */
export const CONVERSATION_STEPS: ConversationStep[] = [
  {
    id: 'name',
    key: 'name',
    prompt: 'What should we call this agent?',
    hint: 'A short kebab-case identifier, e.g. "code-reviewer".',
    inputType: 'text',
    required: true
  },
  {
    id: 'displayName',
    key: 'displayName',
    prompt: 'What display name do you want?',
    hint: 'Shown in the agent list, e.g. "代码审查官".',
    inputType: 'text',
    required: true
  },
  {
    id: 'description',
    key: 'description',
    prompt: 'In one sentence, what does this agent do?',
    inputType: 'text',
    required: false
  },
  {
    id: 'provider',
    key: 'provider',
    prompt: 'Which runtime should drive this agent?',
    hint: 'ADE CLIs (claude/codex/...) or harnesses (hermes/openclaw).',
    inputType: 'provider-select',
    required: true
  },
  {
    id: 'runtimeType',
    key: 'runtimeType',
    prompt: 'Is this an ADE or a harness?',
    hint: 'ADE = coding-agent CLI; harness = orchestration framework.',
    inputType: 'runtime-type',
    required: true
  },
  {
    id: 'role',
    key: 'role',
    prompt: "Describe this agent's role and expertise.",
    hint: 'Be specific about what it should focus on and avoid.',
    inputType: 'textarea',
    required: true
  },
  {
    id: 'tools',
    key: 'toolsMcp',
    prompt: 'Which tools should it have access to?',
    hint: 'Comma-separated MCP servers / skills (from your canonical resources).',
    inputType: 'tools',
    required: false
  },
  {
    id: 'behavior',
    key: 'behavior',
    prompt: 'Any behavioral constraints?',
    inputType: 'behavior',
    required: false
  }
]

export type GenerateResult =
  | { ok: true; rawYaml: string; agent: AgentYaml }
  | { ok: false; errors: string[] }

/**
 * Assemble a ConversationAnswers payload into a valid AgentYaml + serialized
 * YAML text. Validates the name shape; returns structured errors otherwise.
 */
export function generateAgentFromAnswers(answers: ConversationAnswers): GenerateResult {
  const errors: string[] = []
  if (!answers.name || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(answers.name)) {
    errors.push('name must be lowercase kebab-case')
  }
  if (!answers.displayName.trim()) {
    errors.push('display name is required')
  }
  if (!answers.role.trim()) {
    errors.push('role is required')
  }
  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const toolsMcp = answers.toolsMcp.filter((t) => t.trim())
  const toolsSkills = answers.toolsSkills.filter((t) => t.trim())

  const agent: AgentYaml = {
    apiVersion: AGENT_YAML_API_VERSION,
    kind: AGENT_YAML_KIND,
    metadata: {
      name: answers.name,
      display_name: answers.displayName,
      description: answers.description || undefined,
      version: '1.0.0',
      author: 'formapis-conversation'
    },
    spec: {
      runtime: {
        type: answers.runtimeType,
        provider: answers.provider
      },
      role: answers.role.trim(),
      tools: {
        ...(toolsMcp.length > 0 ? { mcp: toolsMcp } : {}),
        ...(toolsSkills.length > 0 ? { skills: toolsSkills } : {})
      },
      system_prompt: '{{role}}\n\nAvailable tools: {{tools}}',
      behavior: {
        ask_before_destructive: answers.behavior.askBeforeDestructive,
        max_turns: answers.behavior.maxTurns
      }
    }
  }

  return { ok: true, rawYaml: serializeAgentYaml(agent), agent }
}

/** Default empty answers for a fresh wizard session. */
export function defaultAnswers(): ConversationAnswers {
  return {
    name: '',
    displayName: '',
    description: '',
    provider: 'claude',
    runtimeType: 'ade',
    role: '',
    toolsMcp: [],
    toolsSkills: [],
    behavior: {
      askBeforeDestructive: true,
      maxTurns: 50
    }
  }
}
