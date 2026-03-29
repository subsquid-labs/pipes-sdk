'use client'

import { useState } from 'react'

import { Switch } from '~/components/ui/switch'
import { PanelLoading } from '~/dashboard/panel-loading'
import { type ApiProfilerResult, useProfilers } from '~/hooks/use-metrics'
import { useServerIndex } from '~/hooks/use-server-context'

export type ProfilerResult = {
  name: string
  totalTime: number
  selfTime: number
  percent: number
  labels?: string[]
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
    useSelfTime: boolean
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
        labels: profiler.labels,
        children: [],
      }
      acc.push(item)
    }

    item.totalTime += Number(profiler.totalTime)
    item.selfTime += Number(selfTime)

    const timeForPercent = percentage.useSelfTime ? item.selfTime : item.totalTime
    item.percent = (timeForPercent / percentage.totalSpentTime) * 100

    item.children = calcStats({
      acc: item.children,
      profilers: profiler.children,
      percentage,
    })
  }

  return acc
}

function ProfilerResultNode({ profiler, useSelfTime }: { profiler: ProfilerResult; useSelfTime: boolean }) {
  const threshold = Math.pow(profiler.percent / 100, 0.5)
  const opacity = 0.4 + 0.6 * threshold
  const time = useSelfTime ? profiler.selfTime : profiler.totalTime
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
          <span className="text-white/50 text-xxs">
            {time.toFixed(2)}ms · {profiler.percent.toFixed(2)}%
          </span>
          {profiler.labels && profiler.labels.length > 0 && (
            <div className="ml-auto flex gap-1">
              {profiler.labels.map((label) => (
                <span
                  key={label}
                  className="text-xxs px-1 py-0.5 rounded bg-white/[0.06] border border-white/[0.1] text-white/40"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="pl-6">
        {profiler.children.map((child) => (
          <ProfilerResultNode key={child.name} profiler={child} useSelfTime={useSelfTime} />
        ))}
      </div>
    </div>
  )
}

export function Profiler({ pipeId }: { pipeId: string }) {
  const { serverIndex } = useServerIndex()
  const { data, isLoading } = useProfilers({ serverIndex, pipeId })
  const [useSelfTime, setUseSelfTime] = useState(false)

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
      useSelfTime,
    },
  })

  const totalSamples = profilers.length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xxs text-white/50">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <Switch checked={useSelfTime} onCheckedChange={setUseSelfTime} />
          Self time
        </label>
        <span>{totalSamples} samples</span>
      </div>

      <div className="h-[400px] relative overflow-auto border rounded-md px-1 dotted-background">
        {res.map((profiler) => (
          <ProfilerResultNode key={profiler.name} profiler={profiler} useSelfTime={useSelfTime} />
        ))}
      </div>
    </div>
  )
}
