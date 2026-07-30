import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import {
  createScenarioYaml,
  listScenarioYamls,
  readScenarioYamlRaw,
  removeScenarioYaml,
  saveScenarioYaml
} from '../../../scenarios/registry'
import { launchScenario } from '../../../scenarios/launcher'

/**
 * Runtime RPC methods for scenarios (Web/mobile entry point).
 * launch resolves the orchestration DB from the runtime context.
 */
export const SCENARIOS_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'scenarios.list',
    params: z.object({}).default({}),
    handler: async () => listScenarioYamls()
  }),
  defineMethod({
    name: 'scenarios.read',
    params: z.object({ name: z.string().min(1) }),
    handler: async (params) => readScenarioYamlRaw(params.name)
  }),
  defineMethod({
    name: 'scenarios.create',
    params: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      mode: z.enum(['orchestrated', 'autonomous']).optional(),
      agentRefs: z.array(z.string().min(1)).min(1),
      supervisor: z.string().optional(),
      goal: z.string().optional()
    }),
    handler: async (params) =>
      createScenarioYaml({
        name: params.name,
        description: params.description,
        mode: params.mode,
        agentRefs: params.agentRefs,
        supervisor: params.supervisor,
        goal: params.goal
      })
  }),
  defineMethod({
    name: 'scenarios.save',
    params: z.object({ name: z.string().min(1), rawYaml: z.string() }),
    handler: async (params) => {
      const { record, valid, errors } = saveScenarioYaml(params.name, params.rawYaml)
      return { record, valid, errors }
    }
  }),
  defineMethod({
    name: 'scenarios.remove',
    params: z.object({ name: z.string().min(1) }),
    handler: async (params) => {
      removeScenarioYaml(params.name)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'scenarios.launch',
    params: z.object({ name: z.string().min(1) }),
    handler: async (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      // Why: returned verbatim — the error variant carries unknownAssignees so the UI can map refusals back to nodes.
      return launchScenario({ name: params.name, db })
    }
  })
]
