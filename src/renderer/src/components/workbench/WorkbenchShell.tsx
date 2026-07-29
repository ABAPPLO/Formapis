import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type WorkbenchShellProps = {
  title: string
  icon?: ReactNode
  badge?: ReactNode
  countLabel?: string
  onBack: () => void
  toolbar?: ReactNode
  children: ReactNode
}

export function WorkbenchShell({
  title,
  icon,
  badge,
  countLabel,
  onBack,
  toolbar,
  children
}: WorkbenchShellProps): React.JSX.Element {
  return (
    <main className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </Button>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        <h2 className="text-lg font-semibold">{title}</h2>
        {badge ?? null}
        {countLabel ? (
          <span className="ml-1 text-sm text-muted-foreground">{countLabel}</span>
        ) : null}
        {toolbar ? <div className="ml-auto flex items-center gap-2">{toolbar}</div> : null}
      </header>
      {children}
    </main>
  )
}
