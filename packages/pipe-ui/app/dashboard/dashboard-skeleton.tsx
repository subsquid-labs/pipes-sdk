import { Logo } from '~/components/ui/logo'

function Bone({ className }: { className?: string }) {
  return <div className={`bg-muted/50 rounded animate-pulse ${className ?? ''}`} />
}

function SidebarSkeleton() {
  return (
    <div className="flex-[0_250px]">
      <div className="w-full mb-2">
        <Bone className="h-8 w-[140px] mb-2" />
        <div className="w-full flex flex-col items-start text-xs gap-2">
          <div className="flex items-center gap-2">
            <Bone className="h-4 w-[60px]" />
            <Bone className="h-4 w-[90px]" />
          </div>
          <div className="flex items-center gap-2">
            <Bone className="h-4 w-[60px]" />
            <Bone className="h-4 w-[50px]" />
          </div>
        </div>
      </div>
      <div className="mt-2">
        <Bone className="h-3 w-[30px] mb-1" />
        <Bone className="h-[52px] w-full rounded-md" />
      </div>
    </div>
  )
}

function PipelineSkeleton() {
  return (
    <div className="flex-1 min-w-0">
      <div className="p-4 border rounded-xl">
        <div className="flex justify-between">
          <Bone className="h-5 w-[120px]" />
          <Bone className="h-5 w-[100px]" />
        </div>
        <Bone className="w-full h-4 rounded-full my-1.5" />
        <div className="flex justify-between mb-3">
          <Bone className="h-3 w-[180px]" />
          <Bone className="h-3 w-[50px]" />
        </div>

        <div className="mt-4 mb-6">
          <div className="flex gap-1 mb-4">
            <Bone className="h-8 w-[80px] rounded-md" />
            <Bone className="h-8 w-[100px] rounded-md" />
            <Bone className="h-8 w-[60px] rounded-md" />
          </div>
          <Bone className="h-[200px] w-full rounded-md" />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Bone className="w-[100px] h-[40px] rounded-sm" />
            <div>
              <Bone className="h-3 w-[80px] mb-1" />
              <Bone className="h-4 w-[60px]" />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Bone className="w-[100px] h-[40px] rounded-sm" />
            <div>
              <Bone className="h-3 w-[80px] mb-1" />
              <Bone className="h-4 w-[60px]" />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Bone className="w-[100px] h-[40px] rounded-sm" />
            <div>
              <Bone className="h-3 w-[80px] mb-1" />
              <Bone className="h-4 w-[60px]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="flex flex-col items-center pt-16 pb-4 gap-10 skeleton-fade-in">
      <div className="max-w-[1000px] w-full">
        <div className="flex justify-between">
          <div className="flex self-start mb-8">
            <Logo />
          </div>
          <Bone className="h-9 w-[130px] rounded-md" />
        </div>
        <div className="flex gap-10">
          <SidebarSkeleton />
          <PipelineSkeleton />
        </div>
      </div>
    </div>
  )
}
