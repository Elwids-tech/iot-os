import type { ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { AlertCircleIcon, RefreshCwIcon } from "lucide-react"

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {actions}
    </div>
  )
}

export function PageLoading({ label = "Loading workspace…" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-4" aria-label={label} aria-live="polite">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function PageError({ retry }: { retry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>Could not load this tenant workspace</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>Check the API connection and your Organization access, then try again.</span>
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          <RefreshCwIcon data-icon="inline-start" />
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  )
}
