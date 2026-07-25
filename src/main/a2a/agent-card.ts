import { listAgentYamls } from '../agents-yaml/registry'
import { listScenarioYamls } from '../scenarios/registry'
import type { A2AAgentCard, A2AAgentSkill } from '../../shared/a2a-types'

/**
 * Build the A2A AgentCard from Formapis' YAML agents and scenarios.
 *
 * Each YAML agent becomes an A2A skill (named after the agent). Each scenario
 * becomes an additional skill tagged 'scenario'. The card is served at
 * /.well-known/agent.json so A2A clients can discover Formapis' capabilities.
 */
export function buildAgentCard(baseUrl: string): A2AAgentCard {
  const skills: A2AAgentSkill[] = []

  for (const agent of listAgentYamls()) {
    if (!agent.valid) {
      continue
    }
    skills.push({
      id: agent.name,
      name: agent.displayName,
      description: agent.description || `Formapis agent running on ${agent.provider}`,
      tags: [agent.provider, ...(agent.runtimeType ? [agent.runtimeType] : [])]
    })
  }

  for (const scenario of listScenarioYamls()) {
    if (!scenario.valid) {
      continue
    }
    skills.push({
      id: `scenario:${scenario.name}`,
      name: scenario.name,
      description:
        scenario.description || `Formapis scenario (${scenario.mode}, ${scenario.taskCount} tasks)`,
      tags: ['scenario', scenario.mode]
    })
  }

  return {
    name: 'Formapis',
    description: 'A fleet of YAML-defined agents and orchestration scenarios, callable via A2A.',
    url: `${baseUrl}/a2a`,
    version: '0.1.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransition: true
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills
  }
}
