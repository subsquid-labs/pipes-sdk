'use client'

import { useCallback, useMemo, useState } from 'react'

import { ChevronRight } from 'lucide-react'

import type { ProfilerResult } from '~/dashboard/profiler'
import { getHeatColor } from '~/dashboard/profiler'

type FlatNode = ProfilerResult & {
  depth: number
  /**
   * Stable hierarchical identity of this node (e.g. `batch/apply transformers/decoder`).
   * Used as the React key so rows don't remount when timings shift.
   * `calcStats` merges same-named siblings, so this path is unique within a tree.
   */
  path: string
  /** X position on the canvas, in percent (0–100). */
  xPercent: number
  /** Width on the canvas, in percent (0–100). */
  widthPercent: number
}

type ParentFrame = {
  /** `ProfilerResult.startOffset` of the parent (ms, summed across samples). */
  msOffset: number
  /** `ProfilerResult.totalTime` of the parent (ms, summed across samples). */
  totalTime: number
  /** Canvas x position of the parent, in percent. */
  xPercent: number
  /** Canvas width of the parent, in percent. */
  widthPercent: number
  /** Hierarchical path of the parent (empty string at the root level). */
  path: string
}

function flattenByDepth(nodes: ProfilerResult[], depth: number, parent: ParentFrame): FlatNode[] {
  const result: FlatNode[] = []

  // Legacy fallback: if children don't carry real offsets, lay them out sequentially
  // inside the parent using duration ratios (this preserves the pre-alpha.7 behavior).
  const hasRealOffsets = nodes.every((n) => typeof n.startOffset === 'number')
  const siblingTotal = nodes.reduce((sum, n) => sum + n.totalTime, 0)
  const denom = parent.totalTime > 0 ? parent.totalTime : siblingTotal > 0 ? siblingTotal : 1
  let seqOffsetPercent = parent.xPercent

  for (const node of nodes) {
    let xPercent: number
    let widthPercent: number

    if (hasRealOffsets) {
      const relStart = (node.startOffset as number) - parent.msOffset
      widthPercent = (node.totalTime / denom) * parent.widthPercent
      xPercent = parent.xPercent + (relStart / denom) * parent.widthPercent
    } else {
      widthPercent = siblingTotal > 0 ? (node.totalTime / siblingTotal) * parent.widthPercent : 0
      xPercent = seqOffsetPercent
      seqOffsetPercent += widthPercent
    }

    const path = parent.path ? `${parent.path}/${node.name}` : node.name
    result.push({ ...node, depth, path, xPercent, widthPercent })

    if (node.children.length > 0) {
      result.push(
        ...flattenByDepth(node.children, depth + 1, {
          msOffset: node.startOffset ?? 0,
          totalTime: node.totalTime,
          xPercent,
          widthPercent,
          path,
        }),
      )
    }
  }

  return result
}

function groupByDepth(nodes: FlatNode[]): Map<number, FlatNode[]> {
  const map = new Map<number, FlatNode[]>()
  for (const node of nodes) {
    let list = map.get(node.depth)
    if (!list) {
      list = []
      map.set(node.depth, list)
    }
    list.push(node)
  }
  return map
}

type TooltipData = {
  x: number
  y: number
  node: FlatNode
}

type TimeMode = 'total' | 'avg'

function Tooltip({ data, samples, timeMode }: { data: TooltipData; samples: number; timeMode: TimeMode }) {
  const { node, x, y } = data
  const divisor = samples > 0 ? samples : 1
  const totalTime = timeMode === 'avg' ? node.totalTime / divisor : node.totalTime
  const selfTime = timeMode === 'avg' ? node.selfTime / divisor : node.selfTime
  const selfPct = node.totalTime > 0 ? (node.selfTime / node.totalTime) * 100 : 0
  const aggregateLabel = timeMode === 'avg' ? 'avg over' : 'Σ over'

  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        left: x + 16,
        top: y - 10,
      }}
    >
      <div className="bg-gray-900 border border-white/10 rounded-md p-3 shadow-xl min-w-[220px]">
        <div className="font-normal text-xs text-white mb-2 flex items-center gap-1.5">
          <span>{node.name}</span>
          {node.labels?.map((label) => (
            <span
              key={label}
              className="text-xxs px-1 py-0.5 rounded bg-white/[0.06] border border-white/[0.1] text-white/40"
            >
              {label}
            </span>
          ))}
        </div>
        <div className="space-y-1 text-xxs">
          <div className="flex justify-between gap-4 text-white/60">
            <span>Total time</span>
            <span className="text-white/90">
              {timeMode === 'avg' ? 'avg. ' : ''}
              {totalTime.toFixed(2)}ms
            </span>
          </div>
          <div className="flex justify-between gap-4 text-white/60">
            <span>Self time</span>
            <span className="text-white/90">
              {timeMode === 'avg' ? 'avg. ' : ''}
              {selfTime.toFixed(2)}ms ({selfPct.toFixed(1)}%)
            </span>
          </div>
          <div className="flex justify-between gap-4 text-white/60">
            <span>% of total</span>
            <span className="text-white/90">{node.percent.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between gap-4 text-white/40 pt-1 border-t border-white/5">
            <span>{aggregateLabel}</span>
            <span>{samples} batches</span>
          </div>
          {node.children.length > 0 && (
            <div className="flex justify-between gap-4 text-white/60">
              <span>Children</span>
              <span className="text-white/90">{node.children.length}</span>
            </div>
          )}
        </div>
        <div
          className="h-[3px] rounded-full mt-2"
          style={{
            width: `${Math.max(node.percent, 2)}%`,
            backgroundColor: getHeatColor(node.percent),
          }}
        />
      </div>
    </div>
  )
}

