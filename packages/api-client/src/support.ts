/** Support tickets (spec 015). */
export type TicketType = "bug" | "feature_request" | "improvement"
export type TicketStatus = "new" | "in_review" | "needs_info" | "planned" | "in_progress" | "resolved" | "declined"
export type TicketPriority = "low" | "normal" | "high" | "urgent"
export type TicketEventKind =
  | "created"
  | "status"
  | "priority"
  | "type"
  | "title"
  | "assignee"
  | "participant_added"
  | "participant_removed"
  | "participant_left"

export const ticketTypes: { value: TicketType; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "feature_request", label: "Feature request" },
  { value: "improvement", label: "Improvement" },
]
export const ticketStatuses: TicketStatus[] = ["new", "in_review", "needs_info", "planned", "in_progress", "resolved", "declined"]
export const openTicketStatuses: TicketStatus[] = ["new", "in_review", "needs_info", "planned", "in_progress"]
export const ticketPriorities: TicketPriority[] = ["low", "normal", "high", "urgent"]

export type TicketPersonRef = { id: number; name: string }
export type TicketContext = { path: string | null; user_agent: string | null; screen: string | null; time_zone: string | null }
export type TicketAttachment = { uuid: string; name: string; mime: string; size: number }

/** One timeline entry: a message, or a change with its old and new value. */
export type TicketTimelineItem = {
  type: "message" | "event"
  key: string
  created_at: string
  actor: TicketPersonRef | null
  from_team: boolean
  internal: boolean
  body: string | null
  attachments: TicketAttachment[]
  event: TicketEventKind | null
  from: string | TicketPersonRef | null
  to: string | TicketPersonRef | null
  cause: string | null
}

export type TicketPerson = TicketPersonRef & { email: string; role: "reporter" | "participant" }

/** A ticket in your Support list. */
export type TicketSummary = {
  uuid: string
  number: number
  title: string
  type: TicketType
  status: TicketStatus
  role: "reporter" | "participant"
  reporter: TicketPersonRef
  unread: boolean
  last_activity_at: string
  created_at: string
  closed_at: string | null
}

/** A ticket as its reporter and participants see it. */
export type Ticket = {
  uuid: string
  number: number
  title: string
  type: TicketType
  status: TicketStatus
  organization: { uuid: string; name: string } | null
  revision: number
  /** Pass to the read endpoint so activity after this stays unread. */
  sequence: number
  context: TicketContext
  last_activity_at: string
  created_at: string
  closed_at: string | null
  people: TicketPerson[]
  timeline: TicketTimelineItem[]
  abilities: { reply: boolean; close: boolean; edit_title: boolean; manage_people: boolean; leave: boolean }
}

/** A ticket in the team's queue. */
export type AdminTicketSummary = {
  uuid: string
  number: number
  title: string
  type: TicketType
  status: TicketStatus
  priority: TicketPriority
  organization: { uuid: string; name: string } | null
  reporter: TicketPersonRef & { email: string }
  assignee: TicketPersonRef | null
  awaiting_team: boolean
  unread: boolean
  last_activity_at: string
  created_at: string
  closed_at: string | null
}

/** A ticket as the team sees it, internal notes included. */
export type AdminTicket = Omit<Ticket, "abilities"> & {
  priority: TicketPriority
  assignee: TicketPersonRef | null
  awaiting_team: boolean
}

export type TicketPage<T> = {
  data: T[]
  meta: { current_page: number; last_page: number; total: number; per_page: number; awaiting?: number }
}

export type TicketFiling = {
  client_id: string
  type: TicketType
  title: string
  body: string
  context: Partial<TicketContext>
}

export type TicketCandidate = { id: number; name: string; email: string }

export type AdminTicketChanges = {
  revision: number
  status?: TicketStatus
  priority?: TicketPriority
  type?: TicketType
  title?: string
  assignee_id?: number | null
}
