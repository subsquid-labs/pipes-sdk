'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Maximize2, Minimize2 } from 'lucide-react'

import { Code } from '~/components/ui/code'
import { Toggle } from '~/components/ui/toggle'
import { PanelLoading } from '~/dashboard/panel-loading'
import { type ApiExemplarResult, useTransformationExemplar } from '~/hooks/use-metrics'
import { useServerIndex } from '~/hooks/use-server-context'

type TransformerExample = {
  name: string
  data: any
  children: TransformerExample[]
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

type BatchInfo = { from: number; to: number; blocksCount: number }

type Snapshot = {
  transformation: ApiExemplarResult
  batch?: BatchInfo
}

const MAX_SNAPSHOTS = 20

function useExemplarHistory(current: ApiExemplarResult | undefined, batch: BatchInfo | undefined) {
  const historyRef = useRef<Snapshot[]>([])
  const prevDataRef = useRef<string | undefined>(undefined)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  // Force re-render when history changes
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!current) return

    const serialized = JSON.stringify(current)
    if (serialized === prevDataRef.current) return
    prevDataRef.current = serialized

    const newSnapshot: Snapshot = { transformation: current, batch }
    const history = historyRef.current

    // If viewing a pinned snapshot, keep it during eviction
    if (selectedIndex !== null && history.length >= MAX_SNAPSHOTS) {
      const pinned = history[selectedIndex]
      const rest = history.filter((_, i) => i !== selectedIndex)
      const trimmed = rest.slice(-(MAX_SNAPSHOTS - 2))
      // Find where the pinned entry sits in the new array
      const newHistory = [...trimmed, newSnapshot]
      // Insert pinned at its original relative position (before newer items)
      const pinnedNewIndex = Math.min(selectedIndex, newHistory.length - 1)
      newHistory.splice(pinnedNewIndex, 0, pinned)
      historyRef.current = newHistory.slice(-MAX_SNAPSHOTS)
      setSelectedIndex(pinnedNewIndex)
    } else {
      historyRef.current = [...history.slice(-(MAX_SNAPSHOTS - 1)), newSnapshot]
      // Adjust selectedIndex if items were evicted from the front
      if (selectedIndex !== null && history.length >= MAX_SNAPSHOTS) {
        const evicted = history.length + 1 - MAX_SNAPSHOTS
        setSelectedIndex(Math.max(0, selectedIndex - evicted))
      }
    }

    setTick((t) => t + 1)
  }, [current, batch])

  const history = historyRef.current
  const isLatest = selectedIndex === null
  const activeIndex = selectedIndex ?? history.length - 1
  const activeSnapshot = history[activeIndex]
  const active = activeSnapshot?.transformation ?? current
  const activeBatch = activeSnapshot?.batch ?? batch

  const goLatest = () => setSelectedIndex(null)
  const goPrev = () => {
    if (activeIndex > 0) {
      setSelectedIndex(activeIndex - 1)
    }
  }
  const goNext = () => {
    if (activeIndex < history.length - 1) {
      const next = activeIndex + 1
      setSelectedIndex(next === history.length - 1 ? null : next)
    }
  }
  const freeze = () => {
    if (selectedIndex === null) {
      setSelectedIndex(history.length - 1)
    }
  }
  const toggleFreeze = () => {
    if (selectedIndex === null) {
      setSelectedIndex(history.length - 1)
    } else {
      setSelectedIndex(null)
    }
  }

  return {
    active,
    activeBatch,
    isLatest,
    activeIndex,
    total: history.length,
    hasPrev: activeIndex > 0,
    hasNext: activeIndex < history.length - 1,
    goLatest,
    goPrev,
    goNext,
    freeze,
    toggleFreeze,
  }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function TransformerExampleNode({
  transformer,
  expandAll,
  onFreeze,
}: {
  transformer: TransformerExample
  expandAll: boolean
  onFreeze?: () => void
}) {
  const opacity = transformer.data ? 1 : 0.5
  const [open, setOpen] = useState(false)
  const isOpen = open || expandAll

  const data = useMemo(() => {
    if (!transformer.data) return ''

    const json = JSON.parse(transformer.data)
    const res = JSON.stringify(json, null, isOpen ? 2 : 0)

    return isOpen
      ? res.replace(/"\.\.\.\s+(\d+)\s+more\s+\.\.\."/gm, '// ... truncated $1 items ...')
      : res.length > 79
        ? res.substring(0, 79) + '...'
        : res
  }, [transformer.data, isOpen])

  return (
    <div className="tree tree-sm">
      <div
        className={data ? 'cursor-pointer' : undefined}
        onClick={() => {
          setOpen(!isOpen)
          onFreeze?.()
        }}
      >
        <div className="pt-3 pl-1 text-xs" style={{ opacity }}>
          {transformer.name}
        </div>
        <div className="text-xxs text-nowrap">
          {data ? (
            <Code language="json" hideCopyButton={!isOpen} className="bg-secondary/30 rounded-md p-1 text-xxs">
              {data}
            </Code>
          ) : null}
        </div>
      </div>
      <div className="pl-3">
        {transformer.children.map((child) => (
          <TransformerExampleNode key={child.name} transformer={child} expandAll={expandAll} onFreeze={onFreeze} />
        ))}
      </div>
    </div>
  )
}

