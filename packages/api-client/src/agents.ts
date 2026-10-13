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
