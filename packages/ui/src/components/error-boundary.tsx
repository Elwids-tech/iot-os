import * as React from "react"
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { useRouteError } from "react-router-dom"

import { Button } from "@iot-os/ui/components/button"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { isChunkLoadError } from "@iot-os/ui/lib/stale-chunks"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * The one error state: what broke, in words, and the way out. A stale chunk
 * says a new version is available; anything else offers Try again (when the
 * caller can retry) and Reload, with the error message under Technical details.
 */
function ErrorState({
  error,
  onRetry,
  inset,
  className,
}: {
  error: unknown
  onRetry?: () => void
  inset?: boolean
  className?: string
}) {
  const reload = (
    <Button variant={onRetry ? "outline" : "default"} onClick={() => window.location.reload()}>
      <RefreshCwIcon data-icon="inline-start" />
      Reload
    </Button>
  )
  if (isChunkLoadError(error))
    return (
      <EmptyState
        role="alert"
        inset={inset}
        className={className}
        icon={<RefreshCwIcon />}
        title="A new version is available"
        description="The app was updated while this page was open. Reload to continue."
        action={<Button onClick={() => window.location.reload()}>Reload</Button>}
      />
    )
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : null
  return (
    <EmptyState
      role="alert"
      inset={inset}
      className={className}
      icon={<TriangleAlertIcon />}
      title="This page hit a problem"
      description="Something went wrong while showing it. Try again, or reload if it keeps happening."
    >
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
      {reload}
      {message && (
        <details className="w-full text-left text-meta text-muted-foreground">
          <summary className="cursor-pointer text-center">Technical details</summary>
          <p className="mt-2 font-mono break-words">{message}</p>
        </details>
      )}
    </EmptyState>
  )
}

type ErrorBoundaryProps = {
  children: React.ReactNode
  /** Clears the error when it changes, so navigating away recovers. Pass the location's pathname. */
  resetKey?: unknown
  fallback?: (props: { error: unknown; reset: () => void }) => React.ReactNode
}

/**
 * Catches a render error below it so the rest of the app stays usable. Put it
 * around the page area of a layout, keyed on the pathname, so the navigation
 * keeps working and leaving the page clears the error.
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, { error: unknown; failed: boolean }> {
  state = { error: null as unknown, failed: false }

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true }
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.failed && !Object.is(previous.resetKey, this.props.resetKey)) this.reset()
  }

  reset = () => this.setState({ error: null, failed: false })

  render() {
    if (!this.state.failed) return this.props.children
    const { error } = this.state
    return this.props.fallback ? (
      this.props.fallback({ error, reset: this.reset })
    ) : (
      <div className="flex flex-1 items-center justify-center p-4 md:p-6">
        <ErrorState error={error} onRetry={this.reset} className="max-w-lg" />
      </div>
    )
  }
}

/** The `errorElement` for a data router's root route: the whole screen, since nothing above it rendered. */
function RouteError({ className }: { className?: string }) {
  const error = useRouteError()
  return (
    <main className={cn("flex min-h-svh items-center justify-center bg-background p-6", className)}>
      <ErrorState error={error} className="max-w-lg" />
    </main>
  )
}

export { ErrorBoundary, ErrorState, RouteError }
