'use client'

import { useMemo, useState } from 'react'

import { Maximize2, Minimize2, Pause, Play } from 'lucide-react'

import { Code } from '~/components/ui/code'
import { Toggle } from '~/components/ui/toggle'
import { useTransformationExemplar } from '~/hooks/use-metrics'
import { useServerIndex } from '~/hooks/use-server-context'

type TransformerExample = {
  name: string
  data: any
  children: TransformerExample[]
}

export function TransformerExample({
  transformer,
  onClick,
}: {
  transformer: TransformerExample
  onClick?: (childIsOpen: boolean) => void
}) {
  const opacity = transformer.data ? 1 : 0.5
  const [open, setOpen] = useState(false)

  const data = useMemo(() => {
    if (!transformer.data) return ''

    const json = JSON.parse(transformer.data)
    const res = JSON.stringify(json, null, open ? 2 : 0)

    return open
      ? // Truncated arrays are received as [value, "... N more ..."]
        // Convert the second element into a TypeScript comment showing the number of truncated items
        res.replace(/"\.\.\.\s+(\d+)\s+more\s+\.\.\."/gm, '// ... truncated $1 items ...')
      : // If not open, just truncate to 100 characters
        res.length > 79
        ? res.substring(0, 79) + '...'
        : res
  }, [transformer.data, open])

  return (
    <div className="tree">
      <div
        className={data ? 'cursor-pointer' : undefined}
        onClick={() => {
          setOpen(!open)
          onClick?.(!open)
        }}
      >
        <div className="pt-3 pl-1 text-xs" style={{ opacity }}>
          {transformer.name}
        </div>
        <div className="text-xxs text-nowrap">
          {data ? (
            <Code language="json" hideCopyButton={!open} className="bg-secondary/30 rounded-md p-1 text-xxs">
              {data}
            </Code>
          ) : null}
        </div>
      </div>
      <div className="pl-3">
        {transformer.children.map((child) => (
          <TransformerExample key={child.name} transformer={child} onClick={onClick} />
        ))}
      </div>
    </div>
  )
}

export function TransformationExemplar({ pipeId }: { pipeId: string }) {
  const { serverIndex } = useServerIndex()
  const [enabled, useEnabled] = useState(true)
  const [autoStopped, useAutoStoppedEnabled] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const { data } = useTransformationExemplar({ enabled, serverIndex, pipeId })

  const handleOnClick = (childIsOpen: boolean) => {
    if (childIsOpen && enabled) {
      useEnabled(false)
      useAutoStoppedEnabled(true)
    } else if (!childIsOpen && autoStopped) {
      useEnabled(true)
      useAutoStoppedEnabled(false)
    }
  }

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 bg-background p-6 overflow-auto' : 'relative space-y-1'}>
      <div className={`absolute right-1 top-1 rounded-md z-10 bg-gray-950 ${fullscreen ? 'fixed right-6 top-6' : ''}`}>
        <Toggle onClick={() => useEnabled(true)} pressed={enabled}>
          <Play />
        </Toggle>
        <Toggle className="data-[state]" onClick={() => useEnabled(false)} pressed={!enabled}>
          <Pause />
        </Toggle>
        <Toggle pressed={fullscreen} onClick={() => setFullscreen(!fullscreen)}>
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </Toggle>
      </div>
      {data?.transformation ? (
        <div
          className={`overflow-auto border rounded-md px-1 pb-1 dotted-background ${fullscreen ? 'h-full' : 'h-[400px]'}`}
        >
          <TransformerExample transformer={data.transformation} onClick={handleOnClick} />
        </div>
      ) : (
        <div>No data</div>
      )}
    </div>
  )
}
