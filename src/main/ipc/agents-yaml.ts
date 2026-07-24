import { ipcMain } from 'electron'
import type { AgentYamlRecord } from '../../shared/agent-yaml'
import {
  createAgentYaml,
  listAgentYamls,
  readAgentYamlRaw,
  removeAgentYaml,
  saveAgentYaml
} from '../agents-yaml/registry'
import { resolveAgentLaunch, type AgentLaunchPayload } from '../agents-yaml/runner'
import { generateAgentFromAnswers, type ConversationAnswers } from '../agents-yaml/conversation'

/**
 * YAML agent IPC handlers.
 *
 *   agents-yaml:list                 list all ~/.formapis/agents/*.yaml
 *   agents-yaml:read                 read raw text of one agent (for editor)
 *   agents-yaml:create               create a new agent from a partial spec
 *   agents-yaml:save                 save raw YAML text (validates; saves even if invalid)
 *   agents-yaml:remove               delete an agent file
 *   agents-yaml:resolveLaunch        resolve a try-run launch payload (rendered prompt)
 */
export function registerAgentsYamlHandlers(): void {
  ipcMain.handle('agents-yaml:list', async (): Promise<AgentYamlRecord[]> => {
    return listAgentYamls()
  })

  ipcMain.handle('agents-yaml:read', async (_event, name: string): Promise<string | null> => {
    return readAgentYamlRaw(name)
  })

  ipcMain.handle(
    'agents-yaml:create',
    async (
      _event,
      input: {
        name: string
        displayName?: string
        description?: string
        provider: string
        role: string
      }
    ): Promise<AgentYamlRecord> => {
      return createAgentYaml({
        name: input.name,
        displayName: input.displayName,
        description: input.description,
        provider: input.provider as never,
        role: input.role
      })
    }
  )

  ipcMain.handle(
    'agents-yaml:save',
    async (
      _event,
      name: string,
      rawYaml: string
    ): Promise<{ record: AgentYamlRecord; valid: boolean; errors: string[] }> => {
      const { record, validation } = saveAgentYaml(name, rawYaml)
      return { record, valid: validation.valid, errors: validation.errors }
    }
  )

  ipcMain.handle('agents-yaml:remove', async (_event, name: string): Promise<void> => {
    removeAgentYaml(name)
  })

  ipcMain.handle(
    'agents-yaml:resolveLaunch',
    async (_event, name: string): Promise<{ payload: AgentLaunchPayload } | { error: string }> => {
      return resolveAgentLaunch(name)
    }
  )

  ipcMain.handle(
    'agents-yaml:generateFromConversation',
    async (
      _event,
      answers: ConversationAnswers
    ): Promise<{ ok: true; rawYaml: string } | { ok: false; errors: string[] }> => {
      const result = generateAgentFromAnswers(answers)
      if (result.ok) {
        return { ok: true, rawYaml: result.rawYaml }
      }
      return { ok: false, errors: result.errors }
    }
  )
}
