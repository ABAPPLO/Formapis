import { describe, expect, it } from 'vitest'
import { taskStatusStyle } from './task-status-style'

describe('taskStatusStyle', () => {
  it('maps each known orchestration status', () => {
    expect(taskStatusStyle('completed').dot).toBe('bg-emerald-500')
    expect(taskStatusStyle('dispatched').dot).toContain('animate-pulse')
    expect(taskStatusStyle('failed').border).toContain('red')
  })
  it('falls back to pending for unknown status', () => {
    expect(taskStatusStyle('nope')).toEqual(taskStatusStyle('pending'))
  })
  it('every known status has dot+border+label', () => {
    for (const s of ['pending', 'ready', 'dispatched', 'blocked', 'completed', 'failed']) {
      const st = taskStatusStyle(s)
      expect(st.dot).toBeTruthy()
      expect(st.border).toBeTruthy()
      expect(st.label).toBeTruthy()
    }
  })
})
