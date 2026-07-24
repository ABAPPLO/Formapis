import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { discoverResources } from '../../../resources/discovery'

/**
 * Runtime RPC methods for the unified resource layer (Web/mobile entry point).
 *
 * Mirrors skills.discover. Web clients pass an optional worktreeId-derived cwd;
 * for the MVP we scan agent homes only (cwd null) because the cross-agent
 * shared view is the primary value, and workspace .mcp.json is already shown
 * by the existing MCP settings panel.
 */
export const RESOURCE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'resources.discover',
    params: z
      .object({
        cwd: z.string().nullable().optional()
      })
      .default({ cwd: null }),
    handler: async (params) => {
      return discoverResources({ cwd: params.cwd ?? null })
    }
  })
]
