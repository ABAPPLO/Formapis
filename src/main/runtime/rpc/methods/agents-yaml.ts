import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import {
  createAgentYaml,
  listAgentYamls,
  readAgentYamlRaw,
  removeAgentYaml,
  saveAgentYaml
} from '../../../agents-yaml/registry'
import { resolveAgentLaunch } from '../../../agents-yaml/runner'

/**
 * Runtime RPC methods for YAML agents (Web/mobile entry point).
 * Mirrors the IPC handlers; all disk work runs on the desktop host.
 */
const AgentProviderSchema = z.enum([
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

export const AGENTS_YAML_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'agents-yaml.list',
    params: z.object({}).default({}),
    handler: async () => listAgentYamls()
  }),
  defineMethod({
    name: 'agents-yaml.read',
    params: z.object({ name: z.string().min(1) }),
    handler: async (params) => readAgentYamlRaw(params.name)
  }),
  defineMethod({
    name: 'agents-yaml.create',
    params: z.object({
      name: z.string().min(1),
      displayName: z.string().optional(),
      description: z.string().optional(),
      provider: AgentProviderSchema,
      role: z.string()
    }),
    handler: async (params) =>
      createAgentYaml({
        name: params.name,
        displayName: params.displayName,
        description: params.description,
        provider: params.provider,
        role: params.role
      })
  }),
  defineMethod({
    name: 'agents-yaml.save',
    params: z.object({ name: z.string().min(1), rawYaml: z.string() }),
    handler: async (params) => {
      const { record, validation } = saveAgentYaml(params.name, params.rawYaml)
      return { record, valid: validation.valid, errors: validation.errors }
    }
  }),
  defineMethod({
    name: 'agents-yaml.remove',
    params: z.object({ name: z.string().min(1) }),
    handler: async (params) => {
      removeAgentYaml(params.name)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'agents-yaml.resolveLaunch',
    params: z.object({ name: z.string().min(1) }),
    handler: async (params) => resolveAgentLaunch(params.name)
  })
]
