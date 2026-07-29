import { useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import '@/lib/monaco-setup'
import { computeEditorFontSize, resolveEditorFontFamily } from '@/lib/editor-font-zoom'
import { useAppStore } from '@/store'

export type YamlEditorProps = {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  onSave?: (value: string) => void
  placeholder?: string
}

export function YamlEditor({
  value,
  onChange,
  readOnly = false,
  onSave,
  placeholder
}: YamlEditorProps): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const isDark =
    settings?.theme === 'dark' ||
    (settings?.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const fontSize = computeEditorFontSize(settings?.terminalFontSize ?? 13, editorFontZoomLevel)
  const fontFamily = resolveEditorFontFamily(settings)

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  // Why: 平台感知 Cmd/Ctrl+S → onSave(STYLEGUIDE 跨平台规则)。
  useEffect(() => {
    if (!onSave) {
      return
    }
    const isMac = navigator.userAgent.includes('Mac')
    const handler = (event: KeyboardEvent): void => {
      const mod = isMac ? event.metaKey : event.ctrlKey
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        onSaveRef.current?.(value)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSave, value])

  return (
    <Editor
      value={value}
      language="yaml"
      theme={isDark ? 'vs-dark' : 'vs'}
      onChange={(v) => {
        if (v !== undefined) {
          onChangeRef.current(v)
        }
      }}
      loading={
        placeholder ? (
          <div className="p-4 text-sm text-muted-foreground">{placeholder}</div>
        ) : undefined
      }
      options={{
        readOnly,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        smoothScrolling: true,
        padding: { top: 8 },
        fontSize,
        fontFamily
      }}
    />
  )
}
