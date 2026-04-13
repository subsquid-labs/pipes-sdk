import { useMemo, useState } from 'react'

import { Pause, Play } from 'lucide-react'

import { useTransformationExemplar } from '~/api/metrics'
import { Code } from '~/components/ui/code'
import { Toggle } from '~/components/ui/toggle'

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
  const [enabled, useEnabled] = useState(true)
  const [autoStopped, useAutoStoppedEnabled] = useState(false)
  const { data } = useTransformationExemplar({ enabled, pipeId })

  // If the exemplar is opened, and we are enabled, disable it (pause updates).
  // If the exemplar is closed, and we were auto-stopped, re-enable it (resume updates).
  // This way, the user can explore the exemplar without it changing under their eyes,
  // but we also don't forget to resume updates when they are done.
  // FIXME: if you open multiple exemplars, closing one should not resume updates if another is still open.
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
    <div className="relative space-y-1">
      <div className="absolute right-1 top-1 rounded-md z-10 bg-gray-950">
        <Toggle onClick={() => useEnabled(true)} pressed={enabled}>
          <Play />
        </Toggle>
        <Toggle className="data-[state]" onClick={() => useEnabled(false)} pressed={!enabled}>
          <Pause />
        </Toggle>
      </div>
      {data?.transformation ? (
        <div className="max-h-[400px] overflow-auto border rounded-md px-1 pb-1 dotted-background">
          <TransformerExample transformer={data.transformation} onClick={handleOnClick} />
        </div>
      ) : (
        <div>No data</div>
      )}
    </div>
  )
}
