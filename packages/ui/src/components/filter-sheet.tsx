import * as React from "react"
import { ListFilterIcon } from "lucide-react"

import { Button } from "@iot-os/ui/components/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@iot-os/ui/components/sheet"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * Phones (under 768 px): a list's filters behind one **Filters** button with the count
 * of active filters, opening a bottom sheet that holds every filter the wider layout
 * shows. Lists get it through `CollectionPage`'s `filters` and `DataTable`'s filters;
 * a page with its own toolbar (Alerts) uses it directly. Changes apply as they are made.
 */
function FilterSheet({
  title = "Filters",
  description,
  count = 0,
  onReset,
  className,
  children,
}: {
  /** The sheet's heading, such as "Filter alerts". */
  title?: string
  description?: React.ReactNode
  /** Active filters; the button shows the count when above zero. */
  count?: number
  /** Shows **Clear filters** while any filter is active. */
  onReset?: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-slot="filter-sheet-trigger"
          aria-label={count > 0 ? `Filters, ${count} active` : "Filters"}
          className={className}
        >
          <ListFilterIcon data-icon="inline-start" />
          Filters
          {count > 0 && (
            <span className="grid min-w-4.5 place-items-center rounded-full bg-primary px-1 text-micro leading-4.5 font-semibold text-primary-foreground tabular-nums">
              {count}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" data-slot="filter-sheet" className="max-h-[85dvh] gap-0 rounded-t-xl">
        <SheetHeader className="border-b pr-14">
          <SheetTitle className="text-heading">{title}</SheetTitle>
          <SheetDescription className={description ? undefined : "sr-only"}>
            {description ?? "Changes apply as you make them."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 [&_[data-slot=toggle-group]]:max-w-full [&_[data-slot=toggle-group]]:overflow-x-auto">
          {children}
        </div>
        <SheetFooter className="flex-row border-t">
          {onReset && count > 0 && (
            <Button variant="outline" className="flex-1" onClick={onReset}>
              Clear filters
            </Button>
          )}
          <SheetClose asChild>
            <Button className="flex-1">Done</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** Filters inline from 768 px, in a `FilterSheet` below. */
function ResponsiveFilters({
  phone,
  className,
  ...props
}: React.ComponentProps<typeof FilterSheet> & { phone: boolean }) {
  if (phone) return <FilterSheet {...props} />
  return (
    <div
      data-slot="filters"
      role="group"
      aria-label={props.title ?? "Filters"}
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}
    >
      {props.children}
    </div>
  )
}

export { FilterSheet, ResponsiveFilters }
