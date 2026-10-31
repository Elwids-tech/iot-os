/** The activity log (spec 024, ADR-028): what people did across the platform. */

/** One changed field. Lists keep their items; `opaque` means only that the field changed is recorded. */
export type ActivityFieldChange = {
  field: string
  from: string | string[] | null
  to: string | string[] | null
  opaque: boolean
}

/** One thing a person did. `summary` reads between the actor's name and the subject's name. */
export type ActivityEvent = {
  id: number
  /** The action code, for example `device.updated`. */
  action: string
  /** The action in words, for example "updated device". */
  summary: string
  at: string
  /** The person, by integer user id (ADR-013); name and email are null when the user was deleted. */
  actor: { id: number; name: string | null; email: string | null }
  /** The organization whose data changed; null at platform level. */
  organization: { uuid: string; name: string } | null
  /** What was acted on: kind (such as `device` or `role`), UUID and name, each possibly null. */
  subject: { type: string | null; uuid: string | null; name: string | null } | null
  changes: ActivityFieldChange[]
  /** What the action recorded besides its changes, as text. */
  details: { key: string; value: string }[]
}

/** One page of the activity feed, newest first; `next_cursor` is null on the last page. */
export type ActivityPage = {
  data: ActivityEvent[]
  meta: { per_page: number; next_cursor: string | null }
}

export type ActivityQuery = {
  /** The person who acted. */
  userId?: number
  /** The organization's UUID. */
  organization?: string
  cursor?: string | null
}
