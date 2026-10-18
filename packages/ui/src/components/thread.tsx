import * as React from "react"
import { FileTextIcon } from "lucide-react"

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@iot-os/ui/components/attachment"
import { Badge } from "@iot-os/ui/components/badge"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * A conversation with its history, oldest first: messages as cards and changes as
 * one-line events between them. Used by support tickets; the app maps its records
 * to `ThreadMessage` and `ThreadEvent`.
 */
function Thread({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      data-slot="thread"
      className={cn("relative flex min-w-0 flex-col gap-3", className)}
      {...props}
    />
  )
}

/**
 * One message. `internal` marks a note only part of the audience sees; `badge`
 * names the author's role (for example "Team").
 */
function ThreadMessage({
  author,
  badge,
  at,
  internal = false,
  internalLabel = "Internal note",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"li">, "children"> & {
  author: React.ReactNode
  badge?: React.ReactNode
  at: string
  internal?: boolean
  internalLabel?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <li
      data-slot="thread-message"
      data-internal={internal || undefined}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-4 py-3",
        internal && "border-dashed border-warning/60 bg-warning/5",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta">
        <span className="truncate font-medium text-foreground">{author}</span>
        {badge && <Badge variant="secondary">{badge}</Badge>}
        {internal && <Badge variant="warning">{internalLabel}</Badge>}
        <RelativeTime at={at} className="ml-auto text-muted-foreground" />
      </div>
      {children}
    </li>
  )
}

/** A change, such as a new status or a person added, between messages. */
function ThreadEvent({
  icon,
  at,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"li">, "children"> & {
  icon?: React.ReactNode
  at: string
  children: React.ReactNode
}) {
  return (
    <li
      data-slot="thread-event"
      className={cn(
        "flex min-w-0 items-center gap-2 px-4 text-meta text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      <RelativeTime at={at} className="shrink-0" />
    </li>
  )
}

export type ThreadFile = {
  id: string
  name: string
  mime: string
  size: number
  /** Where the browser opens or downloads the file. */
  href: string
}

/** "2.4 MB", "830 KB". */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Files on a message: images as thumbnails that open full size, anything else as a
 * chip that downloads.
 */
function ThreadFiles({ files, className }: { files: ThreadFile[]; className?: string }) {
  if (files.length === 0) return null
  return (
    <AttachmentGroup data-slot="thread-files" className={className}>
      {files.map((file) => {
        const image = file.mime.startsWith("image/")
        return (
          <Attachment key={file.id} size="sm" orientation={image ? "vertical" : "horizontal"}>
            <AttachmentMedia variant={image ? "image" : "icon"}>
              {image ? <img src={file.href} alt="" loading="lazy" /> : <FileTextIcon />}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
              <AttachmentDescription>{formatBytes(file.size)}</AttachmentDescription>
            </AttachmentContent>
            <AttachmentTrigger asChild>
              <a href={file.href} target="_blank" rel="noreferrer noopener" aria-label={`Open ${file.name}`} />
            </AttachmentTrigger>
          </Attachment>
        )
      })}
    </AttachmentGroup>
  )
}

export { Thread, ThreadEvent, ThreadFiles, ThreadMessage }
