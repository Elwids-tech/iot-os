import * as React from "react"
import { cn } from "@iot-os/ui/lib/utils"

const delays = ["", "[animation-delay:160ms]", "[animation-delay:320ms]"]

/**
 * The live "assistant is working" line in a chat: three dots rising in turn and
 * a shimmering label, announced once to screen readers. After ten seconds it
 * adds the elapsed time, so a long wait reads as progress rather than a hang.
 */
function Thinking({
  className,
  children = "Thinking…",
  ...props
}: React.ComponentProps<"div">) {
  const [started] = React.useState(() => Date.now())
  const [elapsed, setElapsed] = React.useState(0)
  React.useEffect(() => {
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [started])
  return (
    <div
      role="status"
      data-slot="thinking"
      className={cn("flex min-h-6 items-center gap-2 text-body text-muted-foreground", className)}
      {...props}
    >
      <span aria-hidden="true" className="flex items-center gap-1">
        {delays.map((delay) => (
          <span
            key={delay}
            className={cn("size-1.5 rounded-full bg-primary animate-thinking-dot", delay)}
          />
        ))}
      </span>
      <span className="shimmer">{children}</span>
      {elapsed >= 10 && (
        <span aria-hidden="true" className="text-meta tabular-nums">
          {elapsed}s
        </span>
      )}
    </div>
  )
}

export { Thinking }
