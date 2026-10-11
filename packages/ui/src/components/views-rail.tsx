import * as React from "react"
import { Link, type To } from "react-router-dom"

import { cn } from "@iot-os/ui/lib/utils"

export type RailItem = {
  key: string
  label: string
  to: To
  current?: boolean
  count?: number
  icon?: React.ReactNode
}

/**
 * Section navigation beside a page, such as the Settings sections: a vertical list on wide screens and a
 * scrolling strip on phones. Sections group items under a small label, such
 * as Folders. The current item carries aria-current="page".
 */
export function ViewsRail({
  label,
  items,
  sections = [],
  className,
}: {
  label: string
  items: RailItem[]
  sections?: { title: string; items: RailItem[] }[]
  className?: string
}) {
  const link = (item: RailItem) => (
    <Link
      key={item.key}
      to={item.to}
      aria-current={item.current ? "page" : undefined}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-body whitespace-nowrap text-muted-foreground outline-none hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:w-full",
        item.current && "bg-card font-medium text-foreground shadow-panel",
      )}
    >
      {item.icon}
      <span className="truncate">{item.label}</span>
      {item.count !== undefined && (
        <span className="ml-auto pl-2 text-meta text-muted-foreground tabular-nums">{item.count}</span>
      )}
    </Link>
  )
  return (
    <nav
      aria-label={label}
      data-slot="views-rail"
      className={cn(
        "flex gap-1 overflow-x-auto scrollbar-none md:flex-col md:overflow-visible",
        className,
      )}
    >
      {items.map(link)}
      {sections.map(
        (section) =>
          section.items.length > 0 && (
            <React.Fragment key={section.title}>
              <h2 className="skin-label mt-4 hidden px-2 text-meta text-muted-foreground md:block">
                {section.title}
              </h2>
              {section.items.map(link)}
            </React.Fragment>
          ),
      )}
    </nav>
  )
}
