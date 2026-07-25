import type { IncomingMessage, ServerResponse, RequestListener } from 'node:http'
import { buildAgentCard } from './agent-card'
import {
  A2A_ERROR,
  type A2AJsonRpcError,
  type A2AJsonRpcRequest,
  type A2AJsonRpcResponse,
  type A2ATask,
  type A2ATaskState,
  type A2AMessageSendParams,
  type A2ATasksGetParams,
  type A2ATasksCancelParams
} from '../../shared/a2a-types'

/**
 * A2A HTTP handler — serves AgentCard discovery + JSON-RPC task operations.
 *
 * Mounted on the existing runtime HTTP server (ws-transport) via a
 * RequestListener chain, so no new port is opened. Two routes:
 *
 *   GET  /.well-known/agent.json  → AgentCard (discovery)
 *   POST /a2a                     → JSON-RPC 2.0 (message/send, tasks/get, ...)
 *
 * message/send maps to: create an orchestration task with the user's text as
 * spec, then (if no coordinator is running) start one. The A2A task id is the
 * orchestration task id. tasks/get maps to getTask + status translation.
 * tasks/cancel is not supported yet (the coordinator lacks cancel; returns
 * TASK_NOT_CANCELABLE).
 */

/** Minimal orchestration surface the A2A handler needs. */
export type A2AOrchestrationAccess = {
  /** Create a task; returns its id. */
  createTask(spec: string, taskTitle?: string): string
  /** Look up a task by id. */
  getTask(id: string): {
    id: string
    spec: string
    status: string
    task_title: string | null
    result: string | null
  } | null
  /** Whether a coordinator run is currently active. */
  hasActiveRun(): boolean
  /** Start a coordinator run (fire-and-forget). Optional: if absent, tasks wait for manual launch. */
  startRun?(spec: string): void
}

export type A2AHandlerOptions = {
  /** External base URL for building the AgentCard url field (e.g. http://host:port). */
  baseUrl: string
  access: A2AOrchestrationAccess
}

const A2A_PATH = '/a2a'
const AGENT_CARD_PATH = '/.well-known/agent.json'

/** Whether this request is an A2A route (checked synchronously for routing). */
function isA2ARoute(req: IncomingMessage): boolean {
  const url = req.url ?? ''
  return (
    (req.method === 'GET' && url === AGENT_CARD_PATH) ||
    (req.method === 'POST' && (url === A2A_PATH || url.startsWith(`${A2A_PATH}/`)))
  )
}

/**
 * Build a { shouldHandle, handle } pair for the ws-transport request-listener
 * chain. shouldHandle is synchronous so async JSON-RPC responses don't race
 * the static fallback; handle owns the full response lifecycle.
 */
export function createA2AHandler(options: A2AHandlerOptions): {
  shouldHandle: (req: IncomingMessage) => boolean
  handle: RequestListener
} {
  return {
    shouldHandle: isA2ARoute,
    handle: (req: IncomingMessage, res: ServerResponse): void => {
      const url = req.url ?? ''
      if (req.method === 'GET' && url === AGENT_CARD_PATH) {
        handleAgentCard(res, options.baseUrl)
        return
      }
      void handleJsonRpc(req, res, options.access, options.baseUrl)
    }
  }
}

function handleAgentCard(res: ServerResponse, baseUrl: string): void {
  const card = buildAgentCard(baseUrl)
  sendJson(res, 200, card)
}

async function handleJsonRpc(
  req: IncomingMessage,
  res: ServerResponse,
  access: A2AOrchestrationAccess,
  baseUrl: string
): Promise<void> {
  let raw: string
  try {
    raw = await readBody(req)
  } catch {
    sendJsonRpcError(res, null, A2A_ERROR.PARSE_ERROR, 'Failed to parse request body')
    return
  }

  let request: A2AJsonRpcRequest
  try {
    request = JSON.parse(raw) as A2AJsonRpcRequest
  } catch {
    sendJsonRpcError(res, null, A2A_ERROR.PARSE_ERROR, 'Invalid JSON')
    return
  }

  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    sendJsonRpcError(
      res,
      request.id ?? null,
      A2A_ERROR.INVALID_REQUEST,
      'Not a JSON-RPC 2.0 request'
    )
    return
  }

  try {
    const result = await dispatchMethod(request, access, baseUrl)
    const response: A2AJsonRpcResponse = { jsonrpc: '2.0', id: request.id, result }
    sendJson(res, 200, response)
  } catch (error) {
    if (isA2AError(error)) {
      sendJsonRpcError(res, request.id, error.code, error.message)
    } else {
      sendJsonRpcError(
        res,
        request.id,
        A2A_ERROR.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Internal error'
      )
    }
  }
}

