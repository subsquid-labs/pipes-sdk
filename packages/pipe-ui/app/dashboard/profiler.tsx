'use client'

import { Flame, ListTree, Settings2 } from 'lucide-react'
import { type ComponentType, useEffect, useRef, useState } from 'react'

import { Switch } from '~/components/ui/switch'
import { PanelLoading } from '~/dashboard/panel-loading'
import { FlameChart } from '~/dashboard/profiler-flame-chart'
import { type ApiProfilerResult, useProfilers } from '~/hooks/use-metrics'
import { useLocalStorage } from '~/hooks/use-local-storage'
import { useServerIndex } from '~/hooks/use-server-context'
import { cn } from '~/lib/utils'

type ProfilerView = 'tree' | 'flame'
type TimeMode = 'total' | 'avg'

export type ProfilerResult = {
  name: string
  totalTime: number
  selfTime: number
  percent: number
  children: ProfilerResult[]
}

/**
 * Maps a percentage (0-100) to a heat color.
 * Violet (cold/fast) → fuchsia → magenta → amber → red-orange (hot/bottleneck).
 */
export function getHeatColor(percent: number): string {
  if (percent >= 90) return 'oklch(0.55 0.25 25)'
  if (percent >= 70) return 'oklch(0.60 0.24 30)'
  if (percent >= 60) return 'oklch(0.65 0.22 45)'
  if (percent >= 50) return 'oklch(0.62 0.20 35)'
  if (percent >= 40) return 'oklch(0.60 0.20 10)'
  if (percent >= 30) return 'oklch(0.58 0.22 340)'
  if (percent >= 20) return 'oklch(0.55 0.22 320)'
  if (percent >= 15) return 'oklch(0.50 0.20 310)'
  if (percent >= 10) return 'oklch(0.45 0.18 300)'
  if (percent >= 5) return 'oklch(0.40 0.14 290)'
  return 'oklch(0.35 0.10 280)'
}

function calcStats({
  acc,
  profilers = [],
  percentage,
}: {
  acc: ProfilerResult[]
  profilers: ApiProfilerResult[]
  percentage: {
    totalSpentTime: number
    excludeChildren: boolean
  }
}): ProfilerResult[] {
  for (const profiler of profilers) {
    let item = acc.find((p) => p.name === (profiler as any).name)

    const selfTime = profiler.totalTime - profiler.children.reduce((a, b) => a + b.totalTime, 0)

    if (!item) {
      item = {
        name: profiler.name,
        totalTime: 0,
        selfTime: 0,
        percent: 0,
        children: [],
      }
      acc.push(item)
    }

    item.totalTime += Number(profiler.totalTime)
    item.selfTime += Number(selfTime)

    const timeForPercent = percentage.excludeChildren ? item.selfTime : item.totalTime
    item.percent = (timeForPercent / percentage.totalSpentTime) * 100

    item.children = calcStats({
      acc: item.children,
      profilers: profiler.children,
      percentage,
    })
  }

  return acc
}

function ProfilerResultNode({
  profiler,
  excludeChildren,
  samples,
  timeMode,
}: {
  profiler: ProfilerResult
  excludeChildren: boolean
  samples: number
  timeMode: TimeMode
}) {
  const threshold = Math.pow(profiler.percent / 100, 0.5)
  const opacity = 0.4 + 0.6 * threshold
  const baseTime = excludeChildren ? profiler.selfTime : profiler.totalTime
  const displayTime = timeMode === 'avg' && samples > 0 ? baseTime / samples : baseTime
  const prefix = timeMode === 'avg' ? 'avg. ' : ''
  const heatColor = getHeatColor(profiler.percent)

  return (
    <div className="tree">
      <div className="py-[10px] px-1 relative text-xs">
        <div
          className="absolute top-[3px] left-0 bottom-[3px] rounded-[4px] z-1 transition-all duration-300 ease-out border-l-[3px]"
          style={{
            width: `${profiler.percent}%`,
            minWidth: profiler.percent > 0 ? 6 : 0,
            backgroundColor: `color-mix(in oklch, ${heatColor}, transparent 75%)`,
            borderColor: heatColor,
          }}
        />
        <div className="relative pl-2.5 flex items-baseline gap-2" style={{ opacity }}>
          <span>{profiler.name}</span>
          <span className="text-white/60 text-xxs">
            {prefix}
            {displayTime.toFixed(2)}ms · {profiler.percent.toFixed(2)}%
          </span>
        </div>
      </div>
      <div className="pl-6">
        {profiler.children.map((child) => (
          <ProfilerResultNode
            key={child.name}
            profiler={child}
            excludeChildren={excludeChildren}
            samples={samples}
            timeMode={timeMode}
          />
        ))}
      </div>
    </div>
  )
}

