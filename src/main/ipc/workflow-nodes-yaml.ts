import { ipcMain } from 'electron'
import type { WorkflowNodeYamlRecord } from '../../shared/workflow-node-yaml'
import {
  createWorkflowNodeYaml,
  listWorkflowNodeYamls,
  readWorkflowNodeYamlRaw,
  removeWorkflowNodeYaml,
  saveWorkflowNodeYaml
} from '../workflow-nodes-yaml/registry'

/**
 * Workflow-node YAML IPC handlers. Mirrors agents-yaml.
 *
 *   workflow-nodes-yaml:list     list all ~/.formapis/workflow-nodes/*.yaml
 *   workflow-nodes-yaml:read     read raw text of one node (for editor)
 *   workflow-nodes-yaml:create   create a new node from a partial spec
 *   workflow-nodes-yaml:save     save raw YAML text (validates; saves even if invalid)
 *   workflow-nodes-yaml:remove   delete a node file
 */
export function registerWorkflowNodeYamlHandlers(): void {
  ipcMain.handle('workflow-nodes-yaml:list', async (): Promise<WorkflowNodeYamlRecord[]> => {
    return listWorkflowNodeYamls()
  })

  ipcMain.handle(
    'workflow-nodes-yaml:read',
    async (_event, name: string): Promise<string | null> => {
      return readWorkflowNodeYamlRaw(name)
    }
  )

  ipcMain.handle(
    'workflow-nodes-yaml:create',
    async (
      _event,
      input: {
        name: string
        displayName?: string
        description?: string
        task: string
      }
    ): Promise<WorkflowNodeYamlRecord> => {
      return createWorkflowNodeYaml({
        name: input.name,
        displayName: input.displayName,
        description: input.description,
        task: input.task
      })
    }
  )

  ipcMain.handle(
    'workflow-nodes-yaml:save',
    async (
      _event,
      name: string,
      rawYaml: string
    ): Promise<{ record: WorkflowNodeYamlRecord; valid: boolean; errors: string[] }> => {
      const { record, validation } = saveWorkflowNodeYaml(name, rawYaml)
      return { record, valid: validation.valid, errors: validation.errors }
    }
  )

  ipcMain.handle('workflow-nodes-yaml:remove', async (_event, name: string): Promise<void> => {
    removeWorkflowNodeYaml(name)
  })
}
