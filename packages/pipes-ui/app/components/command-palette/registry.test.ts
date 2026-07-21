import { defaultFilter } from 'cmdk'
import { describe, expect, it, vi } from 'vitest'

import type { FleetServer, Pipe } from '~/hooks/use-metrics'
import { PipeStatus } from '~/hooks/use-metrics'

import { DOCS_URL, buildPaletteGroups, createPaletteFilter, executePaletteAction } from './registry'

function makePipe(id: string, overrides: Partial<Pipe> = {}): Pipe {
  return {
    id,
    dataset: null,
    portal: { url: 'https://portal.sqd.dev/datasets/ethereum-mainnet', query: {} },
    progress: { from: 0, current: 50, to: 100, percent: 50, etaSeconds: 60 },
    speed: { blocksPerSecond: 10, bytesPerSecond: 1024 },
    status: PipeStatus.Syncing,
    history: [],
    ...overrides,
  }
}

function makeServer(serverIndex: number, overrides: Partial<FleetServer> = {}): FleetServer {
  return {
    serverIndex,
    url: `http://localhost:909${serverIndex}`,
    online: true,
    memory: 0,
    pipes: [],
    ...overrides,
  }
}

const CONTEXT = { pipeOpen: false, currentTab: 'profiler', hasQuery: false }
const QUERY_CONTEXT = { ...CONTEXT, hasQuery: true }

