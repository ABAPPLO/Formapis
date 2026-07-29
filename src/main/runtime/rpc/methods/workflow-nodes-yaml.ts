import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import {
  createWorkflowNodeYaml,
  listWorkflowNodeYamls,
  readWorkflowNodeYamlRaw,
  removeWorkflowNodeYaml,
  saveWorkflowNodeYaml
} from '../../../workflow-nodes-yaml/registry'

/**
 * Runtime RPC methods for workflow-node YAMLs (Web/mobile entry point).
 * Mirrors the IPC handlers; all disk work runs on the desktop host.
 */
export const WORKFLOW_NODE_YAML_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'workflow-nodes-yaml.list',
    params: z.object({}).default({}),
    handler: async () => listWorkflowNodeYamls()
  }),
  defineMethod({
    name: 'workflow-nodes-yaml.read',
    params: z.object({ name: z.string().min(1) }),
    handler: async (params) => readWorkflowNodeYamlRaw(params.name)
  }),
  defineMethod({
    name: 'workflow-nodes-yaml.create',
    params: z.object({
      name: z.string().min(1),
      displayName: z.string().optional(),
      description: z.string().optional(),
      role: z.string()
    }),
    handler: async (params) =>
      createWorkflowNodeYaml({
        name: params.name,
        displayName: params.displayName,
        description: params.description,
        role: params.role
      })
  }),
  defineMethod({
    name: 'workflow-nodes-yaml.save',
    params: z.object({ name: z.string().min(1), rawYaml: z.string() }),
    handler: async (params) => {
      const { record, validation } = saveWorkflowNodeYaml(params.name, params.rawYaml)
      return { record, valid: validation.valid, errors: validation.errors }
    }
  }),
  defineMethod({
    name: 'workflow-nodes-yaml.remove',
    params: z.object({ name: z.string().min(1) }),
    handler: async (params) => {
      removeWorkflowNodeYaml(params.name)
      return { ok: true }
    }
  })
]
