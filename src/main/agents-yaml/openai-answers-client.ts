import { hasOpenAiSpeechApiKey, readOpenAiSpeechApiKey } from '../speech/openai-api-key-store'
import { sanitizeOpenAiTranscriptionErrorMessage } from '../speech/openai-transcription-client'
import type { ConversationAnswers } from './conversation'
import type { AgentRuntimeProvider } from '../../shared/agent-yaml'

/**
 * LLM-powered agent builder (Phase 4b).
 *
 * Takes a free-form natural-language description and asks OpenAI to produce a
 * ConversationAnswers draft, which is then fed to Phase 4a's
 * generateAgentFromAnswers for validation + YAML serialization.
 *
 * Reuses the speech module's OpenAI key store (~/.orca/openai-speech-token.enc)
 * and error-sanitization — there is one OpenAI key per user, shared between
 * transcription and this feature. No SDK dependency; uses the global fetch
 * (Node 24), matching openai-transcription-client.ts.
 */

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_CHAT_MODEL = 'gpt-4o-mini'
const REQUEST_TIMEOUT_MS = 30_000

/** Known providers the LLM may pick (mirrors AgentRuntimeProviderSchema). */
const KNOWN_PROVIDERS: readonly AgentRuntimeProvider[] = [
  'claude',
  'openclaude',
  'codex',
  'opencode',
  'gemini',
  'cursor',
  'copilot',
  'grok',
  'hermes',
  'openclaw',
  'aider',
  'pi'
]

const SYSTEM_PROMPT = `You design AI coding agents for Formapis, a multi-agent development environment.
Given a user's description, produce a JSON object with EXACTLY these fields:

{
  "name": "<lowercase-kebab-case identifier, e.g. code-reviewer>",
  "displayName": "<human-friendly name>",
  "description": "<one sentence>",
  "provider": "<one of: ${KNOWN_PROVIDERS.join(', ')}>",
  "runtimeType": "<'ade' for coding-agent CLIs, 'harness' for orchestrators like hermes/openclaw>",
  "role": "<detailed role description: focus areas, expertise, what to avoid>",
  "toolsMcp": ["<mcp server names if relevant, e.g. filesystem, github>"],
  "toolsSkills": ["<skill names if relevant>"],
  "behavior": { "askBeforeDestructive": <true|false>, "maxTurns": <number 10-200> }
}

Rules:
- name MUST match /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/ (lowercase kebab-case).
- Pick the most fitting provider from the list. If the user names a specific CLI, use it.
- runtimeType is 'ade' for claude/codex/gemini/cursor/etc, 'harness' for hermes/openclaw.
- role should be specific and actionable (2-4 sentences).
- Only include tools the user mentions or that clearly fit; empty arrays are fine.
- Respond with ONLY the JSON object, no markdown fences, no commentary.`

export type GenerateAnswersResult =
  | { ok: true; answers: ConversationAnswers }
  | { ok: false; error: string }

/**
 * Generate a ConversationAnswers draft from a natural-language description.
 * Requires an OpenAI API key (shared with the speech feature). The result is
 * NOT trusted blindly — the caller must still pass it through
 * generateAgentFromAnswers for schema validation.
 */
export async function generateAnswersFromDescription(
  description: string
): Promise<GenerateAnswersResult> {
  if (!description.trim()) {
    return { ok: false, error: 'Description is empty' }
  }
  if (!hasOpenAiSpeechApiKey()) {
    return {
      ok: false,
      error:
        'OpenAI API key is not configured. Add one in Settings → Speech (it is shared with dictation).'
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readOpenAiSpeechApiKey()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_CHAT_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: description }
        ]
      }),
      signal: controller.signal
    })

    const data = (await response.json().catch(() => ({}))) as {
      error?: { message?: unknown }
      choices?: { message?: { content?: unknown } }[]
    }
    if (!response.ok) {
      const raw =
        data.error && typeof data.error.message === 'string'
          ? data.error.message
          : response.statusText
      return { ok: false, error: sanitizeOpenAiTranscriptionErrorMessage(raw) }
    }

    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      return { ok: false, error: 'OpenAI returned no content' }
    }

    const parsed = safeParseAnswers(content)
    if (!parsed) {
      return { ok: false, error: 'OpenAI response was not valid agent JSON' }
    }
    return { ok: true, answers: parsed }
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, error: 'OpenAI request timed out' }
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    clearTimeout(timeout)
  }
}

function safeParseAnswers(content: string): ConversationAnswers | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const obj = parsed as Record<string, unknown>
  const provider = typeof obj.provider === 'string' ? obj.provider : 'claude'
  return {
    name: typeof obj.name === 'string' ? obj.name : '',
    displayName: typeof obj.displayName === 'string' ? obj.displayName : '',
    description: typeof obj.description === 'string' ? obj.description : '',
    provider: (KNOWN_PROVIDERS as readonly string[]).includes(provider)
      ? (provider as AgentRuntimeProvider)
      : 'claude',
    runtimeType: obj.runtimeType === 'harness' ? 'harness' : 'ade',
    role: typeof obj.role === 'string' ? obj.role : '',
    toolsMcp: Array.isArray(obj.toolsMcp)
      ? (obj.toolsMcp as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    toolsSkills: Array.isArray(obj.toolsSkills)
      ? (obj.toolsSkills as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    behavior: {
      askBeforeDestructive:
        typeof obj.behavior === 'object' &&
        obj.behavior !== null &&
        typeof (obj.behavior as Record<string, unknown>).askBeforeDestructive === 'boolean'
          ? (obj.behavior as Record<string, unknown>).askBeforeDestructive === true
          : true,
      maxTurns:
        typeof obj.behavior === 'object' &&
        obj.behavior !== null &&
        typeof (obj.behavior as Record<string, unknown>).maxTurns === 'number'
          ? ((obj.behavior as Record<string, unknown>).maxTurns as number)
          : 50
    }
  }
}
