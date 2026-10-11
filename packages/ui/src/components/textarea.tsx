import * as React from "react"

import { cn } from "@iot-os/ui/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-input-fill px-2.5 py-2 text-base shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        "[&[readonly]:not(:disabled)]:border-dashed [&[readonly]:not(:disabled)]:bg-transparent [&[readonly]:not(:disabled)]:text-muted-foreground [&[readonly]:not(:disabled)]:shadow-none [&[readonly]:not(:disabled)]:focus-visible:ring-0",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
