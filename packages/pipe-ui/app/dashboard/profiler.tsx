import { useState } from 'react'
import { type ApiProfilerResult, useProfilers } from '~/api/metrics'
import { Switch } from '~/components/ui/switch'

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
  const fontSize = 10 + 4 * (profiler.percent / 100)
  const opacity = 0.5 + 0.5 * (profiler.percent / 100)

  const time = useSelfTime ? profiler.selfTime : profiler.totalTime
  return (
    <div className="my-2">
      <div style={{ opacity, fontSize }} className="font-medium p-2 bg-[#b53cdd]/10 rounded-md">
        <div>{profiler.name}</div>
        <div className="flex leading-none text-muted-foreground gap-2">
          <div>{time.toFixed(2)}ms</div>
          <div>{profiler.percent.toFixed(2)}%</div>
        </div>
      </div>
      <div className="pl-4">
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

  return (
    <div>
      <h2 className="flex font-medium text-sm mb-0 gap-2">
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

      <div className="max-h-[400px] overflow-auto mb-4">
        {res.map((profiler) => (
          <ProfilerResult key={profiler.name} profiler={profiler} useSelfTime={useSelfTime} />
        ))}
      </div>
    </div>
  )
}
