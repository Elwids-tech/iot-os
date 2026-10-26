import * as React from "react"
import { Link } from "react-router-dom"
import { ChevronLeftIcon } from "lucide-react"

import { cn } from "@iot-os/ui/lib/utils"
import { SidebarTrigger } from "@iot-os/ui/components/sidebar"
import { PageHelpContext } from "@iot-os/ui/components/page-help"

// The app name comes from index.html <title>: "IoT OS" (portal) or "IoT OS Admin".
const appName = document.title

/**
 * Page title row (the page h1) with optional back link, muted meta and right-aligned actions.
 * `children` render as a second row for tabs, filters or a time bar.
 * `heading` replaces the h1 content, e.g. a switcher menu trigger; `title` still names the tab.
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
              className="-ml-1 inline-flex h-7 items-center gap-1 rounded-sm px-1 text-sm whitespace-nowrap text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
          <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">{actions}{help?.trigger}</div>
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
