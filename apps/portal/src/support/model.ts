import { useQuery } from "@tanstack/react-query"
import type { TicketType } from "@iot-os/api-client"
import { api } from "../lib/api"

export const supportPath = (org: string, rest = "") => `/organizations/${encodeURIComponent(org)}/support${rest}`

/** The new ticket form, opened for a type and remembering the page it came from. */
export const newTicketPath = (org: string, type?: TicketType, from?: string) => {
  const query = new URLSearchParams()
  if (type) query.set("type", type)
  if (from && !from.includes("/support")) query.set("from", from)
  const search = query.toString()
  return supportPath(org, `/new${search ? `?${search}` : ""}`)
}

/** Unread tickets for the sidebar badge, refreshed every minute. */
export function useSupportUnread(org: string | undefined) {
  return useQuery({
    queryKey: ["support-summary", org],
    queryFn: () => api.ticketSummary(org!),
    enabled: Boolean(org),
    refetchInterval: 60_000,
    staleTime: 30_000,
  }).data?.unread ?? 0
}

/** A fresh id per submission, so a retried request files one ticket or reply. */
export function clientId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  // randomUUID needs a secure context; plain-HTTP hosts fall back to a v4 UUID by hand.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * A title and description another page hands to the form in `location.state.draft`, such
 * as the dashboard assistant's feature request. Draft text never goes in the URL.
 */
export function ticketDraft(state: unknown): { title: string; body: string } {
  const draft = state && typeof state === "object" ? (state as { draft?: unknown }).draft : undefined
  const values = draft && typeof draft === "object" ? (draft as Record<string, unknown>) : {}
  return {
    title: typeof values.title === "string" ? values.title.slice(0, 150) : "",
    body: typeof values.body === "string" ? values.body : "",
  }
}

/** What the form records about where the reporter was. */
export function browserContext(path: string) {
  return {
    path: path.startsWith("/") ? path.slice(0, 500) : null,
    user_agent: navigator.userAgent.slice(0, 500),
    screen: `${window.screen.width}x${window.screen.height}`,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
  }
}

/** What each type of ticket should say, shown in the empty description. */
export const ticketGuidance: Record<TicketType, string> = {
  bug: "What happened, what you expected instead, and the steps to make it happen again.",
  feature_request: "The problem you want solved, and what would help.",
  improvement: "What could be better, and how it would help you.",
}
