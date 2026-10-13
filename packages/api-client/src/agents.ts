/** AI agent access (spec 004): people connect MCP clients such as Claude to one organization. */

/** The organization's switch and whether the signed-in person may change it. */
export type AgentCapabilities = {
  enabled: boolean
  manage: boolean
}

export type AgentAccessSettings = {
  enabled: boolean
  can_manage: boolean
  /** The address people give their agent. */
  connector_url: string
}

export type AgentAccessLevel = "read" | "draft"

/** An organization the person may connect an agent to. */
export type AgentAuthorizationOrganization = {
  uuid: string
  name: string
  /** False while the organization's agent access is switched off. */
  available: boolean
  reason: "switched_off" | null
  /** The person may switch agent access on for this organization. */
  can_manage: boolean
}

/** The agent connection waiting for the signed-in person's decision. */
export type AgentAuthorization = {
  /** Sent back with the decision; it ties the decision to this request. */
  auth_token: string
  client: { name: string; self_declared: boolean; client_uri: string | null }
  /** Where the agent receives the result. */
  redirect_host: string
  organizations: AgentAuthorizationOrganization[]
  access_levels: AgentAccessLevel[]
}

export type AgentAuthorizationDecision = { redirect_to: string }

export type AgentConnectionState = "active" | "expired" | "revoked" | "unavailable"

/** One person's agent acting in one organization. */
export type AgentConnection = {
  uuid: string
  agent: { name: string; redirect_host: string }
  organization: { uuid: string; name: string }
  access_level: AgentAccessLevel
  created_at: string
  last_used_at: string | null
  expires_at: string
  state: AgentConnectionState
  revoked_reason: "person" | "administrator" | "membership_removed" | "password_reset" | "refresh_reuse" | "replaced" | null
  /** Administrators' list only. */
  user?: { id: number; name: string; email: string }
}

/** One tool call; arguments and results are never stored. */
export type AgentActivityEntry = {
  tool: string
  outcome: "answered" | "refused" | "failed"
  reason: string | null
  targets: string[]
  duration_ms: number
  created_at: string
}

export type AgentActivityPage = {
  data: AgentActivityEntry[]
  meta: { current_page: number; last_page: number; total: number }
}
