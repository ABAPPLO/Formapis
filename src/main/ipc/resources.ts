import { ipcMain } from 'electron'
import type { ResourceDiscoveryResult } from '../../shared/resources'
import { discoverResources } from '../resources/discovery'

/**
 * Unified resource layer IPC handlers.
 *
 * Mirrors the shape of registerSkillsHandlers (src/main/ipc/skills.ts): a
 * single `discover` channel returning a ResourceDiscoveryResult. Phase 1a is
 * read-only; Phase 1b will add install/sync/remove channels here.
 */
export function registerResourcesHandlers(): void {
  ipcMain.handle(
    'resources:discover',
    async (_event, cwd?: string | null): Promise<ResourceDiscoveryResult> => {
      return discoverResources({ cwd: cwd ?? null })
    }
  )
}
