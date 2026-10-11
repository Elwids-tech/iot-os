import * as React from "react"

import { PageHeader } from "@iot-os/ui/components/page-header"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * Workspace template: an editor for something visual or versioned. The
 * header holds the back link, the name (often editable in place), the
 * primary actions, then a row with tools on the left and the DraftBar on the
 * right. The body runs full width so canvases, maps and consoles get room.
 */
export function WorkspacePage({
  title,
  name,
  back,
  helpContext,
  actions,
  tools,
  draft,
  notices,
  children,
  className,
}: {
  /** Document title and the h1 text for assistive tech. */
  title: string
  /** Visible name in the header, such as an InlineName; defaults to the title. */
  name?: React.ReactNode
  back?: { to: string; label: string }
  helpContext?: string
  actions?: React.ReactNode
  /** Undo, redo, assistant and other editor tools. */
  tools?: React.ReactNode
  /** A DraftBar. */
  draft?: React.ReactNode
  notices?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <>
      <PageHeader
        title={title}
        heading={
          name ? (
            <>
              <span className="sr-only">{title}</span>
              {name}
            </>
          ) : undefined
        }
        back={back}
        actions={actions}
        helpContext={helpContext}
      >
        {(tools || draft) && (
          <div data-slot="workspace-tools" className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 py-0.5">
            {tools && <div className="flex flex-wrap items-center gap-2">{tools}</div>}
            {draft && <div className="ml-auto">{draft}</div>}
          </div>
        )}
      </PageHeader>
      <div data-slot="workspace-page" className={cn("flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6", className)}>
        {notices}
        {children}
      </div>
    </>
  )
}
