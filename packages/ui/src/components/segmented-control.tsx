import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * One choice out of a few, shown side by side: a list filter (All, Active, Cleared), a time range,
 * a table view, an option in a form. The selected segment carries the primary colour, as the
 * selected tab does. Use `Tabs` when the choice swaps the content of a page or panel.
 *
 * With its track the control is as tall as an input, so it lines up in toolbars and forms.
 * Pressing the selected segment keeps it selected.
 */
function SegmentedControl({
  className,
  wrap = false,
  onValueChange,
  ...props
}: Omit<ToggleGroupPrimitive.ToggleGroupSingleProps, "type" | "onValueChange"> & {
  /** Let many options run onto more lines instead of widening the row. */
  wrap?: boolean
  onValueChange?: (value: string) => void
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      spacing={0}
      data-slot="segmented-control"
      onValueChange={(value: string) => {
        if (value) onValueChange?.(value)
      }}
      className={cn(
        "max-w-full gap-0 rounded-lg bg-sunken p-0.5 shadow-[inset_0_0_0_1px_var(--border)]",
        wrap && "flex-wrap",
        className,
      )}
      {...props}
    />
  )
}

function SegmentedControlItem({
  className,
  count,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupItem> & {
  /** How many rows the choice holds, shown after the label. */
  count?: number
}) {
  return (
    <ToggleGroupItem
      data-slot="segmented-control-item"
      className={cn("gap-1.5 rounded-md! px-2.5 text-muted-foreground hover:bg-transparent", className)}
      {...props}
    >
      {children}
      {count !== undefined && (
        <span className="font-normal tabular-nums opacity-80">{count.toLocaleString()}</span>
      )}
    </ToggleGroupItem>
  )
}

export { SegmentedControl, SegmentedControlItem }
