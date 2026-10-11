import * as React from "react"

import { cn } from "@iot-os/ui/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Text entry is an inset field: a fill one step below the surface and a 3:1 border.
        "h-8 w-full min-w-0 rounded-lg border border-input bg-input-fill px-2.5 py-1 text-base shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        // Read-only shows a reference value: no fill, dashed border, muted text, no focus ring.
        "[&[readonly]:not(:disabled)]:border-dashed [&[readonly]:not(:disabled)]:bg-transparent [&[readonly]:not(:disabled)]:text-muted-foreground [&[readonly]:not(:disabled)]:shadow-none [&[readonly]:not(:disabled)]:focus-visible:ring-0",
        "dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
