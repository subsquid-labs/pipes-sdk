import type { Theme } from '~/components/theme-provider'
import { datasetLabel } from '~/dashboard/formatters'
import type { FleetServer, Pipe, PipeStatus } from '~/hooks/use-metrics'

export const DOCS_URL = 'https://beta.docs.sqd.dev'

const DEFAULT_TAB = 'profiler'

export type PaletteAction =
  | { type: 'navigate'; params: Record<string, string | number | null>; push: boolean }
  | { type: 'open-url'; url: string }
  | { type: 'set-theme'; theme: Theme }

export type PaletteEntry = {
  /** Unique within the palette. Doubles as the cmdk match value, so it must contain the human-searchable text. */
  id: string
  title: string
  /** Extra fuzzy-match terms beyond the id/value. */
  keywords: string[]
  subtitle?: string
  logoUrl?: string
  /** Disabled rows are hints (e.g. offline servers) — visible and filterable, but not selectable. */
  disabled?: boolean
  status?: PipeStatus
  progressPercent?: number
  /** Priority entries are score-boosted above every non-priority match while the user types. */
  priority?: boolean
  /** Absent only on disabled hint rows. */
  action?: PaletteAction
}

export type PaletteGroup = {
  heading: string
  entries: PaletteEntry[]
}

export type PaletteContext = {
  pipeOpen: boolean
  currentTab: string
  hasQuery: boolean
}

/** Structurally identical to cmdk's (unexported) CommandFilter type. */
export type PaletteFilter = (value: string, search: string, keywords?: string[]) => number

export type PaletteActionDeps = {
  navigate: (updates: Record<string, string | number | null>, options?: { push?: boolean }) => void
  setTheme: (theme: Theme) => void
  openUrl: (url: string) => void
}

const TABS = [
  { tab: 'profiler', label: 'Profiler' },
  { tab: 'data-flow', label: 'Data samples' },
  { tab: 'query', label: 'Query' },
] as const

type TabDefinition = (typeof TABS)[number]

const THEME_COMMANDS: { theme: Theme; title: string }[] = [
  { theme: 'dark', title: 'Theme: Dark' },
  { theme: 'light', title: 'Theme: Light' },
  { theme: 'system', title: 'Theme: System' },
]

/**
 * Builds the palette contents as data. Group order is the empty-query display
 * order; once the user types, cmdk re-ranks by match score, with pipe entries
 * boosted above everything else (see docs/adr/0001-command-palette-registry.md).
 */
export function buildPaletteGroups(fleet: FleetServer[] | undefined, context: PaletteContext): PaletteGroup[] {
  const groups: PaletteGroup[] = [pipesGroup(fleet ?? [], context.hasQuery), navigationGroup()]

  if (context.pipeOpen) groups.push(tabGroup(context.currentTab))
  groups.push(themeGroup())

  return groups.filter((group) => group.entries.length > 0)
}

/**
 * Wraps cmdk's filter so priority entries outrank every other match: the base
 * score never exceeds 1, so +1 on a match is a strict win. Entries the base
 * filter rejected (score 0) stay hidden regardless of priority.
 */
export function createPaletteFilter(priorityValues: ReadonlySet<string>, baseFilter: PaletteFilter): PaletteFilter {
  return (value, search, keywords) => {
    const score = baseFilter(value, search, keywords)

    return score > 0 && priorityValues.has(value) ? score + 1 : score
  }
}

export function executePaletteAction(action: PaletteAction, deps: PaletteActionDeps): void {
  switch (action.type) {
    case 'navigate':
      deps.navigate(action.params, { push: action.push })

      return
    case 'open-url':
      deps.openUrl(action.url)

      return
    case 'set-theme':
      deps.setTheme(action.theme)

      return
  }
}

