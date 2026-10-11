import * as React from "react"

import { statusOf, type StatusDomain } from "@iot-os/ui/lib/status"
import { cn } from "@iot-os/ui/lib/utils"

const tones = {
  good: "bg-success",
  warning: "bg-warning",
  critical: "bg-destructive",
  info: "bg-info",
  muted: "bg-muted-foreground",
  commanded: "bg-commanded",
}

export type StatusTone = keyof typeof tones

/** Status as an 8px square in the tone colour plus a label, never colour alone. */
export function StatusMark({
  tone,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { tone: StatusTone }) {
  return (
    <span
      data-slot="status-mark"
      data-tone={tone}
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}
      {...props}
    >
      <span aria-hidden="true" className={cn("size-2 shrink-0", tones[tone])} />
      {children}
    </span>
  )
}

/** A raw status value through the shared vocabulary in lib/status. */
export function Status({
  value,
  domain,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  value: string | null | undefined
  domain?: StatusDomain
}) {
  const { tone, label } = statusOf(value, domain)
  return (
    <StatusMark tone={tone} {...props}>
      {label}
    </StatusMark>
  )
}
