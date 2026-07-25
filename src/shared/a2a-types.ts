/**
 * A2A (Agent-to-Agent) protocol types — a subset of the Google A2A spec.
 *
 * Formapis exposes its agents and scenarios over A2A so external systems
 * (other Formapis instances, third-party A2A clients) can discover and invoke
 * them. This file defines the wire types shared by the server (src/main/a2a)
 * and any future client.
 *
 * Spec reference: https://github.com/google/agents-architecture
 * Key endpoints:
 *   GET  /.well-known/agent.json          → AgentCard (discovery)
 *   POST /a2a (JSON-RPC 2.0)              → message/send, tasks/get, tasks/cancel
 */

// ─── AgentCard (discovery document) ─────────────────────────────────────────

export type A2AAgentSkill = {
  id: string
  name: string
  description: string
  tags?: string[]
  /** Optional example inputs that this skill handles. */
  examples?: string[]
}

export type A2AAgentCapabilities = {
  streaming?: boolean
  pushNotifications?: boolean
  stateTransition?: boolean
}

export type A2AAgentCard = {
  name: string
  description?: string
  /** Base URL where the agent receives JSON-RPC calls (e.g. http://host:port/a2a). */
  url: string
  version: string
  capabilities: A2AAgentCapabilities
  defaultInputModes?: string[]
  defaultOutputModes?: string[]
  skills: A2AAgentSkill[]
}

// ─── Message + Part ─────────────────────────────────────────────────────────

export type A2ATextPart = {
  type: 'text'
  text: string
}

export type A2ADataPart = {
  type: 'data'
  data: Record<string, unknown>
}

export type A2AFilePart = {
  type: 'file'
  file: {
    name?: string
    mimeType?: string
    /** Base64-encoded bytes, or a URL to fetch. */
    bytes?: string
    uri?: string
  }
}

export type A2APart = A2ATextPart | A2ADataPart | A2AFilePart

export type A2AMessage = {
  role: 'user' | 'agent'
  parts: A2APart[]
  /** Message ID (optional in requests, present in responses). */
  messageId?: string
  /** Task this message belongs to. */
  taskId?: string
}

// ─── Task lifecycle ─────────────────────────────────────────────────────────

export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled'

export type A2ATaskStatus = {
  state: A2ATaskState
  /** Human-readable status update. */
  message?: string
  /** ISO timestamp of the last update. */
  timestamp?: string
}

export type A2ATask = {
  id: string
  /** Session grouping (optional; Formapis uses the scenario name). */
  sessionId?: string
  status: A2ATaskStatus
  /** The user's input messages. */
  history?: A2AMessage[]
  /** Artifacts produced by the agent. */
  artifacts?: {
    name?: string
    description?: string
    parts: A2APart[]
  }[]
}

// ─── JSON-RPC 2.0 envelope ──────────────────────────────────────────────────

export type A2AJsonRpcRequest = {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: Record<string, unknown>
}

export type A2AJsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: A2AJsonRpcError }

export type A2AJsonRpcError = {
  code: number
  message: string
  data?: unknown
}

// Standard JSON-RPC error codes used by A2A.
export const A2A_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // A2A-specific
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  UNSUPPORTED_OPERATION: -32003
} as const

// ─── A2A method params (subset we implement) ────────────────────────────────

export type A2AMessageSendParams = {
  message: A2AMessage
  /** Optional target skill/agent (maps to a Formapis agent name or scenario). */
  configuration?: {
    blocking?: boolean
  }
}

export type A2ATasksGetParams = {
  id: string
  /** Desired response length: short/full. */
  historyLength?: number
}

export type A2ATasksCancelParams = {
  id: string
}
