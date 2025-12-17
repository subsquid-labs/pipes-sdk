'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'

type Props = {
  value: string
}

const WINDOWS: Record<string, { label: string; seconds: number }> = {
  '15m': { label: 'Last 15 mins', seconds: 15 * 60 },
  '1h': { label: 'Last 1 hour', seconds: 60 * 60 },
  '4h': { label: 'Last 4 hours', seconds: 4 * 60 * 60 },
  '1d': { label: 'Last 24 hours', seconds: 24 * 60 * 60 },
}

export const QUERY_LOG_WINDOW_OPTIONS = (Object.keys(WINDOWS) as string[]).map((value) => ({
  value,
  label: WINDOWS[value].label,
}))

export function QueryLogWindowSelect({ value }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      {/*<span>Interval</span>*/}
      <Select
        value={value}
        onValueChange={(next) => {
          const params = new URLSearchParams(searchParams?.toString())
          params.set('interval', next)
          const queryString = params.toString()
          router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
        }}
      >
        <SelectTrigger className="w-[140px] bg-slate-950 text-slate-100">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {QUERY_LOG_WINDOW_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
