import * as React from "react"

import { PageHeader } from "@iot-os/ui/components/page-header"
import { ViewsRail, type RailItem } from "@iot-os/ui/components/views-rail"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * Settings template: section navigation on the left and the section on the
 * right. Form sections keep to max-w-form; list sections (members, roles)
 * use the full width and an embedded CollectionPage.
 */
export function SettingsPage({
  title = "Settings",
  sections,
  helpContext,
  children,
  className,
}: {
  title?: string
  sections: RailItem[]
  helpContext?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <>
      <PageHeader title={title} helpContext={helpContext} />
      <div
        data-slot="settings-page"
        className={cn("grid min-w-0 gap-4 p-4 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6 md:p-6", className)}
      >
        <ViewsRail label="Settings sections" items={sections} />
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
      </div>
    </>
  )
}
