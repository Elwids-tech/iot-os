import * as React from "react"
import { Link } from "react-router-dom"
import { ChevronLeftIcon, EllipsisIcon } from "lucide-react"

import { cn } from "@iot-os/ui/lib/utils"
import { Button } from "@iot-os/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@iot-os/ui/components/popover"
import { SidebarTrigger } from "@iot-os/ui/components/sidebar"
import { PageHelpContext } from "@iot-os/ui/components/page-help"
import { useIsMobile } from "@iot-os/ui/hooks/use-mobile"

// The app name comes from index.html <title>: "IoT OS" (portal) or "IoT OS Admin".
const appName = document.title

/** Each action of `actions`, with fragments opened up and empty slots dropped. */
function actionList(node: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(node).flatMap((child) =>
    React.isValidElement<{ children?: React.ReactNode }>(child) && child.type === React.Fragment
      ? actionList(child.props.children)
      : [child],
  )
}

/** A primary action: a kit `Button` with the default variant. */
const isPrimary = (node: React.ReactNode) =>
  React.isValidElement<{ variant?: string | null }>(node) &&
  node.type === Button &&
  (node.props.variant ?? "default") === "default"

/**
 * Phones: the actions other than the one kept in view, behind **More actions**. Choosing
 * one closes the list, except an action that opens its own dialog or menu
 * (`aria-haspopup`): that opens above the list, which Radix treats as inside it, so the
 * dialog stays mounted.
 */
function MoreActions({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="More actions">
          <EllipsisIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        aria-label="More actions"
        data-slot="page-header-more"
        onClick={(event) => {
          // React bubbles clicks from portals (a dialog an action opened); only the list's own count.
          if (!event.currentTarget.contains(event.target as Node)) return
          const chosen = (event.target as HTMLElement).closest("button, a")
          if (chosen && !chosen.hasAttribute("aria-haspopup")) setOpen(false)
        }}
        className="w-56 max-w-[calc(100vw-1rem)] gap-1 p-1 *:w-full *:justify-start [&_[data-slot=button]]:w-full [&_[data-slot=button]]:justify-start [&_[data-slot=button]]:gap-2"
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Page title row (the page h1) with optional back link, muted meta and right-aligned actions.
 * `children` render as a second row for tabs, filters or a time bar.
 * `heading` replaces the h1 content, e.g. a switcher menu trigger; `title` still names the tab.
 * Phones (under 768 px) get an app bar: menu, back, title and the help slot (bell,
 * Assistant, Help) on the first row, then meta and actions. One action stays in view,
 * the primary `Button` or else the first, and the rest go behind **More actions**.
 */
export function PageHeader({
  title,
  heading,
  back,
  meta,
  actions,
  children,
  className,
  helpContext,
}: {
  title: string
  heading?: React.ReactNode
  back?: { to: string; label: string }
  meta?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
  helpContext?: string
}) {
  const help = React.useContext(PageHelpContext)
  const phone = useIsMobile()
  const listed = phone ? actionList(actions) : []
  const keep = Math.max(0, listed.findIndex(isPrimary))
  const kept = listed[keep]
  const rest = listed.filter((_, index) => index !== keep)
  const onHelpContextChange = help?.onContextChange
  React.useEffect(() => {
    if (!helpContext || !onHelpContextChange) return
    onHelpContextChange(helpContext)
    return () => onHelpContextChange(undefined)
  }, [helpContext, onHelpContextChange])
  React.useEffect(() => {
    document.title = `${title} · ${appName}`
    return () => {
      document.title = appName
    }
  }, [title])

  const backLink = back && (
    <Link
      to={back.to}
      className="-ml-1 inline-flex h-7 items-center max-md:min-h-11 max-md:min-w-11 max-md:justify-center gap-1 rounded-sm px-1 text-sm whitespace-nowrap text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeftIcon className="size-4" />
      <span className="sr-only">Back to </span>
      <span className="max-md:sr-only">{back.label}</span>
    </Link>
  )

  // Phones: an app bar. The menu, back and the help slot (bell, Assistant, Help) keep the
  // same places on every page, the title takes the rest and wraps to a second line, and
  // meta and actions share a row under it.
  if (phone)
    return (
      <header data-slot="page-header" className={cn("border-b", className)}>
        {/* The title keeps at least 5.5 rem; when that does not fit (large text), the help slot wraps under it. */}
        <div className="flex min-h-14 flex-wrap items-center px-1 py-1.5">
          <SidebarTrigger />
          {backLink}
          <h1 className="line-clamp-3 min-w-0 flex-1 basis-22 px-1 text-base leading-snug font-semibold tracking-tight">
            {heading ?? title}
          </h1>
          {help?.trigger && <div className="ml-auto flex shrink-0 items-center">{help.trigger}</div>}
        </div>
        {(meta || listed.length > 0) && (
          <div className="-mt-1 flex min-h-11 flex-wrap items-center gap-2 px-4 pb-2">
            {meta && <div className="min-w-0 flex-1 truncate text-meta text-muted-foreground">{meta}</div>}
            {listed.length > 0 && (
              <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
                {kept}
                {rest.length > 0 && <MoreActions>{rest}</MoreActions>}
              </div>
            )}
          </div>
        )}
        {children && <div className="flex min-h-10 flex-wrap items-center gap-2 border-t px-4 py-1">{children}</div>}
        {help?.notice}
      </header>
    )

  return (
    <header data-slot="page-header" className={cn("border-b", className)}>
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:flex-nowrap md:px-6">
        <SidebarTrigger className="-ml-1 md:hidden" />
        {back && (
          <>
            {backLink}
            <span aria-hidden="true" className="h-4 w-px bg-border max-md:hidden" />
          </>
        )}
        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">
          {heading ?? title}
        </h1>
        {meta && (
          <div className="min-w-0 truncate text-sm text-muted-foreground">
            {meta}
          </div>
        )}
        {(actions || help) && (
          // Wraps rather than widening the page when the actions outgrow a phone screen.
          <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
            {help?.trigger}
          </div>
        )}
      </div>
      {children && (
        <div className="flex min-h-10 flex-wrap items-center gap-2 border-t px-4 py-1 md:px-6">
          {children}
        </div>
      )}
      {help?.notice}
    </header>
  )
}
