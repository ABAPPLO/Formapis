import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Blocks,
  Clock,
  FolderOpen,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  Server
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import type {
  DiscoveredResource,
  ResourceDiscoveryResult,
  ResourceKind,
  ResourceSourceKind
} from '../../../../shared/resources'

const kindLabels: Record<ResourceKind, string> = {
  mcp: 'MCP',
  skill: 'Skill',
  plugin: 'Plugin'
}

const kindIcons: Record<ResourceKind, typeof Server> = {
  mcp: Server,
  skill: Blocks,
  plugin: Plug
}

const sourceLabels: Record<ResourceSourceKind, string> = {
  canonical: 'Canonical',
  home: 'Home',
  repo: 'Repository',
  bundled: 'Bundled',
  plugin: 'Plugin'
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

const EMPTY_RESOURCES: DiscoveredResource[] = []

function formatUpdatedAt(value: number | null): string {
  return value ? dateFormatter.format(new Date(value)) : '—'
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function ResourceCard({ resource }: { resource: DiscoveredResource }) {
  const KindIcon = kindIcons[resource.kind]
  const handleReveal = (): void => {
    window.api.shell.openInFileManager(resource.primaryPath).catch(() => {
      toast.error('Could not open file manager')
    })
  }
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <KindIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-medium" title={resource.name}>
                {resource.name}
              </h3>
              <Badge variant={resource.status === 'active' ? 'secondary' : 'outline'}>
                {resource.status === 'active' ? 'Active' : resource.status}
              </Badge>
              <Badge variant="outline">{kindLabels[resource.kind]}</Badge>
              <Badge variant="outline">{sourceLabels[resource.sourceKind]}</Badge>
            </div>
            {resource.description ? (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {resource.description}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground/60">No description</p>
            )}
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="text-muted-foreground/60">Path</span>
                <span className="truncate font-mono" title={resource.primaryPath}>
                  {resource.primaryPath}
                </span>
                {resource.detail.kind === 'mcp' ? (
                  <>
                    <span className="text-muted-foreground/60">Transport</span>
                    <span className="font-mono">
                      {resource.detail.transport}
                      {resource.detail.endpoint ? ` · ${resource.detail.endpoint}` : ''}
                    </span>
                  </>
                ) : null}
                {resource.detail.kind === 'skill' ? (
                  <>
                    <span className="text-muted-foreground/60">Files</span>
                    <span>{resource.detail.fileCount}</span>
                  </>
                ) : null}
                {resource.providers.length > 0 ? (
                  <>
                    <span className="text-muted-foreground/60">Providers</span>
                    <span className="flex flex-wrap gap-1">
                      {resource.providers.map((p) => (
                        <Badge key={p} variant="outline" className="text-[10px]">
                          {p}
                        </Badge>
                      ))}
                    </span>
                  </>
                ) : null}
                <span className="text-muted-foreground/60">Updated</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" />
                  {formatUpdatedAt(resource.updatedAt)}
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" onClick={handleReveal}>
                    <FolderOpen className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reveal file</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyState({
  loading,
  hasFilters,
  onRefresh
}: {
  loading: boolean
  hasFilters: boolean
  onRefresh: () => void
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Scanning resources…
      </div>
    )
  }
  if (hasFilters) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <p>No resources match your filters.</p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="mr-2 size-3.5" />
          Refresh
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Blocks className="size-8 opacity-40" />
      <div className="text-center">
        <p className="font-medium">No resources discovered</p>
        <p className="text-sm">
          Install MCP servers, skills, or plugins in any supported agent&apos;s home directory and
          they will appear here.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRefresh}>
        <RefreshCw className="mr-2 size-3.5" />
        Scan again
      </Button>
    </div>
  )
}

type FilterState = {
  query: string
  kind: ResourceKind | 'all'
  sourceKind: ResourceSourceKind | 'all'
}

function filterResources(
  resources: DiscoveredResource[],
  filters: FilterState
): DiscoveredResource[] {
  const query = filters.query.trim().toLowerCase()
  return resources.filter((r) => {
    if (filters.kind !== 'all' && r.kind !== filters.kind) {
      return false
    }
    if (filters.sourceKind !== 'all' && r.sourceKind !== filters.sourceKind) {
      return false
    }
    if (query) {
      const haystack = `${r.name} ${r.description ?? ''} ${r.primaryPath}`.toLowerCase()
      if (!haystack.includes(query)) {
        return false
      }
    }
    return true
  })
}

export default function ResourcesPage(): React.JSX.Element {
  const closeResourcesPage = useAppStore((s) => s.closeResourcesPage)
  const mountedRef = useMountedRef()
  const [result, setResult] = useState<ResourceDiscoveryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<FilterState>({
    query: '',
    kind: 'all',
    sourceKind: 'all'
  })

  const loadResources = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const next = await window.api.resources.discover()
      if (mountedRef.current) {
        setResult(next)
      }
    } catch (error) {
      console.error('Failed to discover resources:', error)
      if (mountedRef.current) {
        toast.error('Could not scan local resources')
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [mountedRef])

  useEffect(() => {
    void loadResources()
  }, [loadResources])

  // Escape closes the page (matches SkillsPage behavior), unless a dialog/menu has focus.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
          return
        }
        if (target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) {
          return
        }
      }
      closeResourcesPage()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeResourcesPage])

  const resources = result?.resources ?? EMPTY_RESOURCES
  const visibleResources = useMemo(() => filterResources(resources, filters), [filters, resources])
  const counts = useMemo(() => {
    const byKind: Record<string, number> = { mcp: 0, skill: 0, plugin: 0 }
    for (const r of resources) {
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
    }
    return byKind
  }, [resources])
  const hasFilters =
    filters.query.trim() !== '' || filters.kind !== 'all' || filters.sourceKind !== 'all'

  return (
    <main className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="icon" className="size-7" onClick={closeResourcesPage}>
          <ArrowLeft className="size-4" />
        </Button>
        <Blocks className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Resources</h2>
        <Badge variant="outline">Beta</Badge>
        <span className="ml-2 text-sm text-muted-foreground">
          {pluralize(resources.length, 'resource')} · {pluralize(counts.mcp, 'MCP')} ·{' '}
          {pluralize(counts.skill, 'skill')} · {pluralize(counts.plugin, 'plugin')}
        </span>
      </header>

      <section className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            placeholder="Search resources…"
            className="pl-8"
          />
        </div>
        <Select
          value={filters.kind}
          onValueChange={(v) => setFilters((f) => ({ ...f, kind: v as FilterState['kind'] }))}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Kind" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="mcp">MCP</SelectItem>
            <SelectItem value="skill">Skills</SelectItem>
            <SelectItem value="plugin">Plugins</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.sourceKind}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, sourceKind: v as FilterState['sourceKind'] }))
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="canonical">Canonical</SelectItem>
            <SelectItem value="home">Home</SelectItem>
            <SelectItem value="repo">Repository</SelectItem>
            <SelectItem value="bundled">Bundled</SelectItem>
            <SelectItem value="plugin">Plugin</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => void loadResources()} title="Refresh">
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        </Button>
      </section>

      <section className="scrollbar-sleek flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          {visibleResources.length > 0 ? (
            visibleResources.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))
          ) : (
            <EmptyState
              loading={loading}
              hasFilters={hasFilters}
              onRefresh={() => void loadResources()}
            />
          )}
        </div>
      </section>
    </main>
  )
}
