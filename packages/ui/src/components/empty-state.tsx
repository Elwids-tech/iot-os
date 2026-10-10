import * as React from "react"

import { cn } from "@iot-os/ui/lib/utils"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@iot-os/ui/components/empty"

/**
 * The one empty state: an icon, a title, one sentence of description and the
 * next step. Copy: "No X yet" with the create action, or "No matching X" with
 * a Clear filters action. `inset` drops the dashed frame when the state sits
 * inside a card or a split pane that already has edges.
 */
function EmptyState({
  icon,
  title,
  description,
  action,
  inset,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  inset?: boolean
}) {
  return (
    <Empty
      data-slot="empty-state"
      className={cn(inset ? "border-0 p-6 md:p-8" : "border", className)}
      {...props}
    >
      <EmptyHeader>
        {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent className="flex-row flex-wrap justify-center">{action}</EmptyContent>}
    </Empty>
  )
}

export { EmptyState }
