import * as React from "react"

import { PageHeader } from "@iot-os/ui/components/page-header"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * Entity template: one record. The header names it (with its code), holds
 * actions, a line of status marks and at most five tabs. Notices that need
 * action come next, then the content: panels in a main column and, when given,
 * a properties rail on the right. Wrap the page in Tabs when it has tabs.
 */
export function EntityPage({
  title,
  icon,
  code,
  back,
  actions,
  status,
  tabs,
  helpContext,
  notices,
  rail,
  children,
  className,
}: {
  /** The record's name: the page h1 and the document title. */
  title: string
  icon?: React.ReactNode
  /** Identifier shown in mono after the name, e.g. a device code. */
  code?: React.ReactNode
  back?: { to: string; label: string }
  actions?: React.ReactNode
  /** Status marks under the title: lifecycle, presence, configuration, freshness. */
  status?: React.ReactNode
  /** A TabsList; keep to five tabs or fewer. */
  tabs?: React.ReactNode
  helpContext?: string
  notices?: React.ReactNode
  /** Panels for the properties rail; omit for full-width content. */
  rail?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <>
      <PageHeader
        title={title}
        heading={
          icon ? (
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-4">
                {icon}
              </span>
              <span className="truncate">{title}</span>
            </span>
          ) : undefined
        }
        back={back}
        meta={code ? <span className="font-mono text-code">{code}</span> : undefined}
        actions={actions}
        helpContext={helpContext}
      >
        {(status || tabs) && (
          <div className="flex w-full min-w-0 flex-col">
            {status && (
              <div
                data-slot="entity-status"
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-1 text-body"
              >
                {status}
              </div>
            )}
            {tabs && <div className="-mx-1 w-full overflow-x-auto scrollbar-none">{tabs}</div>}
          </div>
        )}
      </PageHeader>
      <div data-slot="entity-page" className={cn("flex min-w-0 flex-col gap-4 p-4 md:p-6", className)}>
        {notices}
        {rail ? (
          <div className="grid items-start gap-(--panel-gap) xl:grid-cols-[minmax(0,1fr)_var(--rail-width)]">
            <div className="flex min-w-0 flex-col gap-(--panel-gap)">{children}</div>
            <aside aria-label="Properties" className="flex min-w-0 flex-col gap-(--panel-gap)">
              {rail}
            </aside>
          </div>
        ) : (
          children
        )}
      </div>
    </>
  )
}

/** Label and value pairs for a properties panel. */
export function PropertyList({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode }[]
  className?: string
}) {
  return (
    <dl className={cn("grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 text-body", className)}>
      {items.map((item) => (
        <div key={item.label} className="col-span-2 grid grid-cols-subgrid border-b py-2 last:border-0">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
