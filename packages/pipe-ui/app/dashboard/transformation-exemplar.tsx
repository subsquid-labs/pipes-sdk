'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Maximize2, Minimize2 } from 'lucide-react'

import { Code } from '~/components/ui/code'
import { Toggle } from '~/components/ui/toggle'
import { PanelLoading } from '~/dashboard/panel-loading'
import { type ApiExemplarResult, useTransformationExemplar } from '~/hooks/use-metrics'
import { useServerIndex } from '~/hooks/use-server-context'
import { useUrlParam } from '~/hooks/use-url-param'

type TransformerExample = {
  name: string
  data: any
  elapsed?: number
  dataSize?: number
  labels?: string[]
  children: TransformerExample[]
}

// ---------------------------------------------------------------------------
// Data shape analysis
// ---------------------------------------------------------------------------

type DataShape = {
  type: 'array' | 'object' | 'primitive' | 'null'
  count?: number
  fields?: string[]
  itemCounts?: Record<string, number>
}

function analyzeShape(jsonStr: string | null): DataShape | null {
  if (!jsonStr) return null
  try {
    const parsed = JSON.parse(jsonStr)
    if (parsed === null) return { type: 'null' }
    if (Array.isArray(parsed)) {
      const count = inferArrayLength(parsed)
      let fields: string[] | undefined
      let itemCounts: Record<string, number> | undefined
      if (parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
        const first = parsed[0]
        fields = Object.keys(first)
        const counts: Record<string, number> = {}
        for (const key of fields) {
          if (Array.isArray(first[key])) {
            counts[key] = inferArrayLength(first[key])
          }
        }
        if (Object.keys(counts).length > 0) itemCounts = counts
      }
      return { type: 'array', count, fields, itemCounts }
    }
    if (typeof parsed === 'object') {
      const fields = Object.keys(parsed)
      const itemCounts: Record<string, number> = {}
      for (const key of fields) {
        const val = parsed[key]
        if (Array.isArray(val)) {
          itemCounts[key] = inferArrayLength(val)
        }
      }
      return {
        type: 'object',
        fields,
        itemCounts: Object.keys(itemCounts).length > 0 ? itemCounts : undefined,
      }
    }
    return { type: 'primitive' }
  } catch {
    return null
  }
}

function inferArrayLength(arr: any[]): number {
  if (arr.length === 0) return 0
  const last = arr[arr.length - 1]
  if (typeof last === 'string') {
    const match = last.match(/\.\.\.\s*(\d+)\s*more\s*\.\.\./)
    if (match) return arr.length - 1 + Number(match[1])
  }
  return arr.length
}

type ChangeType = 'passthrough' | 'transform' | 'reshape' | 'expand' | 'filter'

function detectChange(parentShape: DataShape | null, childShape: DataShape | null): ChangeType | null {
  if (!parentShape || !childShape) return null
  if (parentShape.type !== childShape.type) return 'reshape'

  if (parentShape.type === 'array' && childShape.type === 'array') {
    if (parentShape.count === childShape.count) {
      const parentFields = parentShape.fields?.join(',')
      const childFields = childShape.fields?.join(',')
      if (parentFields === childFields) return 'passthrough'
      return 'transform'
    }
    if (childShape.count != null && parentShape.count != null) {
      return childShape.count > parentShape.count ? 'expand' : 'filter'
    }
  }

  return 'transform'
}

function getNewFields(parentShape: DataShape | null, childShape: DataShape | null): string[] {
  if (!parentShape?.fields || !childShape?.fields) return []
  const parentSet = new Set(parentShape.fields)
  return childShape.fields.filter((f) => !parentSet.has(f))
}

