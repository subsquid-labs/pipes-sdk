import { useMemo, useState } from 'react'
import { useTransformationExemplar } from '~/api/metrics'
import { Code } from '~/components/ui/code'

type TransformerExample = {
  name: string
  data: any
  children: TransformerExample[]
}

export function TransformerExample({ transformer }: { transformer: TransformerExample }) {
  const opacity = transformer.data ? 1 : 0.5
  const fontSize = transformer.data ? 12 : 10
  const [open, setOpen] = useState(false)

  const data = useMemo(() => {
    if (!transformer.data) return ''

    const json = JSON.parse(transformer.data)
    const res = JSON.stringify(json, null, open ? 2 : 0)

    return open
      ? res.replace(/"\.\.\.\s+(\d+)\s+more\s+\.\.\."/gm, '// ... truncated $1 items ...')
      : res.substring(0, 100) + '...'
  }, [transformer.data, open])

  return (
    <div>
      <div className="cursor-pointer" onClick={() => setOpen(!open)}>
        <div className="font-medium" style={{ opacity, fontSize }}>
          {transformer.name}
        </div>
        <div className="text-xxs text-nowrap">
          {data ? (
            <Code hideCopyButton={!open} className="bg-secondary/15 rounded-md p-2" language="json">
              {data}
            </Code>
          ) : null}
        </div>
      </div>
      <div className="pl-3">
        {transformer.children.map((child) => (
          <TransformerExample key={child.name} transformer={child} />
        ))}
      </div>
    </div>
  )
}

export function TransformationExemplar() {
  const { data } = useTransformationExemplar()

  return (
    <div>
      {data?.exemplar ? (
        <div className="max-h-[400px] overflow-auto border rounded-md px-1 dotted-background">
          <TransformerExample transformer={data.exemplar} />
        </div>
      ) : (
        <div>No data</div>
      )}
    </div>
  )
}
