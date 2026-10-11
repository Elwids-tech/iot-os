import * as React from "react"

import { cn } from "@iot-os/ui/lib/utils"

/** A heading-sized name you edit in place, for workspace headers. */
export function InlineName({
  label = "Name",
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { label?: string }) {
  return (
    <input
      type="text"
      aria-label={label}
      data-slot="inline-name"
      className={cn(
        "-mx-1.5 h-8 w-full min-w-40 max-w-[32rem] truncate rounded-md border border-transparent bg-transparent px-1.5 text-title outline-none hover:border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  )
}
