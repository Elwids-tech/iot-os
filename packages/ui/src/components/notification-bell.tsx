import * as React from "react"
import { BellIcon } from "lucide-react"
import { Link, type To } from "react-router-dom"

import { Button } from "@iot-os/ui/components/button"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Popover, PopoverContent, PopoverTrigger } from "@iot-os/ui/components/popover"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import type { StatusDomain } from "@iot-os/ui/lib/status"
import { cn } from "@iot-os/ui/lib/utils"

export type NotificationBellItem = {
  id: string
  title: React.ReactNode
  description?: React.ReactNode
  /** A raw status value, read through statusOf with `domain`. */
  status?: string
  domain?: StatusDomain
  time?: string | null
  /** A short note after the status, such as the condition now. */
  detail?: React.ReactNode
  to: To
  unread: boolean
}

/** The badge text: the count, or "9+" above nine. */
export const bellCount = (count: number) => (count > 9 ? "9+" : String(count))

/**
 * A page-header bell: an icon button with the unread count that opens a short list
 * of the person's notifications. Generic: the app maps its records to items and owns
 * fetching, marking read and any sound. A `count` of undefined (unknown, or the check
 * failed) shows no badge. Selecting an item follows its link and closes the list.
 */
function NotificationBell({
  label = "Notifications",
  count,
  open,
  onOpenChange,
  actions,
  toolbar,
  items,
  loading = false,
  error,
  empty,
  hasOlder = false,
  loadingOlder = false,
  onShowOlder,
  onSelect,
  footer,
  className,
}: {
  label?: string
  count: number | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Header actions, such as Mark all read. */
  actions?: React.ReactNode
  /** A row under the header, such as a sound switch. */
  toolbar?: React.ReactNode
  items: NotificationBellItem[]
  loading?: boolean
  /** Shown instead of the list when it could not load. */
  error?: React.ReactNode
  /** Shown when there is nothing to list. */
  empty?: React.ReactNode
  hasOlder?: boolean
  loadingOlder?: boolean
  onShowOlder?: () => void
  onSelect?: (item: NotificationBellItem) => void
  footer?: React.ReactNode
  className?: string
}) {
  const unread = count ?? 0
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-slot="notification-bell"
          aria-label={unread > 0 ? `${label}, ${unread} unread` : label}
          className={cn("relative", className)}
        >
          <BellIcon />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-micro leading-4 font-semibold text-primary-foreground tabular-nums"
            >
              {bellCount(unread)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={label}
        className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0"
      >
        <div className="flex min-h-11 items-center justify-between gap-2 border-b px-3 py-1.5">
          <h2 className="text-body font-medium">{label}</h2>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </div>
        {toolbar && <div className="border-b px-3 py-2">{toolbar}</div>}
        <div className="max-h-[min(26rem,60vh)] overflow-y-auto">
          {error ? (
            <div className="p-3 text-meta text-muted-foreground">{error}</div>
          ) : loading ? (
            <div className="flex flex-col gap-3 p-3" aria-busy="true">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            empty
          ) : (
            <ul className="flex flex-col py-1">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    to={item.to}
                    data-unread={item.unread || undefined}
                    onClick={() => {
                      onSelect?.(item)
                      onOpenChange(false)
                    }}
                    className="flex gap-2.5 px-3 py-2 outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                  >
                    <span
                      aria-hidden="true"
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.unread ? "bg-primary" : "bg-transparent")}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("min-w-0 truncate", item.unread && "font-medium")}>
                          {item.unread && <span className="sr-only">Unread: </span>}
                          {item.title}
                        </span>
                        {item.time !== undefined && (
                          <RelativeTime at={item.time} className="shrink-0 text-meta text-muted-foreground" />
                        )}
                      </span>
                      {item.description && (
                        <span className="truncate text-meta text-muted-foreground">{item.description}</span>
                      )}
                      {(item.status || item.detail) && (
                        <span className="flex flex-wrap items-center gap-x-2 text-meta text-muted-foreground">
                          {item.status && <Status value={item.status} domain={item.domain} className="text-foreground" />}
                          {item.detail}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {hasOlder && !error && !loading && (
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full" disabled={loadingOlder} onClick={onShowOlder}>
                {loadingOlder ? "Loading…" : "Show older"}
              </Button>
            </div>
          )}
        </div>
        {footer && <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-meta">{footer}</div>}
      </PopoverContent>
    </Popover>
  )
}

export { NotificationBell }
