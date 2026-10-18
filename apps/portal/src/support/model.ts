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

/** What the form records about where the reporter was. */
export function browserContext(path: string) {
  return {
    path: path.startsWith("/") ? path.slice(0, 500) : null,
    user_agent: navigator.userAgent.slice(0, 500),
    screen: `${window.screen.width}x${window.screen.height}`,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
  }
}

export const ticketTemplates: Record<TicketType, string> = {
  bug: "**What happened**\n\n\n**What you expected**\n\n\n**Steps to reproduce**\n1. \n",
  feature_request: "**The problem**\n\n\n**What would help**\n\n",
  improvement: "**What could be better**\n\n\n**What would help**\n\n",
}
