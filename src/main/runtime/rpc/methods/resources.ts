import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { discoverResources } from '../../../resources/discovery'
import {
  createCanonicalMcpServer,
  createCanonicalSkill,
  listCanonicalResources,
  removeCanonicalResource
} from '../../../resources/canonical-store'
import {
  distributeResource,
  inspectDistribution,
  undistributeResource
} from '../../../resources/distributor'

/**
 * Runtime RPC methods for the unified resource layer (Web/mobile entry point).
 *
 * Mirrors skills.discover and adds the Phase 1b canonical/distribution surface
 * so browser clients can manage resources remotely. All disk mutations run on
 * the desktop host (where agent homes actually live).
 */
const ResourceKindSchema = z.enum(['mcp', 'skill', 'plugin'])

const CanonicalMcpInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  transport: z.enum(['stdio', 'http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string(), z.string()).optional()
})

export const RESOURCE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'resources.discover',
    params: z.object({ cwd: z.string().nullable().optional() }).default({ cwd: null }),
    handler: async (params) => {
      return discoverResources({ cwd: params.cwd ?? null })
    }
  }),
  defineMethod({
    name: 'resources.canonical.list',
    params: z.object({}).default({}),
    handler: async () => {
      return listCanonicalResources()
    }
  }),
  defineMethod({
    name: 'resources.canonical.createMcp',
    params: CanonicalMcpInputSchema,
    handler: async (params) => {
      const path = createCanonicalMcpServer(params)
      return { path }
    }
  }),
  defineMethod({
    name: 'resources.canonical.createSkill',
    params: z.object({ name: z.string().min(1), description: z.string() }),
    handler: async (params) => {
      const path = createCanonicalSkill(params.name, params.description)
      return { path }
    }
  }),
  defineMethod({
    name: 'resources.canonical.remove',
    params: z.object({ kind: ResourceKindSchema, name: z.string() }),
    handler: async (params) => {
      removeCanonicalResource(params.kind, params.name)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'resources.distribute',
    params: z.object({
      kind: ResourceKindSchema,
      name: z.string(),
      agents: z.array(z.string()).optional(),
      preferCopy: z.boolean().optional()
    }),
    handler: async (params) => {
      return distributeResource(params.kind, params.name, {
        agents: params.agents as never,
        preferCopy: params.preferCopy
      })
    }
  }),
  defineMethod({
    name: 'resources.distribution.inspect',
    params: z.object({ kind: ResourceKindSchema, name: z.string() }),
    handler: async (params) => {
      return inspectDistribution(params.kind, params.name)
    }
  }),
  defineMethod({
    name: 'resources.distribution.remove',
    params: z.object({ kind: ResourceKindSchema, name: z.string() }),
    handler: async (params) => {
      return undistributeResource(params.kind, params.name)
    }
  })
]
