'use client'

import { useState } from 'react'

import { PanelLoading } from '~/dashboard/panel-loading'
import { type ApiProfilerResult, useProfilers } from '~/hooks/use-metrics'
import { useServerIndex } from '~/hooks/use-server-context'

type ProfilerResult = {
  name: string
  totalTime: number
  selfTime: number
  percent: number
  children: ProfilerResult[]
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

export function ProfilerResult({ profiler, useSelfTime }: { profiler: ProfilerResult; useSelfTime: boolean }) {
  // Use square root scale for better visualization
  // so that small differences are more visible
  // and large differences are less dominant
  const threshold = Math.pow(profiler.percent / 100, 0.5)

  const fontSize = 9 + 4 * threshold
  const opacity = 0.4 + 0.7 * threshold

  const time = useSelfTime ? profiler.selfTime : profiler.totalTime
  return (
    <div className="tree">
      <div style={{ fontSize }} className="p-2 relative">
        <div
          className={`absolute top-1 left-0 bottom-1 bg-fuchsia-300/7 rounded-md z-1 transition-width duration-300 ease-out`}
          style={{
            width: `${profiler.percent}%`,
            minWidth: 1,
          }}
        />
        <div className="relative">
          <div className="font-normal" style={{ opacity }}>
            {profiler.name}
          </div>
          <div style={{ opacity }} className="flex leading-none text-white/80 gap-2 mt-[2px] font-xs">
            <div>{time.toFixed(2)}ms</div>
            <div>{profiler.percent.toFixed(2)}%</div>
          </div>
        </div>
      </div>
      <div className="pl-6">
        {profiler.children.map((child, index) => (
          <ProfilerResult key={child.name} profiler={child} useSelfTime={useSelfTime} />
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
    <div>
      <div className="h-[400px] overflow-auto border rounded-md px-1 dotted-background">
        {res.map((profiler) => (
          <ProfilerResult key={profiler.name} profiler={profiler} useSelfTime={useSelfTime} />
        ))}

        <div className="text-xxs font-normal mt-1 flex justify-end">
          <div className="text-muted">{totalSamples} samples</div>
        </div>
      </div>
    </div>
  )
}
