import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, FolderOpen, Loader2, MinusCircle, Plus, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type {
  CanonicalResource,
  DistributionStatus,
  ResourceKind
} from '../../../../shared/resources'
import { kindIcons, kindLabels } from './kind-meta'

const stateMeta: Record<
  DistributionStatus['state'],
  { label: string; icon: typeof CheckCircle2; tone: string }
> = {
  linked: { label: 'Linked', icon: CheckCircle2, tone: 'text-emerald-500' },
  copied: { label: 'Copied', icon: CheckCircle2, tone: 'text-emerald-500' },
  missing: { label: 'Not distributed', icon: MinusCircle, tone: 'text-muted-foreground' },
  foreign: { label: 'Foreign', icon: XCircle, tone: 'text-amber-500' },
  unsupported: { label: 'Unsupported', icon: MinusCircle, tone: 'text-muted-foreground' }
}

export function CanonicalResourceCard({
  resource,
  onChanged
}: {
  resource: CanonicalResource
  onChanged: () => void
}) {
  const KindIcon = kindIcons[resource.kind]
  const [statuses, setStatuses] = useState<DistributionStatus[] | null>(null)
  const [busy, setBusy] = useState(false)

  const loadStatuses = useCallback(async () => {
    try {
      const next = await window.api.resources.distribution.inspect(resource.kind, resource.name)
      setStatuses(next)
    } catch {
      setStatuses(null)
    }
  }, [resource.kind, resource.name])

  useEffect(() => {
    void loadStatuses()
  }, [loadStatuses])

  const distributedCount =
    statuses?.filter((s) => s.state === 'linked' || s.state === 'copied').length ?? 0

  const handleDistribute = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.resources.distribute(resource.kind, resource.name)
      const failed = result.statuses.filter((s) => s.state === 'foreign' && s.note)
      if (failed.length > 0) {
        toast.warning(
          `Distributed to ${result.statuses.length - failed.length} agents (${failed.length} skipped)`
        )
      } else {
        toast.success(`Distributed to ${result.statuses.length} agents`)
      }
      setStatuses(result.statuses)
    } catch (error) {
      toast.error('Distribution failed', { description: String(error) })
    } finally {
      setBusy(false)
    }
  }

  const handleUndistribute = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await window.api.resources.distribution.remove(resource.kind, resource.name)
      setStatuses(next)
      toast.success('Removed distributions')
    } catch (error) {
      toast.error('Could not remove distributions', { description: String(error) })
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (
      !confirm(
        `Delete canonical ${resource.kind} "${resource.name}"? This removes the canonical definition but leaves distributed copies in place.`
      )
    ) {
      return
    }
    setBusy(true)
    try {
      await window.api.resources.canonical.remove(resource.kind, resource.name)
      toast.success('Canonical resource deleted')
      onChanged()
    } catch (error) {
      toast.error('Could not delete', { description: String(error) })
    } finally {
      setBusy(false)
    }
  }

  const handleReveal = (): void => {
    window.api.shell.openInFileManager(resource.canonicalPath).catch(() => {
      toast.error('Could not open file manager')
    })
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <KindIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-medium" title={resource.name}>
                {resource.name}
              </h3>
              <Badge variant="outline">{kindLabels[resource.kind]}</Badge>
              <Badge variant="secondary">Canonical</Badge>
              {statuses ? (
                <Badge variant="outline" className="text-emerald-600">
                  {distributedCount}/{statuses.length} agents
                </Badge>
              ) : null}
            </div>
            {resource.description ? (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {resource.description}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground/60">No description</p>
            )}
            <p
              className="mt-1 truncate font-mono text-xs text-muted-foreground/60"
              title={resource.canonicalPath}
            >
              {resource.canonicalPath}
            </p>

            {statuses && statuses.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {statuses.map((s) => {
                  const meta = stateMeta[s.state]
                  const StateIcon = meta.icon
                  return (
                    <Tooltip key={s.agent}>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]">
                          <StateIcon className={cn('size-3', meta.tone)} />
                          {s.agent}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {meta.label}
                        {s.targetPath ? ` · ${s.targetPath}` : ''}
                        {s.note ? ` · ${s.note}` : ''}
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            ) : null}

            <div className="mt-3 flex items-center gap-1">
              {resource.kind !== 'mcp' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDistribute()}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 size-3.5" />
                  )}
                  Distribute
                </Button>
              ) : null}
              {resource.kind !== 'mcp' && distributedCount > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleUndistribute()}
                  disabled={busy}
                >
                  <MinusCircle className="mr-1.5 size-3.5" />
                  Remove links
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={handleReveal}>
                <FolderOpen className="mr-1.5 size-3.5" />
                Reveal
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() => void handleDelete()}
                disabled={busy}
              >
                <Trash2 className="mr-1.5 size-3.5" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export type { ResourceKind }
