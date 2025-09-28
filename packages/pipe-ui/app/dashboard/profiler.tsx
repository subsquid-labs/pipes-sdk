import { useState } from 'react'
import { type ApiProfilerResult, useProfilers } from '~/api/metrics'

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

  const fontSize = 9 + 6 * threshold
  const opacity = 0.3 + 0.7 * threshold

  const time = useSelfTime ? profiler.selfTime : profiler.totalTime
  return (
    <div className="my-1">
      <div style={{ fontSize }} className="p-2 relative">
        <div
          className="absolute top-0 left-0 bottom-0 bg-[#b53cdd]/10 rounded-md z-1 transition-width duration-300 ease-out"
          style={{ width: `${profiler.percent}%` }}
        />
        <div className="relative">
          <div className="font-medium" style={{ opacity }}>
            {profiler.name}
          </div>
          <div style={{ opacity }} className="flex leading-none text-muted-foreground gap-2">
            <div>{time.toFixed(2)}ms</div>
            <div>{profiler.percent.toFixed(2)}%</div>
          </div>
        </div>
      </div>
      <div className="pl-6">
        {profiler.children.map((child) => (
          <ProfilerResult key={child.name} profiler={child} useSelfTime={useSelfTime} />
        ))}
      </div>
    </div>
  )
}

export function Profiler() {
  const { data } = useProfilers()
  const [useSelfTime, setUseSelfTime] = useState(false)

  const profilers = data?.profilers || []
  const totalSpentTime = profilers.reduce((a, b) => a + b.totalTime, 0)

  const res = calcStats({
    acc: [],
    profilers: data?.profilers || [],
    percentage: {
      totalSpentTime,
      useSelfTime,
    },
  })

  const totalSamples = (data?.profilers || []).length

  return (
    <div className="mb-4">
      <h2 className="flex justify-between font-medium text-sm mb-1 gap-2">
        <div>Profiler</div>

        {/*<Switch*/}
        {/*  onCheckedChange={(checked) => {*/}
        {/*    setUseSelfTime(checked)*/}
        {/*  }}*/}
        {/*  checked={useSelfTime}*/}
        {/*>*/}
        {/*  Use self time*/}
        {/*</Switch>*/}
      </h2>

      <div className="max-h-[400px] overflow-auto border rounded-md px-1 dotted-background">
        {res.map((profiler) => (
          <ProfilerResult key={profiler.name} profiler={profiler} useSelfTime={useSelfTime} />
        ))}
      </div>

      <div className="text-xxs mt-1 flex justify-end">
        <div className="text-muted">{totalSamples} samples</div>
      </div>
    </div>
  )
}
