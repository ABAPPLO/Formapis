import { homedir } from 'node:os'
import { parseAgentYaml, type AgentLaunchPayload, type AgentYaml } from '../../shared/agent-yaml'
import { readAgentYamlRaw } from './registry'

/**
 * Try-run support for YAML agents.
 *
 * A try-run renders the agent's system_prompt (substituting template variables
 * like {{role}} and {{tools}}), then hands a launch payload to the renderer,
 * which starts a terminal for the declared provider via the existing
 * terminals store + pty pipeline.
 *
 * Phase 2 keeps this in main so prompt rendering and tool resolution stay
 * server-side (renderer just receives a ready-to-launch spec). Actual terminal
 * creation reuses the renderer's createTerminalTab flow so the agent shows up
 * in the normal workspace UI rather than a detached window.
 */

export type { AgentLaunchPayload } from '../../shared/agent-yaml'

/**
 * Resolve an agent YAML into a launch payload: parse, render the system_prompt
 * template, summarize tools. Returns null if the YAML is missing or invalid.
 */
export function resolveAgentLaunch(
  name: string,
  homeDir: string = homedir()
): { payload: AgentLaunchPayload } | { error: string } {
  const raw = readAgentYamlRaw(name, homeDir)
  if (raw === null) {
    return { error: `Agent "${name}" not found` }
  }
  const validation = parseAgentYaml(raw)
  if (!validation.valid || !validation.agent) {
    return { error: `Agent YAML invalid: ${validation.errors.join('; ')}` }
  }
  const agent = validation.agent
  const tools = {
    mcp: agent.spec.tools?.mcp ?? [],
    skills: agent.spec.tools?.skills ?? [],
    plugins: agent.spec.tools?.plugins ?? []
  }
  const systemPrompt = renderSystemPrompt(agent, tools)
  return {
    payload: {
      provider: agent.spec.runtime.provider,
      runtimeType: agent.spec.runtime.type,
      systemPrompt,
      initialMessage: systemPrompt,
      displayName: agent.metadata.display_name ?? agent.metadata.name,
      tools
    }
  }
}

/**
 * Render the system_prompt template, or synthesize one from the role if
 * system_prompt is absent. Supported variables:
 *   {{role}}   — the agent's role text
 *   {{tools}}  — a human summary of available tools
 *   {{name}}   — the agent's metadata.name
 */
export function renderSystemPrompt(
  agent: AgentYaml,
  tools: { mcp: string[]; skills: string[]; plugins: string[] }
): string {
  const template = agent.spec.system_prompt ?? '{{role}}'
  const role = agent.spec.role.trim()
  const toolSummary = formatToolSummary(tools)
  const name = agent.metadata.name
  return template
    .replace(/\{\{\s*role\s*\}\}/g, role)
    .replace(/\{\{\s*tools\s*\}\}/g, toolSummary)
    .replace(/\{\{\s*name\s*\}\}/g, name)
    .trim()
}

function formatToolSummary(tools: { mcp: string[]; skills: string[]; plugins: string[] }): string {
  const parts: string[] = []
  if (tools.mcp.length > 0) {
    parts.push(`MCP servers: ${tools.mcp.join(', ')}`)
  }
  if (tools.skills.length > 0) {
    parts.push(`Skills: ${tools.skills.join(', ')}`)
  }
  if (tools.plugins.length > 0) {
    parts.push(`Plugins: ${tools.plugins.join(', ')}`)
  }
  return parts.length > 0 ? parts.join('; ') : '(no explicit tools declared)'
}
