import * as React from "react"

import { cn } from "@iot-os/ui/lib/utils"

/**
 * The one content surface. Tables, forms, charts, property lists and empty
 * states sit in a Panel; only page headers, toolbars and section titles sit on
 * the canvas. Skins set the radius and gap, so Instrument tiles square panels.
 */
function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="panel"
      className={cn(
        "group/panel flex min-w-0 flex-col overflow-hidden rounded-xl bg-card text-body text-card-foreground shadow-panel",
        className,
      )}
      {...props}
    />
  )
}

/** Title row: PanelTitle, optional PanelDescription, then PanelActions on the right. */
function PanelHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2",
        className,
      )}
      {...props}
    />
  )
}

function PanelTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="panel-title"
      className={cn("skin-label text-heading", className)}
      {...props}
    />
  )
}

function PanelDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="panel-description"
      className={cn("text-meta text-muted-foreground", className)}
      {...props}
    />
  )
}

function PanelActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-actions"
      className={cn("ml-auto flex shrink-0 items-center gap-2", className)}
      {...props}
    />
  )
}

/** Padded body. `flush` drops the padding for tables and lists that run edge to edge. */
function PanelContent({
  className,
  flush = false,
  ...props
}: React.ComponentProps<"div"> & { flush?: boolean }) {
  return (
    <div
      data-slot="panel-content"
      data-flush={flush || undefined}
      className={cn(
        "min-w-0 flex-1",
        // Tables and empty states run edge to edge even when the content is padded.
        !flush && "p-4 has-[>[data-slot=table-container]:first-child]:p-0",
        className,
      )}
      {...props}
    />
  )
}

/** Counts, pagination and secondary actions under the content. */
function PanelFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-footer"
      className={cn(
        "flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-4 py-2 text-meta text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export {
  Panel,
  PanelHeader,
  PanelTitle,
  PanelDescription,
  PanelActions,
  PanelContent,
  PanelFooter,
}
