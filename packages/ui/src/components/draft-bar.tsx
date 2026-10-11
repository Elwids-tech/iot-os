import * as React from "react"

import { StatusMark, type StatusTone } from "@iot-os/ui/components/status-mark"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * Where a versioned thing stands: its live state, the draft revision and
 * whether there are unsaved edits. Profiles, automations, adapters and
 * dashboard layouts all show the same bar.
 */
export function DraftBar({
  tone,
  status,
  revision,
  dirty = false,
  dirtyLabel = "Unsaved changes",
  children,
  className,
}: {
  tone: StatusTone
  /** The live state, e.g. "Active" or "Live: version 3". */
  status: React.ReactNode
  /** e.g. "Draft 12". */
  revision?: React.ReactNode
  dirty?: boolean
  dirtyLabel?: string
  /** Extra marks, such as a validation result. */
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="draft-bar"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-muted-foreground", className)}
    >
      <StatusMark tone={tone} className="text-foreground">
        {status}
      </StatusMark>
      {revision && <span>{revision}</span>}
      {dirty && (
        <StatusMark tone="warning" className="text-foreground" aria-live="polite">
          {dirtyLabel}
        </StatusMark>
      )}
      {children}
    </div>
  )
}
