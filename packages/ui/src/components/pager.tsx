import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@iot-os/ui/components/button"
import { cn } from "@iot-os/ui/lib/utils"

/** The one pager: "Page 2 of 5" with Previous and Next. Hidden when there is one page. */
export function Pager({
  page,
  pageCount,
  onPageChange,
  label = "Pages",
  className,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  /** Accessible name of the navigation, e.g. "Alerts pages". */
  label?: string
  className?: string
}) {
  if (pageCount < 2) return null
  return (
    <nav aria-label={label} className={cn("flex items-center gap-1 text-meta text-muted-foreground", className)}>
      <span className="mr-1 tabular-nums">
        Page {page} of {pageCount}
      </span>
      <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        <ChevronLeftIcon data-icon="inline-start" />
        Previous
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        Next
        <ChevronRightIcon data-icon="inline-end" />
      </Button>
    </nav>
  )
}
