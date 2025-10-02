import { Button } from '~/components/ui/button'
import { Logo } from '~/components/ui/logo'
import { Pipeline } from '~/dashboard/pipeline'
import { Sidebar } from '~/dashboard/sidebar'

export function Dashboard() {
  return (
    <div className="flex flex-col items-center pt-16 pb-4 gap-10">
      <div className="max-w-[1000px] w-full">
        <div className="flex justify-between">
          <div className="flex self-start mb-8">
            <Logo />
          </div>
          <Button variant="outline">Documentation</Button>
        </div>
        <div className="flex gap-20">
          <Sidebar />
          <Pipeline />
        </div>
      </div>
    </div>
  )
}
