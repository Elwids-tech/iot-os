import * as React from "react"
import {
  CircleDotIcon,
  FilePlusIcon,
  FlagIcon,
  LogOutIcon,
  PencilIcon,
  TagIcon,
  UserCheckIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react"

import { Markdown } from "@iot-os/ui/components/markdown"
import { Status } from "@iot-os/ui/components/status-mark"
import { Thread, ThreadEvent, ThreadFiles, ThreadMessage } from "@iot-os/ui/components/thread"

type Person = { id: number; name: string }

/** One entry of a support ticket's timeline, as the API returns it (spec 015). */
export type TicketThreadItem = {
  type: "message" | "event"
  key: string
  created_at: string
  actor: Person | null
  from_team: boolean
  internal: boolean
  body: string | null
  attachments: { uuid: string; name: string; mime: string; size: number }[]
  event: string | null
  from: string | Person | null
  to: string | Person | null
  cause: string | null
}

export const ticketTypeLabels: Record<string, string> = {
  bug: "Bug",
  feature_request: "Feature request",
  improvement: "Improvement",
}

const icons: Record<string, React.ReactNode> = {
  created: <FilePlusIcon />,
  status: <CircleDotIcon />,
  type: <TagIcon />,
  title: <PencilIcon />,
  priority: <FlagIcon />,
  assignee: <UserCheckIcon />,
  participant_added: <UserPlusIcon />,
  participant_removed: <UserMinusIcon />,
  participant_left: <LogOutIcon />,
}

const nameOf = (value: string | Person | null) => (value && typeof value === "object" ? value.name : null)
const textOf = (value: string | Person | null) => (typeof value === "string" ? value : "")

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>
}

/** "Ana changed the status from New to In review", as a sentence with marks. */
function describe(item: TicketThreadItem): React.ReactNode {
  const actor = <Strong>{item.actor?.name ?? "Someone"}</Strong>
  switch (item.event) {
    case "created":
      return <>{actor} filed this ticket</>
    case "status":
      if (item.cause === "reply")
        return (
          <>
            {actor}'s reply {item.from === "resolved" ? "reopened the ticket" : "moved it"} to{" "}
            <Status value={textOf(item.to)} domain="ticket" />
          </>
        )
      return (
        <>
          {actor} changed the status from <Status value={textOf(item.from)} domain="ticket" /> to{" "}
          <Status value={textOf(item.to)} domain="ticket" />
        </>
      )
    case "type":
      return (
        <>
          {actor} changed the type from {ticketTypeLabels[textOf(item.from)] ?? textOf(item.from)} to{" "}
          <Strong>{ticketTypeLabels[textOf(item.to)] ?? textOf(item.to)}</Strong>
        </>
      )
    case "title":
      return (
        <>
          {actor} renamed the ticket from “{textOf(item.from)}” to <Strong>“{textOf(item.to)}”</Strong>
        </>
      )
    case "priority":
      return (
        <>
          {actor} set the priority to <Status value={textOf(item.to)} domain="priority" />
        </>
      )
    case "assignee":
      return nameOf(item.to) ? (
        <>
          {actor} assigned <Strong>{nameOf(item.to)}</Strong>
        </>
      ) : (
        <>
          {actor} unassigned <Strong>{nameOf(item.from)}</Strong>
        </>
      )
    case "participant_added":
      return (
        <>
          {actor} added <Strong>{nameOf(item.to)}</Strong>
        </>
      )
    case "participant_removed":
      return (
        <>
          {actor} removed <Strong>{nameOf(item.from)}</Strong>
        </>
      )
    case "participant_left":
      return <>{actor} left the ticket</>
    default:
      return <>{actor} changed the ticket</>
  }
}

/**
 * A support ticket's conversation and history (spec 015), shared by the portal and
 * the admin app. `fileHref` turns an attachment into its authorized download URL.
 */
function TicketThread({
  items,
  fileHref,
  className,
}: {
  items: TicketThreadItem[]
  fileHref: (attachment: string) => string
  className?: string
}) {
  return (
    <Thread aria-label="Conversation and history" className={className}>
      {items.map((item) =>
        item.type === "message" ? (
          <ThreadMessage
            key={item.key}
            author={item.actor?.name ?? "Former user"}
            badge={item.from_team ? "Team" : undefined}
            internal={item.internal}
            at={item.created_at}
          >
            {item.body ? <Markdown>{item.body}</Markdown> : null}
            <ThreadFiles
              files={item.attachments.map((file) => ({ id: file.uuid, name: file.name, mime: file.mime, size: file.size, href: fileHref(file.uuid) }))}
            />
          </ThreadMessage>
        ) : (
          <ThreadEvent key={item.key} at={item.created_at} icon={icons[item.event ?? ""] ?? <CircleDotIcon />}>
            {describe(item)}
          </ThreadEvent>
        ),
      )}
    </Thread>
  )
}

export { TicketThread }