describe('buildPaletteGroups', () => {
  it('orders groups as Pipes, Navigation, Theme when no pipe is open', () => {
    const groups = buildPaletteGroups([makeServer(0, { pipes: [makePipe('a')] })], CONTEXT)

    expect(groups.map((g) => g.heading)).toEqual(['Pipes', 'Navigation', 'Theme'])
  })

  it('keeps Pipes first while a pipe is open', () => {
    const groups = buildPaletteGroups([makeServer(0, { pipes: [makePipe('a')] })], { ...CONTEXT, pipeOpen: true })

    expect(groups.map((g) => g.heading)).toEqual(['Pipes', 'Navigation', 'Pipe tabs', 'Theme'])
  })

  it('offers tab commands only while a pipe is open, excluding the current tab', () => {
    const closed = buildPaletteGroups([], CONTEXT)
    expect(closed.find((g) => g.heading === 'Pipe tabs')).toBeUndefined()

    const open = buildPaletteGroups([], { ...CONTEXT, pipeOpen: true })
    const tabs = open.find((g) => g.heading === 'Pipe tabs')

    expect(tabs?.entries.map((e) => e.title)).toEqual(['Go to Data samples', 'Go to Query'])
  })

  it('keeps the contextual tab commands while the user is typing', () => {
    const groups = buildPaletteGroups([], { ...QUERY_CONTEXT, pipeOpen: true })
    const tabs = groups.find((g) => g.heading === 'Pipe tabs')

    expect(tabs?.entries.map((e) => e.title)).toEqual(['Go to Data samples', 'Go to Query'])
  })

  it('clears the tab param when jumping to the default tab, keeps it otherwise', () => {
    const groups = buildPaletteGroups([], { ...CONTEXT, pipeOpen: true, currentTab: 'query' })
    const tabs = groups.find((g) => g.heading === 'Pipe tabs')

    expect(tabs?.entries.find((e) => e.id === 'tab:profiler')?.action).toEqual({
      type: 'navigate',
      params: { tab: null },
      push: false,
    })
    expect(tabs?.entries.find((e) => e.id === 'tab:data-flow')?.action).toEqual({
      type: 'navigate',
      params: { tab: 'data-flow' },
      push: false,
    })
  })

  it('links "All pipes" to a full reset and documentation to the docs site', () => {
    const nav = buildPaletteGroups([], CONTEXT).find((g) => g.heading === 'Navigation')

    expect(nav?.entries.find((e) => e.id === 'nav:all-pipes')?.action).toEqual({
      type: 'navigate',
      params: { server: null, pipe: null, tab: null },
      push: true,
    })
    expect(nav?.entries.find((e) => e.id === 'nav:docs')?.action).toEqual({
      type: 'open-url',
      url: `${DOCS_URL}/en/sdk/pipes-sdk/quickstart`,
    })
  })

  it('maps theme commands to set-theme actions', () => {
    const theme = buildPaletteGroups([], CONTEXT).find((g) => g.heading === 'Theme')

    expect(theme?.entries.map((e) => e.action)).toEqual([
      { type: 'set-theme', theme: 'dark' },
      { type: 'set-theme', theme: 'light' },
      { type: 'set-theme', theme: 'system' },
    ])
  })

  it('creates pipe entries that navigate to the owning server on its default tab', () => {
    const groups = buildPaletteGroups([makeServer(1, { name: 'staging', pipes: [makePipe('usdc')] })], CONTEXT)
    const entry = groups.find((g) => g.heading === 'Pipes')?.entries[0]

    expect(entry?.action).toEqual({ type: 'navigate', params: { server: 1, pipe: 'usdc', tab: null }, push: true })
    expect(entry?.subtitle).toBe('staging')
    expect(entry?.status).toBe(PipeStatus.Syncing)
    expect(entry?.progressPercent).toBe(50)
  })

  it('omits the server param for the default server so URLs stay clean', () => {
    const groups = buildPaletteGroups([makeServer(0, { pipes: [makePipe('usdc')] })], CONTEXT)
    const entry = groups.find((g) => g.heading === 'Pipes')?.entries[0]

    expect(entry?.action).toEqual({ type: 'navigate', params: { server: null, pipe: 'usdc', tab: null }, push: true })
  })

  it('adds per-pipe tab shortcuts only while the user is typing', () => {
    const fleet = [makeServer(0, { pipes: [makePipe('usdc')] })]

    const idle = buildPaletteGroups(fleet, CONTEXT).find((g) => g.heading === 'Pipes')
    expect(idle?.entries.map((e) => e.title)).toEqual(['usdc'])

    const typing = buildPaletteGroups(fleet, QUERY_CONTEXT).find((g) => g.heading === 'Pipes')
    expect(typing?.entries.map((e) => e.title)).toEqual([
      'usdc',
      'usdc — Profiler',
      'usdc — Data samples',
      'usdc — Query',
    ])
  })

  it('navigates per-pipe tab shortcuts to the owning server and tab', () => {
    const fleet = [makeServer(1, { name: 'staging', pipes: [makePipe('usdc')] })]
    const entries = buildPaletteGroups(fleet, QUERY_CONTEXT).find((g) => g.heading === 'Pipes')?.entries ?? []

    expect(entries.find((e) => e.title === 'usdc — Profiler')?.action).toEqual({
      type: 'navigate',
      params: { server: 1, pipe: 'usdc', tab: null },
      push: true,
    })
    expect(entries.find((e) => e.title === 'usdc — Data samples')?.action).toEqual({
      type: 'navigate',
      params: { server: 1, pipe: 'usdc', tab: 'data-flow' },
      push: true,
    })
    expect(entries.find((e) => e.title === 'usdc — Query')?.action).toEqual({
      type: 'navigate',
      params: { server: 1, pipe: 'usdc', tab: 'query' },
      push: true,
    })
  })

  it('marks pipe entries and tab shortcuts as priority, but nothing else', () => {
    const fleet = [makeServer(0, { pipes: [makePipe('usdc')] }), makeServer(1, { online: false, name: 'prod' })]
    const groups = buildPaletteGroups(fleet, QUERY_CONTEXT)
    const pipes = groups.find((g) => g.heading === 'Pipes')?.entries ?? []

    const offline = pipes.find((e) => e.subtitle === 'Offline')
    expect(offline?.priority).toBeUndefined()

    const selectable = pipes.filter((e) => e !== offline)
    expect(selectable.length).toBe(4)
    expect(selectable.every((e) => e.priority)).toBe(true)

    const others = groups.filter((g) => g.heading !== 'Pipes').flatMap((g) => g.entries)
    expect(others.every((e) => !e.priority)).toBe(true)
  })

  it('keeps entry ids unique when the same pipe id exists on two servers', () => {
    const fleet = [
      makeServer(0, { pipes: [makePipe('usdc')] }),
      makeServer(1, { name: 'staging', pipes: [makePipe('usdc')] }),
    ]
    const entries = buildPaletteGroups(fleet, QUERY_CONTEXT).find((g) => g.heading === 'Pipes')?.entries ?? []

    expect(entries).toHaveLength(8)
    expect(new Set(entries.map((e) => e.id)).size).toBe(8)
  })

  it('renders offline servers as disabled hint rows without an action', () => {
    const groups = buildPaletteGroups([makeServer(2, { online: false, name: 'prod' })], CONTEXT)
    const entry = groups.find((g) => g.heading === 'Pipes')?.entries[0]

    expect(entry).toMatchObject({ title: 'prod', subtitle: 'Offline', disabled: true })
    expect(entry?.action).toBeUndefined()
  })

  it('makes pipes searchable by server name and dataset', () => {
    const pipe = makePipe('transfers', {
      dataset: {
        dataset: 'base-mainnet',
        aliases: [],
        real_time: true,
        start_block: 0,
        metadata: { kind: 'evm', display_name: 'Base' },
      },
    })
    const groups = buildPaletteGroups([makeServer(1, { name: 'staging', pipes: [pipe] })], CONTEXT)
    const entry = groups.find((g) => g.heading === 'Pipes')?.entries[0]

    expect(entry?.id).toContain('staging')
    expect(entry?.keywords).toContain('Base')
  })

  it('drops empty groups so the palette never shows a bare heading', () => {
    const groups = buildPaletteGroups([], CONTEXT)

    expect(groups.map((g) => g.heading)).toEqual(['Navigation', 'Theme'])
  })

  it('treats an undefined fleet like an empty one', () => {
    const groups = buildPaletteGroups(undefined, CONTEXT)

    expect(groups.map((g) => g.heading)).toEqual(['Navigation', 'Theme'])
  })

  it('keeps the URL-derived dataset label as a search keyword but out of the subtitle', () => {
    const groups = buildPaletteGroups([makeServer(1, { name: 'staging', pipes: [makePipe('usdc')] })], CONTEXT)
    const entry = groups.find((g) => g.heading === 'Pipes')?.entries[0]

    expect(entry?.keywords).toContain('ethereum-mainnet')
    expect(entry?.subtitle).toBe('staging')
  })
})

