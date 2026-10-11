import * as React from "react"
import { Link, type To } from "react-router-dom"

import { PageHeader } from "@iot-os/ui/components/page-header"
import { Panel } from "@iot-os/ui/components/panel"
import type { StatusTone } from "@iot-os/ui/components/status-mark"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * Inbox template: a queue you work through. One toolbar row on the canvas,
 * the queue in a panel on the left and the selected item's detail in a panel
 * on the right. Below 1280px one pane shows at a time; the detail route
 * passes `showDetail` and its own back link. Keep `list` and `detail` mounted
 * in one tree so crossing the breakpoint keeps drafts in the detail.
 */
export function InboxPage({
  title,
  heading,
  actions,
  helpContext,
  tabs,
  toolbar,
  notices,
  header = true,
  wide,
  showDetail = false,
  list,
  detail,
  className,
}: {
  title: string
  heading?: React.ReactNode
  actions?: React.ReactNode
  helpContext?: string
  /** A TabsList under the title; wrap the page in Tabs. */
  tabs?: React.ReactNode
  toolbar?: React.ReactNode
  notices?: React.ReactNode
  /** False when the narrow detail shows its own header. */
  header?: boolean
  /** Side by side when true (1280px and wider). */
  wide: boolean
  /** Narrow screens show the detail instead of the queue. */
  showDetail?: boolean
  list: React.ReactNode
  detail?: React.ReactNode
  className?: string
}) {
  const narrowDetail = showDetail && !wide
  return (
    <>
      {header && (
        <PageHeader title={title} heading={heading} actions={actions} helpContext={helpContext}>
          {tabs && <div className="-mx-1 w-full overflow-x-auto scrollbar-none">{tabs}</div>}
        </PageHeader>
      )}
      <div
        data-slot="inbox-page"
        className={cn("flex min-w-0 flex-1 flex-col gap-4", !narrowDetail && "p-4 md:p-6", className)}
      >
        {!narrowDetail && toolbar && (
          <div data-slot="inbox-toolbar" className="flex flex-wrap items-center gap-2">
            {toolbar}
          </div>
        )}
        {!narrowDetail && notices}
        <div className="grid min-w-0 flex-1 items-start gap-(--panel-gap) xl:grid-cols-[var(--split-list-width)_minmax(0,1fr)]">
          {!narrowDetail && <Panel className="xl:sticky xl:top-4">{list}</Panel>}
          {detail && (wide || narrowDetail) ? (
            // One element in both layouts so the detail (and its drafts) stays mounted across the breakpoint.
            <Panel className={narrowDetail ? "contents" : "min-h-64"}>{detail}</Panel>
          ) : null}
        </div>
      </div>
    </>
  )
}

const stripes: Record<StatusTone, string> = {
  good: "before:bg-success",
  warning: "before:bg-warning",
  critical: "before:bg-destructive",
  info: "before:bg-info",
  muted: "before:bg-transparent",
  commanded: "before:bg-commanded",
}

/** The queue: arrow keys and j/k move between items. */
export function InboxList({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  const ref = React.useRef<HTMLUListElement>(null)
  return (
    <ul
      ref={ref}
      aria-label={label}
      data-slot="inbox-list"
      className={cn("divide-y", className)}
      onKeyDown={(event) => {
        const forward = event.key === "ArrowDown" || event.key === "j"
        const backward = event.key === "ArrowUp" || event.key === "k"
        if (!forward && !backward) return
        if ((event.target as HTMLElement).closest("input,textarea,[contenteditable]")) return
        const links = [...(ref.current?.querySelectorAll<HTMLAnchorElement>("[data-inbox-link]") ?? [])]
        const index = links.indexOf(document.activeElement as HTMLAnchorElement)
        const next = links[index === -1 ? 0 : index + (forward ? 1 : -1)]
        if (!next) return
        event.preventDefault()
        next.focus()
      }}
    >
      {children}
    </ul>
  )
}

/** One queue item: a tone stripe, the title link, a mark and a meta line. */
export function InboxItem({
  to,
  title,
  tone = "muted",
  current = false,
  mark,
  meta,
  extra,
  select,
}: {
  to: To
  title: React.ReactNode
  tone?: StatusTone
  current?: boolean
  mark?: React.ReactNode
  meta?: React.ReactNode
  extra?: React.ReactNode
  select?: React.ReactNode
}) {
  return (
    <li
      data-slot="inbox-item"
      data-current={current || undefined}
      className={cn(
        "relative flex gap-3 px-4 py-3 before:absolute before:inset-y-0 before:left-0 before:w-0.5 hover:bg-muted/50",
        stripes[tone],
        current && "bg-accent hover:bg-accent",
      )}
    >
      {select && <div className="relative z-10 flex h-6 items-center">{select}</div>}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
        <Link
          to={to}
          data-inbox-link=""
          aria-current={current ? "page" : undefined}
          className="truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        >
          {title}
        </Link>
        {mark && <span className="text-meta">{mark}</span>}
        {meta && <span className="col-span-2 truncate text-meta text-muted-foreground">{meta}</span>}
        {extra && <span className="col-span-2 truncate text-meta text-muted-foreground">{extra}</span>}
      </div>
    </li>
  )
}
