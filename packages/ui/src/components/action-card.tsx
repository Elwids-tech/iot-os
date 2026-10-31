import * as React from "react"
import type { LucideIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card"

/**
 * A step that waits on the person inside an assistant chat: a proposal to
 * review, the next step to open, devices to activate. An icon, a short label,
 * the title and its actions inside the card, so every approval reads the same
 * way. Actions sit in the card, never in a footer strip.
 */
function ActionCard({
  icon: Icon,
  label,
  title,
  description,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  icon: LucideIcon
  /** What kind of step this is, such as "Next step" or "Adapter proposal". */
  label: string
  title: React.ReactNode
  description?: React.ReactNode
}) {
  return (
    <Card size="sm" {...props}>
      <CardHeader className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
        >
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-meta text-muted-foreground">{label}</span>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      {children && (
        <CardContent className="flex flex-wrap items-center gap-2 pl-14">
          {children}
        </CardContent>
      )}
    </Card>
  )
}

export { ActionCard }
