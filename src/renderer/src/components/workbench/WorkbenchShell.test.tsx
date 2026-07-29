import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchShell } from './WorkbenchShell'

describe('WorkbenchShell', () => {
  it('renders title, count, badge, back button, and toolbar slot', () => {
    const html = renderToStaticMarkup(
      <WorkbenchShell
        title="Agents"
        countLabel="3 agents"
        badge={<span data-slot="test-badge">YAML</span>}
        onBack={vi.fn()}
        toolbar={<button data-slot="test-new">New</button>}
      >
        <div data-slot="test-body" />
      </WorkbenchShell>
    )
    expect(html).toContain('Agents')
    expect(html).toContain('3 agents')
    expect(html).toContain('data-slot="test-badge"')
    expect(html).toContain('data-slot="test-new"')
    expect(html).toContain('data-slot="test-body"')
    expect(html).toContain('data-slot="button"') // 返回按钮
  })
})
