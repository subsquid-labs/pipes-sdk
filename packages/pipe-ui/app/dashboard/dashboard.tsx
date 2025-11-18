import { ArrowUpRightIcon } from 'lucide-react'
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
          <Button asChild variant="outline">
            <a href={`${import.meta.env.VITE_DOCS_URL}/en/sdk/pipes-sdk/quickstart`} target="_blank">
              Documentation
              <ArrowUpRightIcon />
            </a>
          </Button>
        </div>
        <div className="flex gap-10">
          <Sidebar />
          <Pipeline />
        </div>
      </div>
    </div>
  )
}
