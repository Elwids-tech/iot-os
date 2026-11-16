import * as React from "react"
import { Link } from "react-router-dom"
import { ChevronLeftIcon, EllipsisIcon } from "lucide-react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@iot-os/ui/lib/utils"
import { Button } from "@iot-os/ui/components/button"
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
 * Phones: the actions other than the one kept in view, behind **More actions**. The list stays mounted
 * while closed (only hidden), so a dialog an action opens outlives the list closing.
 */
function MoreActions({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="More actions">
          <EllipsisIcon />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal forceMount>
        <PopoverPrimitive.Content
          forceMount
          align="end"
          sideOffset={4}
          collisionPadding={8}
          aria-label="More actions"
          data-slot="page-header-more"
          // Choosing an action closes the list; a dialog it opens stays mounted.
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button,a")) setOpen(false)
          }}
          className={cn(
            "z-50 flex w-56 max-w-[calc(100vw-1rem)] flex-col gap-1 rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-raised outline-hidden data-[state=closed]:hidden",
            "*:w-full *:justify-start [&_[data-slot=button]]:w-full [&_[data-slot=button]]:justify-start",
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/**
 * Page title row (the page h1) with optional back link, muted meta and right-aligned actions.
 * `children` render as a second row for tabs, filters or a time bar.
 * `heading` replaces the h1 content, e.g. a switcher menu trigger; `title` still names the tab.
 * Phones (under 768 px) keep one action in view, the primary `Button` or else the first,
 * and put the rest behind **More actions**; the menu button and the help slot (bell,
 * Assistant, Help) always stay visible.
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

  return (
    <header data-slot="page-header" className={cn("border-b", className)}>
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:flex-nowrap md:px-6">
        <SidebarTrigger className="-ml-1 md:hidden" />
        {back && (
          <>
            <Link
              to={back.to}
              className="-ml-1 inline-flex h-7 items-center max-md:min-h-11 max-md:min-w-11 max-md:justify-center gap-1 rounded-sm px-1 text-sm whitespace-nowrap text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeftIcon className="size-4" />
              <span className="sr-only">Back to </span>
              <span className="max-md:sr-only">{back.label}</span>
            </Link>
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
            {phone && rest.length ? (
              <>
                {kept}
                <MoreActions>{rest}</MoreActions>
              </>
            ) : (
              actions
            )}
            {help?.trigger}
          </div>
        )}
      </div>
      {children && (
        <div className="flex min-h-10 flex-wrap items-center gap-2 border-t px-4 py-1 md:px-6">
          {children}
        </div>
      )}
    </header>
  )
}
