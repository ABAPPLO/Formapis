import { ipcMain } from 'electron'
import type { ScenarioRecord } from '../../shared/scenario-yaml'
import {
  createScenarioYaml,
  listScenarioYamls,
  readScenarioYamlRaw,
  removeScenarioYaml,
  saveScenarioYaml
} from '../scenarios/registry'
import { launchScenario, type ScenarioOrchestrationDb } from '../scenarios/launcher'

/**
 * Scenario IPC handlers.
 *
 *   scenarios:list           list all ~/.formapis/scenarios/*.yaml
 *   scenarios:read           read raw text of one scenario (for editor)
 *   scenarios:create         create a new scenario from a partial spec
 *   scenarios:save           save raw YAML text
 *   scenarios:remove         delete a scenario file
 *   scenarios:launch         prepare tasks in the orchestration DB (reset + createTask).
 *                            The caller then invokes orchestration.run separately to
 *                            start the coordinator loop.
 *
 * The orchestration DB is obtained lazily via the injected resolver so this
 * module does not depend on the full runtime at registration time.
 */
export function registerScenariosHandlers(
  orchestrationDbResolver: () => ScenarioOrchestrationDb | null
): void {
  ipcMain.handle('scenarios:list', async (): Promise<ScenarioRecord[]> => {
    return listScenarioYamls()
  })

  ipcMain.handle('scenarios:read', async (_event, name: string): Promise<string | null> => {
    return readScenarioYamlRaw(name)
  })

  ipcMain.handle(
    'scenarios:create',
    async (
      _event,
      input: {
        name: string
        description?: string
        mode?: 'orchestrated' | 'autonomous'
        agentRefs: string[]
        supervisor?: string
        goal?: string
      }
    ): Promise<ScenarioRecord> => {
      return createScenarioYaml(input)
    }
  )

  ipcMain.handle(
    'scenarios:save',
    async (
      _event,
      name: string,
      rawYaml: string
    ): Promise<{ record: ScenarioRecord; valid: boolean; errors: string[] }> => {
      const { record, valid, errors } = saveScenarioYaml(name, rawYaml)
      return { record, valid, errors }
    }
  )

  ipcMain.handle('scenarios:remove', async (_event, name: string): Promise<void> => {
    removeScenarioYaml(name)
  })

  ipcMain.handle('scenarios:launch', async (_event, name: string) => {
    const db = orchestrationDbResolver()
    if (!db) {
      return { ok: false as const, error: 'Orchestration runtime not available' }
    }
    return launchScenario({ name, db })
  })
}
