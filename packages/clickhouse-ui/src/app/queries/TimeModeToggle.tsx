'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Button } from '~/components/ui/button'

export type TimeMode = 'avg' | 'total'

type Props = {
  value: TimeMode
}

export function TimeModeToggle({ value }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setValue(next: TimeMode) {
    const params = new URLSearchParams(searchParams?.toString())
    if (next === 'avg') {
      params.delete('time')
    } else {
      params.set('time', next)
    }
    const queryString = params.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
  }

  return (
    <div className="flex items-center gap-2 text-sm text-slate-300">
      {/*<span>Time</span>*/}
      <div className="inline-flex rounded-md border border-border/80 bg-slate-950/60 p-1">
        <Button
          type="button"
          size="sm"
          variant={value === 'avg' ? 'secondary' : 'ghost'}
          onClick={() => setValue('avg')}
        >
          Avg
        </Button>
        <Button
          type="button"
          size="sm"
          variant={value === 'total' ? 'secondary' : 'ghost'}
          onClick={() => setValue('total')}
        >
          Total
        </Button>
      </div>
    </div>
  )
}