export function FlameChart({
  profilers,
  samples,
  timeMode,
}: {
  profilers: ProfilerResult[]
  samples: number
  timeMode: TimeMode
}) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)
  const [zoomPath, setZoomPath] = useState<string[]>([])

  const zoomedRoot = useMemo(() => {
    if (zoomPath.length === 0) return profilers

    let current: ProfilerResult[] = profilers
    for (const name of zoomPath) {
      const found = current.find((n) => n.name === name)
      if (!found) return profilers
      current = found.children
    }
    return current
  }, [profilers, zoomPath])

  const flat = useMemo(() => {
    // Top-level roots have no spatial relationship (they're independent trees —
    // typically just one `batch` aggregate). Pack them sequentially across the
    // canvas, proportional to their totalTime. Inside each root, children use
    // their real startOffset (ms relative to their root).
    const result: FlatNode[] = []
    const rootsTotal = zoomedRoot.reduce((sum, n) => sum + n.totalTime, 0)
    let xPercent = 0
    for (const root of zoomedRoot) {
      const widthPercent = rootsTotal > 0 ? (root.totalTime / rootsTotal) * 100 : 0
      const path = root.name
      result.push({ ...root, depth: 0, path, xPercent, widthPercent })
      if (root.children.length > 0) {
        result.push(
          ...flattenByDepth(root.children, 1, {
            msOffset: root.startOffset ?? 0,
            totalTime: root.totalTime,
            xPercent,
            widthPercent,
            path,
          }),
        )
      }
      xPercent += widthPercent
    }
    return result
  }, [zoomedRoot])
  const depthMap = useMemo(() => groupByDepth(flat), [flat])
  const maxDepth = useMemo(() => Math.max(...Array.from(depthMap.keys()), 0), [depthMap])

  const handleMouseEnter = useCallback((e: React.MouseEvent, node: FlatNode) => {
    setTooltip({ x: e.clientX, y: e.clientY, node })
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent, node: FlatNode) => {
      if (tooltip) {
        setTooltip({ x: e.clientX, y: e.clientY, node })
      }
    },
    [tooltip],
  )

  const handleMouseLeave = useCallback(() => {
    setTooltip(null)
  }, [])

  const handleClick = useCallback(
    (node: FlatNode) => {
      if (node.children.length > 0) {
        setZoomPath([...zoomPath, node.name])
      }
    },
    [zoomPath],
  )

  const handleBreadcrumb = useCallback((index: number) => {
    setZoomPath((prev) => prev.slice(0, index))
  }, [])

  return (
    <div>
      {/* Breadcrumb */}
      {zoomPath.length > 0 && (
        <div className="flex items-center gap-1 mb-2 text-xxs">
          <button type="button" onClick={() => handleBreadcrumb(0)} className="text-white/50 hover:text-white/80">
            root
          </button>
          {zoomPath.map((name, i) => (
            // eslint-disable-next-line react/no-array-index-key -- breadcrumb segments can repeat by name
            <span key={`${i}-${name}`} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 text-white/30" />
              <button
                type="button"
                onClick={() => handleBreadcrumb(i + 1)}
                className={i === zoomPath.length - 1 ? 'text-white/80' : 'text-white/50 hover:text-white/80'}
              >
                {name}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Flame rows */}
      <div className="space-y-px overflow-hidden">
        {Array.from({ length: maxDepth + 1 }, (_, depth) => {
          const nodes = depthMap.get(depth) || []
          return (
            <div key={depth} className="flame-row">
              {nodes.map((node) => {
                const width = node.widthPercent
                const color = getHeatColor(node.percent)

                return (
                  <div
                    key={node.path}
                    className="flame-cell"
                    style={{
                      left: `${node.xPercent}%`,
                      width: `${width}%`,
                      minWidth: width > 0 ? 4 : 0,
                      backgroundColor: color,
                    }}
                    onMouseEnter={(e) => handleMouseEnter(e, node)}
                    onMouseMove={(e) => handleMouseMove(e, node)}
                    onMouseLeave={handleMouseLeave}
                    onClick={() => handleClick(node)}
                  >
                    {width > 8 && <span className="flame-name">{node.name}</span>}
                    {width > 15 && (
                      <span className="flame-time">
                        {timeMode === 'avg' ? 'avg. ' : ''}
                        {(timeMode === 'avg' ? node.totalTime / (samples > 0 ? samples : 1) : node.totalTime).toFixed(
                          1,
                        )}
                        ms {node.percent.toFixed(1)}%
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-px mt-1.5">
        <span className="text-white/25 mr-1" style={{ fontSize: '0.5rem' }}>
          fast
        </span>
        {[0, 5, 10, 15, 20, 30, 40, 50, 60, 70, 90].map((pct) => (
          <div
            key={pct}
            className="h-[5px] rounded-[1px]"
            style={{
              width: 14,
              backgroundColor: getHeatColor(pct),
            }}
          />
        ))}
        <span className="text-white/25 ml-1" style={{ fontSize: '0.5rem' }}>
          bottleneck
        </span>
      </div>

      {tooltip && <Tooltip data={tooltip} samples={samples} timeMode={timeMode} />}
    </div>
  )
}
