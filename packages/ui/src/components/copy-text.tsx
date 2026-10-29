import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@iot-os/ui/components/button"
import { cn } from "@iot-os/ui/lib/utils"

/** Copies `value` and reports it for 1.5 s; a blocked clipboard leaves `copied` false. */
function useCopy(value: string, onCopied?: () => void) {
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])
  const copy = async (event: React.MouseEvent) => {
    // Rows that open on click must not open when their text is copied.
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      onCopied?.()
    } catch {
      // Clipboard can be blocked; the text stays selectable.
    }
  }
  return { copied, copy }
}

/**
 * Text that copies itself when clicked, such as a device code in a table. `children` can show a
 * shorter form; `value` is always what is copied and appears on hover. Sits above stretched row links.
 */
function CopyText({
  value,
  label,
  mono = false,
  onCopied,
  className,
  children,
}: {
  value: string
  /** What is copied, for assistive tech: "device code". */
  label: string
  mono?: boolean
  onCopied?: () => void
  className?: string
  children?: React.ReactNode
}) {
  const { copied, copy } = useCopy(value, onCopied)
  return (
    <button
      type="button"
      data-slot="copy-text"
      title={`${value} · Click to copy`}
      aria-label={copied ? `Copied ${label}` : `Copy ${label} ${value}`}
      onClick={copy}
      className={cn(
        "group/copy relative z-10 inline-flex max-w-full min-w-0 cursor-copy items-center gap-1 rounded-sm text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        mono && "font-mono",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children ?? value}</span>
      {copied ? (
        <CheckIcon aria-hidden className="size-3.5 shrink-0 text-success" />
      ) : (
        <CopyIcon
          aria-hidden
          className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100"
        />
      )}
    </button>
  )
}

/** An icon button that copies `value`, for text that is a link and so can't copy itself. */
function CopyButton({
  value,
  label,
  onCopied,
  className,
}: {
  value: string
  /** What is copied, for assistive tech: "device name". */
  label: string
  onCopied?: () => void
  className?: string
}) {
  const { copied, copy } = useCopy(value, onCopied)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      data-slot="copy-button"
      title={`Copy ${label}`}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      onClick={copy}
      className={cn("relative z-10 text-muted-foreground", className)}
    >
      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
    </Button>
  )
}

export { CopyButton, CopyText }