type SegmentedOption<T extends string> = {
  value: T
  label: string
  icon?: ComponentType<{ className?: string }>
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (next: T) => void
  options: SegmentedOption<T>[]
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.03] p-0.5">
      {options.map(({ value: optValue, label, icon: Icon }) => {
        const active = value === optValue
        return (
          <button
            key={optValue}
            type="button"
            onClick={() => onChange(optValue)}
            aria-pressed={active}
            className={cn(
              'flex items-center gap-1 px-2 h-6 text-xxs rounded-sm transition-colors cursor-pointer',
              active
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]',
            )}
          >
            {Icon && <Icon className="size-3" />}
            {label}
          </button>
        )
      })}
    </div>
  )
}

const VIEW_OPTIONS: SegmentedOption<ProfilerView>[] = [
  { value: 'tree', label: 'Tree', icon: ListTree },
  { value: 'flame', label: 'Flame', icon: Flame },
]

const TIME_MODE_OPTIONS: SegmentedOption<TimeMode>[] = [
  { value: 'total', label: 'Total' },
  { value: 'avg', label: 'Avg' },
]

function SettingsPopover({
  excludeChildren,
  setExcludeChildren,
  timeMode,
  setTimeMode,
  view,
  setView,
}: {
  excludeChildren: boolean
  setExcludeChildren: (next: boolean) => void
  timeMode: TimeMode
  setTimeMode: (next: TimeMode) => void
  view: ProfilerView
  setView: (next: ProfilerView) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Profiler settings"
        aria-expanded={open}
        className={cn(
          'flex items-center justify-center size-6 rounded-md border border-white/10 bg-white/[0.03] transition-colors cursor-pointer',
          open ? 'text-white bg-white/10' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.06]',
        )}
      >
        <Settings2 className="size-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[220px] rounded-md border border-white/10 bg-gray-950 shadow-xl p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xxs text-white/70">Exclude children</span>
            <Switch checked={excludeChildren} onCheckedChange={setExcludeChildren} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xxs text-white/70">Time</span>
            <Segmented value={timeMode} onChange={setTimeMode} options={TIME_MODE_OPTIONS} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xxs text-white/70">View</span>
            <Segmented value={view} onChange={setView} options={VIEW_OPTIONS} />
          </div>
        </div>
      )}
    </div>
  )
}

export function Profiler({ pipeId }: { pipeId: string }) {
  const { serverIndex } = useServerIndex()
  const { data, isLoading } = useProfilers({ serverIndex, pipeId })
  const [excludeChildren, setExcludeChildren] = useLocalStorage('profiler.excludeChildren', false)
  const [view, setView] = useLocalStorage<ProfilerView>('profiler.view', 'tree')
  const [timeMode, setTimeMode] = useLocalStorage<TimeMode>('profiler.timeMode', 'total')

  if (isLoading || !data?.profilers.length) {
    return <PanelLoading message="Waiting for data samples..." />
  }

  const profilers = data.profilers || []
  const totalSpentTime = profilers.reduce((a, b) => a + b.totalTime, 0)

  const res = calcStats({
    acc: [],
    profilers: data.profilers || [],
    percentage: {
      totalSpentTime,
      excludeChildren,
    },
  })

  const totalSamples = profilers.length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2 text-xxs text-white/50">
        <span>
          {timeMode === 'avg' ? 'avg over' : 'Σ over'} {totalSamples} batches
        </span>
        <SettingsPopover
          excludeChildren={excludeChildren}
          setExcludeChildren={setExcludeChildren}
          timeMode={timeMode}
          setTimeMode={setTimeMode}
          view={view}
          setView={setView}
        />
      </div>

      {view === 'flame' ? (
        <div className="border rounded-md p-2 dotted-background">
          <FlameChart profilers={res} samples={totalSamples} timeMode={timeMode} />
        </div>
      ) : (
        <div className="h-[400px] relative overflow-auto border rounded-md px-1 dotted-background">
          {res.map((profiler) => (
            <ProfilerResultNode
              key={profiler.name}
              profiler={profiler}
              excludeChildren={excludeChildren}
              samples={totalSamples}
              timeMode={timeMode}
            />
          ))}
        </div>
      )}
    </div>
  )
}
