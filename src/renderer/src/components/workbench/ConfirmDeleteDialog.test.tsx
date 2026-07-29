// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
afterEach(() => {
  roots.splice(0).forEach((root) => {
    act(() => root.unmount())
  })
  document.body.replaceChildren()
})

describe('ConfirmDeleteDialog', () => {
  it('mounts title + Cancel and a destructive confirm button into the portal', async () => {
    const root = createRoot(document.createElement('div'))
    roots.push(root)
    await act(async () => {
      root.render(
        <ConfirmDeleteDialog
          open={true}
          title='Delete "x"?'
          onOpenChange={vi.fn()}
          onConfirm={vi.fn()}
        />
      )
    })
    expect(document.body.textContent ?? '').toContain('Delete "x"?')
    expect(document.body.textContent ?? '').toContain('Cancel')
    expect(document.body.querySelector<HTMLElement>('[data-variant="destructive"]')).not.toBeNull()
  })
})
