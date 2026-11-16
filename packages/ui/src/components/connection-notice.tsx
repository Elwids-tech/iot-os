import * as React from "react"
import { CloudOffIcon } from "lucide-react"

import { RelativeTime } from "@iot-os/ui/components/freshness"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * The offline banner under the page header (spec 033, FR-013). Values already on the
 * page stay, with their own age labels; the banner says how old they are at most and
 * that nothing new arrives until the connection returns. `at` is the last time the API
 * answered (ISO 8601); without it the banner says the values may be out of date.
 */
function ConnectionNotice({
  at,
  now,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  at?: string | null
  now?: number
}) {
  return (
    <div
      data-slot="connection-notice"
      role="status"
      className={cn(
        "flex items-start gap-2 border-t bg-warning/10 px-4 py-2 text-meta text-foreground md:px-6",
        className,
      )}
      {...props}
    >
      <CloudOffIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <p>
        <span className="font-medium">You're offline.</span>{" "}
        {at ? (
          <>
            Values are from <RelativeTime at={at} now={now} />.
          </>
        ) : (
          "Values on this page may be out of date."
        )}{" "}
        <span className="text-muted-foreground">They update when the connection returns.</span>
      </p>
    </div>
  )
}

export { ConnectionNotice }
