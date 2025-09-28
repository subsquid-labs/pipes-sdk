import { useMetrics } from '~/api/metrics'

export function Sidebar() {
  const { data } = useMetrics()

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Pipes SDK</h1>

      <div className="w-[200px] flex flex-col items-start text-xs gap-2">
        <div className="flex items-center gap-2">
          <div className="text-muted-foreground w-[60px]">Status</div>
          <div className="font-medium text-foreground flex items-center gap-1">
            <div className="flex items-center gap-2">
              {data ? (
                <div className="w-[8px] h-[8px] rounded-full bg-teal-400" />
              ) : (
                <div className="w-[8px] h-[8px] rounded-full bg-gray-500" />
              )}
              <div>{data ? 'Connected' : 'Disconnected'}</div>
            </div>
          </div>
        </div>

        {data ? (
          <div className="flex items-center gap-2">
            <div className="text-muted-foreground w-[60px]">Version</div>
            <div className=" flex items-center gap-1">{data.sdk.version}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
