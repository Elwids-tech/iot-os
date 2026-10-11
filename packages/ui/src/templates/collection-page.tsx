import * as React from "react"

import { PageHeader } from "@iot-os/ui/components/page-header"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * Collection template: a list of things. The header names the page and holds
 * one primary action; notices (callouts that need action) come next; then a
 * DataTable, whose toolbar sits on the canvas and whose rows sit in a panel.
 * Views, folders and other slices belong in the DataTable's views and filters,
 * never in a side rail. Pages pass content only: the template owns widths,
 * gutters and gaps.
 */
export function CollectionPage({
  title,
  description,
  actions,
  helpContext,
  tabs,
  notices,
  children,
  className,
  embedded = false,
}: {
  /** Inside another template (Settings): a section heading instead of the page header, no gutters. */
  embedded?: boolean
  title: string
  /** A TabsList under the title when one page holds sibling collections; wrap the page in Tabs. */
  tabs?: React.ReactNode
  /** One sentence under the title when the page needs explaining. */
  description?: React.ReactNode
  /** The primary action, such as "Add device". */
  actions?: React.ReactNode
  helpContext?: string
  notices?: React.ReactNode
  /** The DataTable, or an EmptyState when the viewer has no access. */
  children: React.ReactNode
  className?: string
}) {
  if (embedded)
    return (
      <section aria-labelledby="collection-heading" data-slot="collection-page" className={cn("flex min-w-0 flex-col gap-4", className)}>
        <div className="flex flex-col gap-1">
          <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
            <h2 id="collection-heading" className="text-title">
              {title}
            </h2>
            {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
          </div>
          {description && <p className="text-body text-muted-foreground">{description}</p>}
          {tabs && <div className="border-b">{tabs}</div>}
        </div>
        {notices}
        {children}
      </section>
    )
  return (
    <>
      <PageHeader title={title} meta={description} actions={actions} helpContext={helpContext}>
        {tabs}
      </PageHeader>
      <div data-slot="collection-page" className={cn("flex min-w-0 flex-col gap-4 p-4 md:p-6", className)}>
        {notices}
        {children}
      </div>
    </>
  )
}
