import * as React from "react"

import { cn } from "@iot-os/ui/lib/utils"
import { Input } from "@iot-os/ui/components/input"
import { Label } from "@iot-os/ui/components/label"

/*
 * The directory filter row: one search field, pickers and segmented groups at
 * the same height, and the result count on the right. Labels are visually
 * hidden; the placeholder or the picker's current value says what it filters.
 */

function FilterBar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="filter-bar"
      role="group"
      aria-label="Filters"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}
      {...props}
    />
  )
}

/** A labelled control inside the bar; the label is for screen readers. */
function FilterField({
  label,
  id: idProp,
  className,
  children,
}: {
  label: string
  id?: string
  className?: string
  children: (id: string) => React.ReactNode
}) {
  const generated = React.useId()
  const id = idProp ?? generated
  return (
    <div data-slot="filter-field" className={cn("flex min-w-0 items-center", className)}>
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      {children(id)}
    </div>
  )
}

/** The standalone search field for a directory or table. */
function FilterSearch({
  label,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { label: string }) {
  return (
    <FilterField label={label} id={props.id} className={cn("w-full sm:w-64", className)}>
      {(id) => <Input type="search" {...props} id={id} />}
    </FilterField>
  )
}

/** The result count, right-aligned. */
function FilterCount({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="filter-count"
      role="status"
      className={cn("ml-auto text-xs text-muted-foreground tabular-nums", className)}
      {...props}
    />
  )
}

export { FilterBar, FilterCount, FilterField, FilterSearch }
