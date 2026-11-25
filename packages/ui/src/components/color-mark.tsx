import * as React from "react"

import { cn } from "@iot-os/ui/lib/utils"

/**
 * A colour key: a small square with rounded corners. It marks a status, a
 * legend entry or a series, and always sits next to words, never alone.
 * Give the colour as a class (`bg-success`) or as `color` for a computed one.
 */
export function ColorMark({
  color,
  className,
  style,
  ...props
}: React.ComponentProps<"span"> & { color?: string }) {
  return (
    <span
      aria-hidden={props.role ? undefined : true}
      data-slot="color-mark"
      className={cn("inline-block size-2.5 shrink-0 rounded-sm", className)}
      style={color ? { backgroundColor: color, ...style } : style}
      {...props}
    />
  )
}
