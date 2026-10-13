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