export function TransformationExemplar({ pipeId }: { pipeId: string }) {
  const { serverIndex } = useServerIndex()
  const [fullscreen, setFullscreen] = useState(false)
  const [expandAll, setExpandAll] = useState(false)
  const { data, isLoading } = useTransformationExemplar({ serverIndex, pipeId })

  const {
    active,
    activeBatch,
    isLatest,
    activeIndex,
    total,
    hasPrev,
    hasNext,
    goPrev,
    goNext,
    goLatest,
    freeze,
    toggleFreeze,
  } = useExemplarHistory(data?.transformation, data?.batch)

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 bg-background p-6 overflow-auto' : 'relative space-y-1'}>
      <div
        className={`absolute left-1 right-1 top-1 z-10 bg-background rounded-md flex items-center justify-between px-1 ${fullscreen ? 'fixed left-7 right-7 top-7' : ''}`}
      >
        {activeBatch && (
          <span
            className={`text-xxs leading-none tabular-nums px-1 cursor-pointer select-none ${isLatest ? 'text-muted-foreground' : 'text-yellow-400'}`}
            title={isLatest ? 'Click to freeze snapshot' : 'Click to resume auto-play'}
            onClick={toggleFreeze}
          >
            Blocks {activeBatch.from.toLocaleString()} – {activeBatch.to.toLocaleString()}
          </span>
        )}
        <div className="rounded-md flex items-center">
          <span className="inline-flex items-center gap-0.5">
            <Toggle size="sm" title="Previous snapshot" onClick={goPrev} pressed={false} disabled={!hasPrev}>
              <ChevronLeft />
            </Toggle>
            <span
              className={`text-xxs tabular-nums select-none cursor-pointer px-1 ${isLatest ? 'text-muted-foreground' : 'text-yellow-400'}`}
              title={isLatest ? 'Viewing latest' : 'Click to jump to latest'}
              onClick={goLatest}
            >
              {activeIndex + 1}/{total}
            </span>
            <Toggle size="sm" title="Next snapshot" onClick={goNext} pressed={false} disabled={!hasNext}>
              <ChevronRight />
            </Toggle>
          </span>
          <Toggle
            size="sm"
            title={expandAll ? 'Collapse all' : 'Expand all'}
            onClick={() => setExpandAll(!expandAll)}
            pressed={expandAll}
          >
            {expandAll ? <ChevronsDownUp /> : <ChevronsUpDown />}
          </Toggle>
          <Toggle
            size="sm"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            pressed={fullscreen}
            onClick={() => setFullscreen(!fullscreen)}
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </Toggle>
        </div>
      </div>
      {isLoading || !active ? (
        <PanelLoading message="Waiting for data samples..." />
      ) : active ? (
        <div
          className={`overflow-auto border rounded-md px-1 pb-1 pt-9 dotted-background ${fullscreen ? 'h-full' : 'h-[400px]'}`}
        >
          <TransformerExampleNode transformer={active} expandAll={expandAll} onFreeze={freeze} />
        </div>
      ) : (
        <div>No data</div>
      )}
    </div>
  )
}