describe('createPaletteFilter', () => {
  it('returns the base score untouched for non-priority entries', () => {
    const filter = createPaletteFilter(new Set(['boosted']), () => 0.5)

    expect(filter('plain', 'q')).toBe(0.5)
  })

  it('boosts matching priority entries by a full point', () => {
    const filter = createPaletteFilter(new Set(['boosted']), () => 0.5)

    expect(filter('boosted', 'q')).toBe(1.5)
  })

  it('never resurrects priority entries the base filter rejected', () => {
    const filter = createPaletteFilter(new Set(['boosted']), () => 0)

    expect(filter('boosted', 'q')).toBe(0)
  })

  it('ranks a weak pipe match above an exact command match with the real cmdk filter', () => {
    const pipeValue = 'usdc · staging · 1'
    const filter = createPaletteFilter(new Set([pipeValue]), defaultFilter)

    const pipeScore = filter(pipeValue, 'us', ['usdc'])
    const commandScore = filter('theme:dark', 'Theme: Dark', ['Theme: Dark', 'theme', 'appearance', 'dark'])

    expect(commandScore).toBeGreaterThan(0)
    expect(pipeScore).toBeGreaterThan(commandScore)
  })
})

describe('executePaletteAction', () => {
  const makeDeps = () => ({ navigate: vi.fn(), setTheme: vi.fn(), openUrl: vi.fn() })

  it('dispatches navigate actions with their push semantics', () => {
    const deps = makeDeps()
    executePaletteAction({ type: 'navigate', params: { pipe: 'usdc', server: null }, push: true }, deps)

    expect(deps.navigate).toHaveBeenCalledWith({ pipe: 'usdc', server: null }, { push: true })
  })

  it('dispatches set-theme actions', () => {
    const deps = makeDeps()
    executePaletteAction({ type: 'set-theme', theme: 'light' }, deps)

    expect(deps.setTheme).toHaveBeenCalledWith('light')
  })

  it('dispatches open-url actions', () => {
    const deps = makeDeps()
    executePaletteAction({ type: 'open-url', url: DOCS_URL }, deps)

    expect(deps.openUrl).toHaveBeenCalledWith(DOCS_URL)
  })
})
