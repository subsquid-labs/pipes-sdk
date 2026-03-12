export function PanelLoading({ message }: { message: string }) {
  return (
    <div className="h-[400px] border rounded-md dotted-background flex items-center justify-center">
      <div className="text-xs text-muted-foreground animate-pulse">{message}</div>
    </div>
  )
}
