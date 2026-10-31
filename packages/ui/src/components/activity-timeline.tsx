import * as React from "react"
import { ArrowRightIcon } from "lucide-react"

import { RelativeTime } from "@iot-os/ui/components/freshness"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * An audit timeline: what people did, newest first, under a heading per day. Each
 * entry has the person's initials on a rail, one sentence, a meta line (where, when)
 * and what changed. Used by the admin app's Activity page (spec 024); the app maps
 * its events to `ActivityItem` and groups them with `groupByDay`.
 */
function ActivityTimeline({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="activity-timeline" className={cn("flex min-w-0 flex-col gap-6", className)} {...props} />
}

/** One day's entries under a sticky heading such as "Today" or "Fri 30 Oct". */
function ActivityDay({
  label,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "children"> & { label: React.ReactNode; children: React.ReactNode }) {
  const id = React.useId()
  return (
    <section data-slot="activity-day" aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-1", className)} {...props}>
      <h3 id={id} className="sticky top-0 z-10 bg-card py-1 text-meta font-medium text-muted-foreground">
        {label}
      </h3>
      <ol className="flex min-w-0 flex-col">{children}</ol>
    </section>
  )
}

/** "AS" for "Ana Silva", "?" when there is no name. */
function initialsOf(name: string | null | undefined) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/**
 * One entry. `actor` names the person (initials come from it); `children` is the
 * sentence, `meta` sits before the time, and `changes` (an `ActivityChanges`) under it.
 */
function ActivityItem({
  actor,
  at,
  now,
  meta,
  changes,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"li">, "children"> & {
  actor: string | null
  at: string
  /** A fixed clock for stories and tests. */
  now?: number
  meta?: React.ReactNode
  changes?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li data-slot="activity-item" className={cn("group/activity relative flex min-w-0 gap-3 pb-4 last:pb-0", className)} {...props}>
      {/* The rail joins entries of the same day; the last one ends at its avatar. */}
      <span aria-hidden="true" className="absolute top-8 bottom-0 left-3.5 w-px bg-border group-last/activity:hidden" />
      <span
        aria-hidden="true"
        className="relative grid size-7 shrink-0 place-items-center rounded-full border bg-muted text-micro font-semibold text-foreground"
      >
        {initialsOf(actor)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
        <p className="min-w-0 text-body break-words">{children}</p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
          {meta}
          <RelativeTime at={at} now={now} />
        </p>
        {changes}
      </div>
    </li>
  )
}

export type ActivityChangeValue = string | string[] | null

export type ActivityChangeRow = {
  /** The field as people read it, such as "Name". */
  label: string
  from: ActivityChangeValue
  to: ActivityChangeValue
  /** Only the fact that the field changed is known. */
  opaque?: boolean
}

function Value({ value }: { value: string | null }) {
  if (value === null || value === "") return <span className="text-muted-foreground italic">empty</span>
  return <span className="break-words text-foreground">{value}</span>
}

/** Items added to and removed from a list, such as roles or permissions. */
function ListChange({ from, to }: { from: string[]; to: string[] }) {
  const added = to.filter((item) => !from.includes(item))
  const removed = from.filter((item) => !to.includes(item))
  if (added.length === 0 && removed.length === 0) return <span className="text-muted-foreground">reordered</span>
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {added.map((item) => (
        <span key={"+" + item} className="rounded-sm bg-success/10 px-1 text-success">
          <span className="sr-only">added </span>+ {item}
        </span>
      ))}
      {removed.map((item) => (
        <span key={"-" + item} className="rounded-sm bg-destructive/10 px-1 text-destructive line-through">
          <span className="sr-only">removed </span>− {item}
        </span>
      ))}
    </span>
  )
}

/** What an edit changed: old → new for values, added and removed items for lists. */
function ActivityChanges({ changes, className }: { changes: ActivityChangeRow[]; className?: string }) {
  if (changes.length === 0) return null
  return (
    <dl
      data-slot="activity-changes"
      className={cn("grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-sunken px-3 py-2 text-meta", className)}
    >
      {changes.map((change) => (
        <React.Fragment key={change.label}>
          <dt className="text-muted-foreground">{change.label}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5">
            {change.opaque ? (
              <span className="text-muted-foreground">changed</span>
            ) : Array.isArray(change.from) || Array.isArray(change.to) ? (
              <ListChange from={asList(change.from)} to={asList(change.to)} />
            ) : (
              <>
                <Value value={change.from} />
                <ArrowRightIcon aria-label="to" className="size-3 shrink-0 text-muted-foreground" />
                <Value value={change.to} />
              </>
            )}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

function asList(value: ActivityChangeValue): string[] {
  if (value === null || value === "") return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Groups items, already newest first, into days in the browser's time zone:
 * "Today", "Yesterday", then "Fri 30 Oct" (with the year when it is not this year).
 */
function groupByDay<T>(items: T[], at: (item: T) => string, now = Date.now()) {
  const days: { key: string; label: string; items: T[] }[] = []
  const today = new Date(now)
  const yesterday = new Date(now - 86_400_000)
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

  for (const item of items) {
    const date = new Date(at(item))
    const key = date.toDateString()
    let day = days[days.length - 1]
    if (!day || day.key !== key) {
      const label = sameDay(date, today)
        ? "Today"
        : sameDay(date, yesterday)
          ? "Yesterday"
          : date.toLocaleDateString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
            })
      day = { key, label, items: [] }
      days.push(day)
    }
    day.items.push(item)
  }

  return days
}

export { ActivityChanges, ActivityDay, ActivityItem, ActivityTimeline, groupByDay, initialsOf }
