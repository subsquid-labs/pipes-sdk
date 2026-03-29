'use client'

import { useCallback, useMemo, useState } from 'react'

import { ChevronRight } from 'lucide-react'

import type { ProfilerResult } from '~/dashboard/profiler'
import { getHeatColor } from '~/dashboard/profiler'

type FlatNode = ProfilerResult & {
  depth: number
  startOffset: number
  widthPercent: number
}

function flattenByDepth(
  nodes: ProfilerResult[],
  depth: number,
  parentStartOffset: number,
  parentWidthPercent: number,
): FlatNode[] {
  const result: FlatNode[] = []
  const siblingTotal = nodes.reduce((sum, n) => sum + n.totalTime, 0)
  let offset = parentStartOffset

  for (const node of nodes) {
    const widthPercent =
      siblingTotal > 0 ? (node.totalTime / siblingTotal) * parentWidthPercent : 0

    result.push({
      ...node,
      depth,
      startOffset: offset,
      widthPercent,
    })

    if (node.children.length > 0) {
      result.push(...flattenByDepth(node.children, depth + 1, offset, widthPercent))
    }

    offset += widthPercent
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

function Tooltip({ data }: { data: TooltipData }) {
  const { node, x, y } = data
  const selfTime = node.selfTime
  const selfPct = node.totalTime > 0 ? (selfTime / node.totalTime) * 100 : 0

  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        left: x + 16,
        top: y - 10,
      }}
    >
      <div className="bg-gray-900 border border-white/10 rounded-md p-3 shadow-xl min-w-[200px]">
        <div className="font-normal text-xs text-white mb-2">{node.name}</div>
        <div className="space-y-1 text-xxs">
          <div className="flex justify-between gap-4 text-white/60">
            <span>Total time</span>
            <span className="text-white/90">{node.totalTime.toFixed(2)}ms</span>
          </div>
          <div className="flex justify-between gap-4 text-white/60">
            <span>Self time</span>
            <span className="text-white/90">
              {selfTime.toFixed(2)}ms ({selfPct.toFixed(1)}%)
            </span>
          </div>
          <div className="flex justify-between gap-4 text-white/60">
            <span>% of batch</span>
            <span className="text-white/90">{node.percent.toFixed(2)}%</span>
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
}: {
  profilers: ProfilerResult[]
  useSelfTime?: boolean
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

  const flat = useMemo(() => flattenByDepth(zoomedRoot, 0, 0, 100), [zoomedRoot])
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
            <span key={name} className="flex items-center gap-1">
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
                    key={`${node.name}-${node.startOffset}`}
                    className="flame-cell"
                    style={{
                      left: `${node.startOffset}%`,
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
                        {node.totalTime.toFixed(1)}ms {node.percent.toFixed(1)}%
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

      {tooltip && <Tooltip data={tooltip} />}
    </div>
  )
}
