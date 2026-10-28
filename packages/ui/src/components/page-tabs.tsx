import * as React from "react"
import { NavLink, type To } from "react-router-dom"

import { cn } from "@iot-os/ui/lib/utils"

/**
 * Tabs that are separate pages, such as Sites and Geofences under Locations.
 * They look like line tabs but are links, so each page keeps its own URL.
 */
export function PageTabs({
  label,
  items,
  className,
}: {
  label: string
  items: { to: To; label: string; end?: boolean }[]
  className?: string
}) {
  return (
    <nav aria-label={label} className={cn("-mx-1 flex w-full gap-1 overflow-x-auto px-1 scrollbar-none", className)}>
      {items.map((item) => (
        <NavLink
          key={String(item.to)}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              "relative inline-flex h-9 shrink-0 items-center px-2 text-body font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full",
              isActive && "text-primary hover:text-primary after:bg-primary",
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
