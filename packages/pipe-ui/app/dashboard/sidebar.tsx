import { useStats } from '~/api/metrics'
import { usePortalStatus } from '~/api/portal'
import { Separator } from '~/components/ui/separator'

export function PortalStatus({ url }: { url?: string }) {
  const host = url ? new URL(url).origin : ''

  const { data } = usePortalStatus(host)
  if (!data) return

  return (
    <div>
      <Separator className="my-5" />

      <div className="w-full">
        <div className="mb-2">
          <h1 className="text-md font-bold mb-2">Portal</h1>
          <div className="text-secondary-foreground text-xxs">{host}</div>
        </div>
        <div className="flex flex-col items-start text-xs gap-2">
          <div className="flex items-center gap-2">
            <div className="text-muted-foreground w-[60px]">Version</div>
            <div className=" flex items-center gap-1">{data.portal_version}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-muted-foreground w-[60px]">Workers</div>
            <div className=" flex items-center gap-1">{data.workers.active_count}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Sidebar() {
  const { data } = useStats()

  return (
    <div className="min-w-[200px]">
      <div className="w-full ">
        <h1 className="text-2xl font-bold mb-2">Pipes SDK</h1>
        <div className="w-full flex flex-col items-start text-xs gap-2">
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
      <PortalStatus url={data?.pipes[0]?.portal.url} />
    </div>
  )
}
