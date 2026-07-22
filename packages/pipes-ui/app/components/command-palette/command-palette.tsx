'use client'

import { useEffect, useMemo, useState } from 'react'

import { defaultFilter } from 'cmdk'

import {
  type PaletteEntry,
  buildPaletteGroups,
  createPaletteFilter,
  executePaletteAction,
} from '~/components/command-palette/registry'
import { useTheme } from '~/components/theme-provider'
import { CircularProgress } from '~/components/ui/circular-progress'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import { PipeStatus, useFleetStats } from '~/hooks/use-metrics'
import { useServers } from '~/hooks/use-servers'
import { useUrlNavigate, useUrlParam } from '~/hooks/use-url-param'

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [pipeId] = useUrlParam('pipe', '')
  const [tab] = useUrlParam('tab', 'profiler')
  const { data: servers } = useServers()
  const { data: fleet } = useFleetStats(open ? servers : undefined)
  const navigate = useUrlNavigate()
  const { setTheme } = useTheme()
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (event.repeat) return

        onOpenChange(!open)
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  // The query lives outside the auto-unmounting dialog content, so clear it
  // ourselves — reopening should always start from the full list.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const hasQuery = query.trim() !== ''
  const groups = useMemo(
    () => buildPaletteGroups(fleet, { pipeOpen: pipeId !== '', currentTab: tab, hasQuery }),
    [fleet, pipeId, tab, hasQuery],
  )

  const filter = useMemo(() => {
    // cmdk matches on the trimmed item value, so the lookup keys must mirror it.
    const priorityValues = new Set(
      groups.flatMap((group) => group.entries.filter((entry) => entry.priority).map((entry) => entry.id.trim())),
    )

    return createPaletteFilter(priorityValues, defaultFilter)
  }, [groups])

  const onSelect = (entry: PaletteEntry) => {
    if (!entry.action) return

    onOpenChange(false)
    executePaletteAction(entry.action, {
      navigate,
      setTheme,
      openUrl: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
    })
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} filter={filter}>
      <CommandInput placeholder="Search pipes and commands..." value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {groups.map((group) => (
          // cmdk reorders group DOM nodes while sorting but skips the sort on an
          // empty query, so remount the groups when the query empties to restore
          // the registry order (Pipes first).
          <CommandGroup key={hasQuery ? `${group.heading} · typing` : group.heading} heading={group.heading}>
            {group.entries.map((entry) => (
              <CommandItem
                key={entry.id}
                value={entry.id}
                keywords={[entry.title, ...entry.keywords]}
                disabled={entry.disabled}
                onSelect={() => onSelect(entry)}
              >
                {entry.logoUrl && <img src={entry.logoUrl} alt="" className="w-4 h-4" />}
                <div className="flex-1 min-w-0">
                  <div className="truncate">{entry.title}</div>
                  {entry.subtitle && <div className="text-xxs text-muted-foreground truncate">{entry.subtitle}</div>}
                </div>
                <EntryStatus entry={entry} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}

function EntryStatus({ entry }: { entry: PaletteEntry }) {
  if (entry.status === PipeStatus.Syncing && entry.progressPercent !== undefined) {
    return <CircularProgress percent={entry.progressPercent} />
  }
  if (entry.status === PipeStatus.Synced) {
    return <span className="text-xxs text-muted-foreground">Synced</span>
  }
  if (entry.status === PipeStatus.Calculating) {
    return <span className="text-xxs text-muted-foreground animate-pulse">Calculating…</span>
  }

  return null
}
