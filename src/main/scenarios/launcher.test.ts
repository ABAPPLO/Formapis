import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getScenarioYamlDir } from './registry'
import { getAgentYamlDir } from '../agents-yaml/registry'
import { launchScenario, type ScenarioOrchestrationDb } from './launcher'

describe('launcher assignee validation', () => {
  let homeDir: string

  beforeAll(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'formapis-launcher-'))
    mkdirSync(getScenarioYamlDir(homeDir), { recursive: true })
    mkdirSync(getAgentYamlDir(homeDir), { recursive: true })

    // Structurally valid but references agents that are NOT registered.
    writeFileSync(
      join(getScenarioYamlDir(homeDir), 'two-unknown-agents.yaml'),
      `apiVersion: formapis/v1
kind: Scenario
metadata:
  name: two-unknown-agents
spec:
  mode: orchestrated
  agents:
    - ref: nope-a
    - ref: nope-b
  tasks:
    - id: a
      assignee: nope-a
      spec: do a
    - id: b
      assignee: nope-b
      spec: do b
      deps:
        - a
`
    )

    // Same bad assignee twice — exercises dedup + order preservation.
    writeFileSync(
      join(getScenarioYamlDir(homeDir), 'dup-unknown.yaml'),
      `apiVersion: formapis/v1
kind: Scenario
metadata:
  name: dup-unknown
spec:
  mode: orchestrated
  agents:
    - ref: nope-a
  tasks:
    - id: a
      assignee: nope-a
      spec: do a
    - id: b
      assignee: nope-a
      spec: do b
`
    )

    // Happy path: a registered agent used as assignee.
    writeFileSync(
      join(getAgentYamlDir(homeDir), 'real-agent.yaml'),
      `apiVersion: formapis/v1
kind: Agent
metadata:
  name: real-agent
spec:
  runtime:
    provider: claude
  role: doer
`
    )
    writeFileSync(
      join(getScenarioYamlDir(homeDir), 'known-agent.yaml'),
      `apiVersion: formapis/v1
kind: Scenario
metadata:
  name: known-agent
spec:
  mode: orchestrated
  agents:
    - ref: real-agent
  tasks:
    - id: a
      assignee: real-agent
      spec: do a
`
    )
  })

  afterAll(() => {
    rmSync(homeDir, { recursive: true, force: true })
  })

  function makeDb() {
    return {
      resetTasks: vi.fn<() => void>(),
      createTask: vi.fn<
        (task: { spec: string; taskTitle?: string; deps?: string[] }) => { id: string }
      >(({ taskTitle }) => ({ id: `engine-${taskTitle ?? 'task'}` }))
    } satisfies ScenarioOrchestrationDb
  }

  it('refuses launch when assignees are not registered agents', () => {
    const db = makeDb()
    const r = launchScenario({ name: 'two-unknown-agents', db, homeDir })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.unknownAssignees).toEqual(['nope-a', 'nope-b'])
      expect(db.resetTasks).not.toHaveBeenCalled()
      expect(db.createTask).not.toHaveBeenCalled()
    }
  })

  it('lists unknown assignees deduped and in first-seen order', () => {
    const db = makeDb()
    const r = launchScenario({ name: 'dup-unknown', db, homeDir })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.unknownAssignees).toEqual(['nope-a'])
      expect(db.resetTasks).not.toHaveBeenCalled()
    }
  })

  it('launches when every assignee is a registered agent', () => {
    const db = makeDb()
    const r = launchScenario({ name: 'known-agent', db, homeDir })
    expect(r.ok).toBe(true)
    expect(db.resetTasks).toHaveBeenCalledTimes(1)
    expect(db.createTask).toHaveBeenCalledTimes(1)
  })
})