/** Find shape of first descendant with data */
function findFirstChildShape(node: TransformerExample): DataShape | null {
  for (const child of node.children) {
    const s = analyzeShape(child.data)
    if (s) return s
    const deep = findFirstChildShape(child)
    if (deep) return deep
  }
  return null
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

type BatchInfo = { from: number; to: number; blocksCount: number; bytesSize?: number }

type Snapshot = {
  transformation: ApiExemplarResult
  batch?: BatchInfo
}

const MAX_SNAPSHOTS = 20

function useExemplarHistory(current: ApiExemplarResult | undefined, batch: BatchInfo | undefined) {
  const historyRef = useRef<Snapshot[]>([])
  const prevDataRef = useRef<string | undefined>(undefined)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!current) return

    const serialized = JSON.stringify(current)
    if (serialized === prevDataRef.current) return
    prevDataRef.current = serialized

    const newSnapshot: Snapshot = { transformation: current, batch }
    const history = historyRef.current

    if (selectedIndex !== null && history.length >= MAX_SNAPSHOTS) {
      const pinned = history[selectedIndex]
      const rest = history.filter((_, i) => i !== selectedIndex)
      const trimmed = rest.slice(-(MAX_SNAPSHOTS - 2))
      const newHistory = [...trimmed, newSnapshot]
      const pinnedNewIndex = Math.min(selectedIndex, newHistory.length - 1)
      newHistory.splice(pinnedNewIndex, 0, pinned)
      historyRef.current = newHistory.slice(-MAX_SNAPSHOTS)
      setSelectedIndex(pinnedNewIndex)
    } else {
      historyRef.current = [...history.slice(-(MAX_SNAPSHOTS - 1)), newSnapshot]
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
    if (activeIndex > 0) setSelectedIndex(activeIndex - 1)
  }
  const goNext = () => {
    if (activeIndex < history.length - 1) {
      const next = activeIndex + 1
      setSelectedIndex(next === history.length - 1 ? null : next)
    }
  }
  const toggleFreeze = () => {
    if (selectedIndex === null) {
      setSelectedIndex(history.length - 1)
    } else {
      setSelectedIndex(null)
    }
  }
  const freeze = () => {
    if (selectedIndex === null) setSelectedIndex(history.length - 1)
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
// Flow components
// ---------------------------------------------------------------------------

const changeTagStyles: Record<ChangeType, string> = {
  passthrough: 'text-[#555] bg-white/[0.03] border border-white/[0.06]',
  transform: 'text-[#d0a9e2] bg-[#b53cdd]/10 border border-[#b53cdd]/20',
  reshape: 'text-[#e8a53c] bg-[#e8a53c]/10 border border-[#e8a53c]/20',
  filter: 'text-[#5cb8ff] bg-[#5cb8ff]/10 border border-[#5cb8ff]/20',
  expand: 'text-[#5ce88c] bg-[#5ce88c]/10 border border-[#5ce88c]/20',
}

function ChangeIndicator({
  changeType,
  parentShape,
  childShape,
}: {
  changeType: ChangeType | null
  parentShape: DataShape | null
  childShape: DataShape | null
}) {
  const sizeLabel = useMemo(() => {
    if (!parentShape || !childShape) return null

    if (parentShape.type === 'array' && childShape.type === 'array') {
      if (parentShape.count != null && childShape.count != null) {
        return `${parentShape.count} → ${childShape.count}`
      }
    }

    if (parentShape.type !== childShape.type) {
      const from =
        parentShape.type === 'array' && parentShape.count != null
          ? `Array[${parentShape.count}]`
          : parentShape.type.charAt(0).toUpperCase() + parentShape.type.slice(1)
      const to =
        childShape.type === 'object' && childShape.fields
          ? `Object { ${childShape.fields.length} keys }`
          : childShape.type.charAt(0).toUpperCase() + childShape.type.slice(1)
      return `${from} → ${to}`
    }

    return null
  }, [parentShape, childShape])

  return (
    <div className="flex items-center gap-1.5 px-[44px] pt-1 pb-2">
      <span className="text-white/20 text-[14px] leading-none">↓</span>
      {changeType && (
        <span className={`text-[9px] px-1.5 py-[1px] rounded-[3px] font-light ${changeTagStyles[changeType]}`}>
          {changeType}
        </span>
      )}
      {sizeLabel && (
        <span className={`text-[9px] ${changeType === 'reshape' ? 'text-[#e8a53c]/70' : 'text-white/30'}`}>
          {sizeLabel}
        </span>
      )}
    </div>
  )
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ShapeBadge({
  shape,
  dataSize,
  unchanged,
  isReshape,
}: {
  shape: DataShape | null
  dataSize?: number
  unchanged?: boolean
  isReshape?: boolean
}) {
  if (!shape) return null

  const typeStyle = isReshape
    ? 'bg-[#e8a53c]/10 text-[#e8a53c] border-[#e8a53c]/20'
    : 'bg-[#b53cdd]/10 text-[#b53cdd] border-[#b53cdd]/15'

  return (
    <div className="flex items-center gap-1.5 mt-1 text-[10px]">
      <span className={`font-light px-1.5 py-[1px] rounded-[3px] border text-[10px] ${typeStyle}`}>
        {shape.type === 'array' ? 'Array' : shape.type === 'object' ? 'Object' : shape.type}
      </span>
      {shape.type === 'array' && shape.count != null && (
        <span className="text-[#d0a9e2] font-light">{shape.count} items</span>
      )}
      {shape.type === 'object' && shape.itemCounts && (
        <span className="text-white/40 font-extralight">{Object.entries(shape.itemCounts).length} collections</span>
      )}
      {unchanged && <span className="text-white/30 font-extralight">· unchanged</span>}
      {!unchanged && dataSize != null && dataSize > 0 && (
        <span className="text-white/30 font-extralight">· {humanSize(dataSize)}</span>
      )}
    </div>
  )
}

function FieldPills({ shape, newFields }: { shape: DataShape | null; newFields: string[] }) {
  const fields = shape?.fields?.map((f) => ({
    name: f,
    count: shape.itemCounts?.[f],
  }))

  if (!fields || fields.length === 0) return null

  const newSet = new Set(newFields)

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {fields.map(({ name, count }) => (
        <span
          key={name}
          className={`text-[9px] px-1.5 py-[1px] rounded-[3px] font-extralight border ${
            newSet.has(name)
              ? 'bg-[#5ce88c]/[0.08] text-[#5ce88c] border-[#5ce88c]/15'
              : 'bg-white/[0.04] text-white/40 border-white/[0.05]'
          }`}
        >
          {newSet.has(name) ? '+ ' : ''}
          {name}
          {count != null ? ` · ${count}` : ''}
        </span>
      ))}
    </div>
  )
}

type StageVariant = 'root' | 'core' | 'reshape' | 'empty' | 'default'

function getStageVariant(opts: {
  isRoot: boolean
  isCore: boolean
  isReshape: boolean
  isEmpty: boolean
}): StageVariant {
  if (opts.isRoot) return 'root'
  if (opts.isCore) return 'core'
  if (opts.isReshape) return 'reshape'
  if (opts.isEmpty) return 'empty'
  return 'default'
}

const stageStyles: Record<
  StageVariant,
  {
    dot: { borderColor: string; background: string }
    card: { border: string; background: string; padding: string }
  }
> = {
  root: {
    dot: { borderColor: 'rgba(181,60,221,0.5)', background: 'rgba(181,60,221,0.15)' },
    card: { border: '1px solid rgba(181,60,221,0.2)', background: 'rgba(255,255,255,0.02)', padding: '10px 14px' },
  },
  core: {
    dot: { borderColor: 'rgba(92,184,255,0.5)', background: '#030712' },
    card: { border: '1px solid rgba(92,184,255,0.1)', background: 'transparent', padding: '4px 14px' },
  },
  reshape: {
    dot: { borderColor: 'rgba(232,165,60,0.5)', background: 'rgba(232,165,60,0.1)' },
    card: { border: '1px solid rgba(232,165,60,0.15)', background: 'rgba(255,255,255,0.02)', padding: '10px 14px' },
  },
  empty: {
    dot: { borderColor: 'rgba(255,255,255,0.1)', background: '#030712' },
    card: { border: '1px solid rgba(255,255,255,0.04)', background: 'rgba(255,255,255,0.02)', padding: '6px 14px' },
  },
  default: {
    dot: { borderColor: 'rgba(208,169,226,0.4)', background: '#030712' },
    card: { border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: '10px 14px' },
  },
}

function formatJson(data: string | null, expanded: boolean): string {
  if (!data) return ''
  try {
    const json = JSON.parse(data)
    const res = JSON.stringify(json, null, expanded ? 2 : 0)
    return expanded
      ? res.replace(/"\.\.\.\s+(\d+)\s+more\s+\.\.\."/gm, '// ... truncated $1 items ...')
      : res.length > 79
        ? res.substring(0, 79) + '...'
        : res
  } catch {
    return data
  }
}

function DiffView({
  parentName,
  parentData,
  childName,
  childData,
}: {
  parentName: string
  parentData: string | null
  childName: string
  childData: string | null
}) {
  const inputJson = useMemo(() => formatJson(parentData, true), [parentData])
  const outputJson = useMemo(() => formatJson(childData, true), [childData])

  return (
    <div className="mt-3">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            Input ({parentName})
          </div>
          <div style={{ overflow: 'auto', maxHeight: 500 }}>
            <Code language="json" hideCopyButton className="text-xxs bg-black/30 border-white/[0.04]">
              {inputJson}
            </Code>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', color: '#333', fontSize: 18 }}>→</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            Output ({childName})
          </div>
          <div style={{ overflow: 'auto', maxHeight: 500 }}>
            <Code language="json" hideCopyButton className="text-xxs bg-black/30 border-white/[0.04]">
              {outputJson}
            </Code>
          </div>
        </div>
      </div>
    </div>
  )
}

function FlowStageNode({
  transformer,
  parentShape,
  parentData,
  parentName,
  expandAll,
  isLast,
  isRoot,
  rootElapsed,
  batchInfo,
  onFreeze,
}: {
  transformer: TransformerExample
  parentShape: DataShape | null
  parentData?: string | null
  parentName?: string
  expandAll: boolean
  isLast: boolean
  isRoot?: boolean
  rootElapsed?: number
  batchInfo?: BatchInfo
  onFreeze?: () => void
}) {
  const [open, setOpen] = useState(false)
  const isOpen = open || expandAll

  const shape = useMemo(() => analyzeShape(transformer.data), [transformer.data])
  const changeType = useMemo(() => detectChange(parentShape, shape), [parentShape, shape])
  const newFields = useMemo(() => getNewFields(parentShape, shape), [parentShape, shape])
  const hasData = !!transformer.data
  const isCore = transformer.labels?.includes('core') ?? false
  const isPassthrough = changeType === 'passthrough'
  const isEmpty = !hasData && !isRoot
  const isReshape = changeType === 'reshape'

  // For empty stages, look ahead to first child with data
  const previewShape = useMemo(() => {
    if (hasData) return null
    return findFirstChildShape(transformer)
  }, [hasData, transformer])

  const jsonDisplay = useMemo(() => formatJson(transformer.data, isOpen), [transformer.data, isOpen])

  const variant = getStageVariant({ isRoot: !!isRoot, isCore, isReshape, isEmpty })
  const styles = stageStyles[variant]

  // Effective shape for propagation: own shape, or forwarded parent
  const effectiveShape = shape ?? parentShape
  const effectiveData = transformer.data ?? parentData
  const effectiveName = transformer.data ? transformer.name : parentName

  // Elapsed percentage
  const elapsedPct =
    transformer.elapsed && rootElapsed && rootElapsed > 0
      ? ((transformer.elapsed / rootElapsed) * 100).toFixed(2)
      : null

  return (
    <>
      {/* Change indicator — core stages always show passthrough */}
      {!isRoot && (
        <ChangeIndicator
          changeType={isCore ? 'passthrough' : changeType}
          parentShape={parentShape}
          childShape={shape}
        />
      )}

      {/* Stage row */}
      <div className="flex items-stretch gap-0" style={{ marginBottom: 4 }}>
        {/* Rail */}
        <div style={{ width: 32 }} className="flex flex-col items-center flex-shrink-0">
          <div
            className="rounded-full border-2 z-[2] flex-shrink-0"
            style={{
              width: 10,
              height: 10,
              marginTop: isEmpty ? 10 : 14,
              borderColor: styles.dot.borderColor,
              background: styles.dot.background,
            }}
          />
          {!isLast && <div className="flex-1" style={{ width: 1, background: 'rgba(255,255,255,0.08)' }} />}
        </div>

        {/* Card */}
        <div
          className={`flex-1 min-w-0 transition-all ${hasData ? 'cursor-pointer' : ''}`}
          style={{
            border: styles.card.border,
            borderRadius: 6,
            padding: styles.card.padding,
            background: styles.card.background,
            opacity: !hasData ? 0.75 : 1,
          }}
          onClick={() => {
            if (hasData) {
              setOpen(!isOpen)
              onFreeze?.()
            }
          }}
          onMouseEnter={(e) => {
            if (hasData) {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
            }
          }}
          onMouseLeave={(e) => {
            if (hasData) {
              e.currentTarget.style.borderColor = styles.card.border.replace('1px solid ', '')
              e.currentTarget.style.background = styles.card.background
            }
          }}
        >
          {/* Header: name + batch badge (root) or timing */}
          <div className="flex justify-between items-center">
            <span style={{ fontSize: 12, fontWeight: 300, color: isEmpty ? undefined : '#e0e0e0' }}>
              {transformer.name}
            </span>
            {isRoot && batchInfo ? (
              <span
                style={{
                  fontSize: 10,
                  color: '#666',
                  background: 'rgba(255,255,255,0.04)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                Blocks {batchInfo.from.toLocaleString()} – {batchInfo.to.toLocaleString()}
              </span>
            ) : transformer.elapsed != null && transformer.elapsed > 0 ? (
              <span style={{ fontSize: 10, color: '#555' }}>
                {transformer.elapsed.toFixed(0)}ms{elapsedPct ? ` · ${elapsedPct}%` : ''}
              </span>
            ) : null}
          </div>

          {/* Shape badge + field pills for stages WITH data */}
          {!isEmpty && shape && (
            <>
              <ShapeBadge shape={shape} unchanged={isPassthrough} isReshape={isReshape} />
              <FieldPills shape={shape} newFields={newFields} />
            </>
          )}

          {/* Preview shape for empty stages (from first child with data, or parent) */}
          {isEmpty && (previewShape || parentShape) && (
            <ShapeBadge
              shape={previewShape ?? parentShape}
              unchanged
              dataSize={/fetch/i.test(transformer.name) && batchInfo?.bytesSize ? batchInfo.bytesSize : undefined}
            />
          )}

          {/* Expanded: diff view for reshape, regular JSON for others */}
          {hasData && isOpen && isReshape && parentData && (
            <DiffView
              parentName={parentName || 'previous'}
              parentData={parentData}
              childName={transformer.name}
              childData={transformer.data}
            />
          )}
          {hasData && isOpen && (!isReshape || !parentData) && (
            <div className="mt-2 text-xxs text-nowrap">
              <Code
                language="json"
                hideCopyButton
                className="bg-black/30 rounded-md p-1 text-xxs border border-white/[0.04]"
              >
                {jsonDisplay}
              </Code>
            </div>
          )}
        </div>
      </div>

      {/* Children — chain sibling shapes so each sibling sees the previous one's output */}
      <div style={{ paddingLeft: transformer.children.length > 0 && !isRoot ? 20 : 0 }}>
        {
          transformer.children.reduce<{
            elements: React.ReactNode[]
            prevShape: DataShape | null
            prevData: string | null
            prevName: string | undefined
          }>(
            (acc, child, i) => {
              const sibParentShape = acc.prevShape ?? effectiveShape
              const sibParentData = acc.prevData ?? effectiveData
              const sibParentName = acc.prevName ?? effectiveName

              acc.elements.push(
                <FlowStageNode
                  key={child.name}
                  transformer={child}
                  parentShape={sibParentShape}
                  parentData={sibParentData}
                  parentName={sibParentName}
                  expandAll={expandAll}
                  isLast={isLast && i === transformer.children.length - 1}
                  rootElapsed={rootElapsed}
                  batchInfo={batchInfo}
                  onFreeze={onFreeze}
                />,
              )

              // If this child has data, update for next sibling
              const childShape = analyzeShape(child.data)
              if (childShape) {
                acc.prevShape = childShape
                acc.prevData = child.data
                acc.prevName = child.name
              }

              return acc
            },
            { elements: [], prevShape: null, prevData: null, prevName: undefined },
          ).elements
        }
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TransformationExemplar({ pipeId }: { pipeId: string }) {
  const { serverIndex } = useServerIndex()
  const [expandAll, setExpandAll] = useState(false)
  const { data, isLoading } = useTransformationExemplar({ serverIndex, pipeId })

  const [fullscreen, setFullscreen] = useUrlParam('fullscreen', false)
  const toggleFullscreen = () => setFullscreen(!fullscreen)

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
    <div className={fullscreen ? 'fixed inset-0 z-50 bg-gray-950 p-6 overflow-auto' : 'relative space-y-1'}>
      <div
        className={`absolute left-1 right-1 top-1 z-10 bg-background rounded-md flex items-center justify-between px-1 ${fullscreen ? 'fixed left-7 right-7 top-7' : ''}`}
      >
        <span className="inline-flex items-center gap-0.5">
          <Toggle size="sm" title={isLatest ? 'Pause' : 'Resume'} pressed={!isLatest} onClick={toggleFreeze}>
            {isLatest ? (
              <span className="size-3 rounded-full bg-red-500 animate-pulse ring-1 ring-red-500/50 ring-offset-2 ring-offset-transparent" />
            ) : (
              <span className="size-3 rounded-full bg-white/20 ring-2 ring-white/10" />
            )}
          </Toggle>
          {activeBatch && (
            <span
              className={`text-xxs leading-none tabular-nums cursor-pointer select-none ${isLatest ? 'text-muted-foreground' : 'text-yellow-400'}`}
              title={isLatest ? 'Click to freeze snapshot' : 'Click to resume auto-play'}
              onClick={toggleFreeze}
            >
              Blocks {activeBatch.from.toLocaleString()} – {activeBatch.to.toLocaleString()}
            </span>
          )}
        </span>
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
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </Toggle>
        </div>
      </div>
      {isLoading || !active ? (
        <PanelLoading message="Waiting for data samples..." />
      ) : active ? (
        <div
          className={`overflow-auto border rounded-md px-4 pb-4 pt-9 dotted-background ${fullscreen ? 'h-full' : 'h-[400px]'}`}
        >
          <FlowStageNode
            transformer={active}
            parentShape={null}
            expandAll={expandAll}
            isLast={active.children.length === 0}
            isRoot
            rootElapsed={active.elapsed}
            batchInfo={activeBatch}
            onFreeze={freeze}
          />
        </div>
      ) : (
        <div>No data</div>
      )}
    </div>
  )
}
