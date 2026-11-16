import * as React from "react"
import { CloudOffIcon, RefreshCwIcon } from "lucide-react"

import { Button } from "@iot-os/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { Panel } from "@iot-os/ui/components/panel"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * What an app shows when it starts without a connection (spec 033, FR-012): no data
 * from an earlier session, only what is missing and a way to try again. The app also
 * reloads by itself when the connection returns.
 */
function OfflineScreen({
  onRetry,
  retrying = false,
  className,
}: {
  onRetry?: () => void
  retrying?: boolean
  className?: string
}) {
  return (
    <main data-slot="offline-screen" className={cn("flex min-h-svh items-center justify-center p-5", className)}>
      <Panel className="w-full max-w-md">
        <Empty className="border-0 p-6 md:p-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CloudOffIcon />
            </EmptyMedia>
            <EmptyTitle>
              <h1 className="text-heading">You're offline</h1>
            </EmptyTitle>
            <EmptyDescription>
              Alerts and readings need a connection. This page loads again by itself when the
              connection returns.
            </EmptyDescription>
          </EmptyHeader>
          {onRetry && (
            <EmptyContent>
              <Button variant="outline" disabled={retrying} onClick={onRetry}>
                <RefreshCwIcon data-icon="inline-start" aria-hidden="true" className={cn(retrying && "animate-spin")} />
                {retrying ? "Trying…" : "Try again"}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      </Panel>
    </main>
  )
}

export { OfflineScreen }