function navigationGroup(): PaletteGroup {
  return {
    heading: 'Navigation',
    entries: [
      {
        id: 'nav:all-pipes',
        title: 'All pipes',
        keywords: ['overview', 'home', 'fleet'],
        action: { type: 'navigate', params: { server: null, pipe: null, tab: null }, push: true },
      },
      {
        id: 'nav:docs',
        title: 'Open documentation',
        keywords: ['docs', 'help'],
        action: { type: 'open-url', url: `${DOCS_URL}/en/sdk/pipes-sdk/quickstart` },
      },
    ],
  }
}

function tabGroup(currentTab: string): PaletteGroup {
  return {
    heading: 'Pipe tabs',
    entries: TABS.filter((command) => command.tab !== currentTab).map((command) => ({
      id: `tab:${command.tab}`,
      title: `Go to ${command.label}`,
      keywords: ['tab', command.tab],
      action: {
        type: 'navigate',
        params: { tab: command.tab === DEFAULT_TAB ? null : command.tab },
        push: false,
      },
    })),
  }
}

function themeGroup(): PaletteGroup {
  return {
    heading: 'Theme',
    entries: THEME_COMMANDS.map((command) => ({
      id: `theme:${command.theme}`,
      title: command.title,
      keywords: ['theme', 'appearance', command.theme],
      action: { type: 'set-theme', theme: command.theme },
    })),
  }
}

function pipesGroup(fleet: FleetServer[], hasQuery: boolean): PaletteGroup {
  // Per-tab shortcuts only exist while the user types — on an empty query they
  // would triple the list without adding anything the pipe row doesn't offer.
  const entries = fleet.flatMap((server) =>
    server.online
      ? server.pipes.flatMap((pipe) => [
          pipeEntry(server, pipe),
          ...(hasQuery ? TABS.map((tab) => pipeTabEntry(server, pipe, tab)) : []),
        ])
      : [offlineEntry(server)],
  )

  return { heading: 'Pipes', entries }
}

function serverLabel(server: FleetServer) {
  return server.name || server.url
}

function serverParam(server: FleetServer) {
  return server.serverIndex === 0 ? null : server.serverIndex
}

function pipeEntry(server: FleetServer, pipe: Pipe): PaletteEntry {
  const dataset = datasetLabel(pipe)

  return {
    id: `${pipe.id} · ${serverLabel(server)} · ${server.serverIndex}`,
    title: pipe.id,
    keywords: dataset ? [dataset] : [],
    subtitle: pipe.dataset ? `${serverLabel(server)} · ${dataset}` : serverLabel(server),
    logoUrl: pipe.dataset?.metadata?.logo_url,
    status: pipe.status,
    progressPercent: pipe.progress.percent,
    priority: true,
    action: {
      type: 'navigate',
      params: { server: serverParam(server), pipe: pipe.id, tab: null },
      push: true,
    },
  }
}

function pipeTabEntry(server: FleetServer, pipe: Pipe, tab: TabDefinition): PaletteEntry {
  return {
    // Leads with "<pipe> <label>" so searches like "usdc query" score with
    // adjacency bonuses; the tab: suffix keeps the id unique per tab.
    id: `${pipe.id} ${tab.label} · ${serverLabel(server)} · ${server.serverIndex} · tab:${tab.tab}`,
    title: `${pipe.id} — ${tab.label}`,
    keywords: ['tab', tab.tab],
    subtitle: serverLabel(server),
    logoUrl: pipe.dataset?.metadata?.logo_url,
    priority: true,
    action: {
      type: 'navigate',
      params: { server: serverParam(server), pipe: pipe.id, tab: tab.tab === DEFAULT_TAB ? null : tab.tab },
      push: true,
    },
  }
}

function offlineEntry(server: FleetServer): PaletteEntry {
  return {
    id: `offline · ${serverLabel(server)} · ${server.serverIndex}`,
    title: serverLabel(server),
    keywords: ['offline', 'server'],
    subtitle: 'Offline',
    disabled: true,
  }
}
