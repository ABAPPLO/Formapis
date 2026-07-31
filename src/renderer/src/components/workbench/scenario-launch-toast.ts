import { toast } from 'sonner'

// Why: unknown-assignee refusal is actionable (register the agent first), so
// surface it distinctly from a generic launch error. Shared across launch sites.
export function toastLaunchFailure(result: { error: string; unknownAssignees?: string[] }): void {
  if (result.unknownAssignees && result.unknownAssignees.length > 0) {
    toast.error('Scenario not started', {
      description: `Unknown agent(s): ${result.unknownAssignees.join(', ')}`
    })
  } else {
    toast.error('Launch failed', { description: result.error })
  }
}
