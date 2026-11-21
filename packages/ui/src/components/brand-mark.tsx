import * as React from "react"

import { cn } from "@iot-os/ui/lib/utils"

const heights = { sm: "h-5", md: "h-7", lg: "h-10" }
const squares = { sm: "size-5 text-micro", md: "size-7 text-meta", lg: "size-10 text-body" }

/** The first letter of the first word, with the last word's when `count` is 2. */
export function initialsOf(name: string, count: 1 | 2 = 1) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return "?"
  return (count === 1 || words.length === 1 ? words[0].slice(0, 1) : words[0].slice(0, 1) + words[words.length - 1].slice(0, 1)).toUpperCase()
}

/**
 * A brand or organization: its logo, the dark one on dark appearance when there is one,
 * else a square with its initial. The logo carries the name as its text alternative; pass
 * `showName` to write the name beside the initial when there is no logo.
 */
export function BrandMark({
  name,
  logo,
  logoDark,
  size = "sm",
  showName = false,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  name: string
  logo?: { url: string } | null
  logoDark?: { url: string } | null
  size?: keyof typeof heights
  showName?: boolean
}) {
  if (logo) {
    const image = cn(heights[size], "w-auto max-w-40 object-contain object-left")
    return (
      <span data-slot="brand-mark" data-kind="logo" className={cn("inline-flex min-w-0 shrink-0 items-center", className)} {...props}>
        <img src={logo.url} alt={name} className={cn(image, logoDark && "dark:hidden")} />
        {logoDark ? <img src={logoDark.url} alt={name} className={cn(image, "hidden dark:block")} /> : null}
      </span>
    )
  }

  return (
    <span data-slot="brand-mark" data-kind="initials" className={cn("inline-flex min-w-0 items-center gap-2", className)} {...props}>
      <span
        aria-hidden="true"
        className={cn("grid shrink-0 place-items-center rounded-sm bg-foreground font-semibold text-background", squares[size])}
      >
        {initialsOf(name)}
      </span>
      {showName ? <span className="truncate font-medium">{name}</span> : <span className="sr-only">{name}</span>}
    </span>
  )
}