async function dispatchMethod(
  request: A2AJsonRpcRequest,
  access: A2AOrchestrationAccess,
  baseUrl: string
): Promise<unknown> {
  switch (request.method) {
    case 'message/send':
      return handleMessageSend(request.params as A2AMessageSendParams, access)
    case 'tasks/get':
      return handleTasksGet(request.params as A2ATasksGetParams, access)
    case 'tasks/cancel':
      return handleTasksCancel(request.params as A2ATasksCancelParams)
    case 'tasks/list':
      return { tasks: [] } // Phase 5 minimal: listing delegated to the task board UI.
    case 'agent/listSkills':
      return { skills: buildAgentCard(baseUrl).skills }
    default:
      throw a2aError(A2A_ERROR.METHOD_NOT_FOUND, `Unknown method: ${request.method}`)
  }
}

function handleMessageSend(params: A2AMessageSendParams, access: A2AOrchestrationAccess): A2ATask {
  if (!params?.message) {
    throw a2aError(A2A_ERROR.INVALID_PARAMS, 'message is required')
  }
  const textParts = params.message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
  const spec = textParts.join('\n').trim()
  if (!spec) {
    throw a2aError(A2A_ERROR.INVALID_PARAMS, 'message must contain at least one text part')
  }

  const taskId = access.createTask(spec, params.message.taskId)
  // Why: if no coordinator is running and startRun is available, start one so
  // the task gets picked up. Otherwise the task waits for a manual launch.
  if (!access.hasActiveRun() && access.startRun) {
    access.startRun(spec.slice(0, 80))
  }

  return {
    id: taskId,
    status: { state: 'submitted', timestamp: new Date().toISOString() },
    history: [params.message]
  }
}

function handleTasksGet(params: A2ATasksGetParams, access: A2AOrchestrationAccess): A2ATask {
  if (!params?.id) {
    throw a2aError(A2A_ERROR.INVALID_PARAMS, 'id is required')
  }
  const task = access.getTask(params.id)
  if (!task) {
    throw a2aError(A2A_ERROR.TASK_NOT_FOUND, `Task ${params.id} not found`)
  }
  return orchestrationTaskToA2A(task)
}

function handleTasksCancel(params: A2ATasksCancelParams): never {
  void params
  throw a2aError(A2A_ERROR.TASK_NOT_CANCELABLE, 'Task cancellation is not supported yet')
}

// ─── orchestration → A2A translation ────────────────────────────────────────

function orchestrationTaskToA2A(task: {
  id: string
  spec: string
  status: string
  task_title: string | null
  result: string | null
}): A2ATask {
  return {
    id: task.id,
    sessionId: task.task_title ?? undefined,
    status: {
      state: mapOrchestrationStatusToA2A(task.status),
      timestamp: new Date().toISOString()
    },
    history: [
      {
        role: 'user',
        parts: [{ type: 'text', text: task.spec }]
      }
    ],
    ...(task.result
      ? {
          artifacts: [
            {
              parts: [{ type: 'text', text: task.result }]
            }
          ]
        }
      : {})
  }
}

/** Map Orca task status → A2A task state. */
function mapOrchestrationStatusToA2A(status: string): A2ATaskState {
  switch (status) {
    case 'pending':
    case 'ready':
    case 'dispatched':
      return 'working'
    case 'blocked':
      return 'input-required'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    default:
      return 'working'
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1024 * 1024) {
        reject(new Error('Body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*'
  })
  res.end(payload)
}

function sendJsonRpcError(
  res: ServerResponse,
  id: string | number | null,
  code: number,
  message: string
): void {
  const response: A2AJsonRpcResponse = {
    jsonrpc: '2.0',
    id,
    error: { code, message }
  }
  sendJson(res, 200, response)
}

class A2AErrorExtended extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message)
    this.name = 'A2AError'
  }
}

function a2aError(code: number, message: string): A2AErrorExtended {
  return new A2AErrorExtended(code, message)
}

function isA2AError(value: unknown): value is A2AJsonRpcError & { code: number } {
  return value instanceof A2AErrorExtended
}
