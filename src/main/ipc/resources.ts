import { ipcMain } from 'electron'
import type {
  CanonicalMcpServerInput,
  CanonicalStoreListing,
  DistributeResult,
  DistributionStatus,
  ResourceDiscoveryResult,
  ResourceKind
} from '../../shared/resources'
import { discoverResources } from '../resources/discovery'
import {
  createCanonicalMcpServer,
  createCanonicalSkill,
  listCanonicalResources,
  removeCanonicalResource
} from '../resources/canonical-store'
import {
  distributeResource,
  inspectDistribution,
  undistributeResource
} from '../resources/distributor'

/**
 * Unified resource layer IPC handlers.
 *
 * Phase 1a: read-only discovery (resources:discover).
 * Phase 1b: canonical store management + distribution.
 *   - resources:canonical:list          list ~/.formapis/resources/*
 *   - resources:canonical:createMcp     create a canonical MCP server definition
 *   - resources:canonical:createSkill   create a canonical skill directory
 *   - resources:canonical:remove        remove a canonical resource
 *   - resources:distribute              distribute a canonical resource to agents
 *   - resources:distribution:inspect    read-only distribution status per agent
 *   - resources:distribution:remove     undistribute (remove our owned links/copies)
 */
export function registerResourcesHandlers(): void {
  ipcMain.handle(
    'resources:discover',
    async (_event, cwd?: string | null): Promise<ResourceDiscoveryResult> => {
      return discoverResources({ cwd: cwd ?? null })
    }
  )

  ipcMain.handle('resources:canonical:list', async (): Promise<CanonicalStoreListing> => {
    return listCanonicalResources()
  })

  ipcMain.handle(
    'resources:canonical:createMcp',
    async (_event, input: CanonicalMcpServerInput): Promise<{ path: string }> => {
      const path = createCanonicalMcpServer(input)
      return { path }
    }
  )

  ipcMain.handle(
    'resources:canonical:createSkill',
    async (_event, name: string, description: string): Promise<{ path: string }> => {
      const path = createCanonicalSkill(name, description)
      return { path }
    }
  )

  ipcMain.handle(
    'resources:canonical:remove',
    async (_event, kind: ResourceKind, name: string): Promise<void> => {
      removeCanonicalResource(kind, name)
    }
  )

  ipcMain.handle(
    'resources:distribute',
    async (
      _event,
      kind: ResourceKind,
      name: string,
      options?: { agents?: string[]; preferCopy?: boolean }
    ): Promise<DistributeResult> => {
      return distributeResource(kind, name, {
        agents: options?.agents as never,
        preferCopy: options?.preferCopy
      })
    }
  )

  ipcMain.handle(
    'resources:distribution:inspect',
    async (_event, kind: ResourceKind, name: string): Promise<DistributionStatus[]> => {
      return inspectDistribution(kind, name)
    }
  )

  ipcMain.handle(
    'resources:distribution:remove',
    async (_event, kind: ResourceKind, name: string): Promise<DistributionStatus[]> => {
      return undistributeResource(kind, name)
    }
  )
}
