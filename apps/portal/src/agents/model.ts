import type { Organization } from "@iot-os/api-client"

/** The deployment offers agent access; the organization's own switch may still be off. */
export function agentAccessOffered(organization?: Organization) {
  return organization?.capabilities?.features?.agent_access === true
}

/** Organization administrators switch agent access on and off. */
export function canManageAgents(organization?: Organization) {
  return organization?.capabilities?.agents?.manage === true
}

export type ClientSteps = { client: string; steps: string[] }

/** How to add the connector address in common MCP clients. */
export function connectSteps(url: string): ClientSteps[] {
  return [
    {
      client: "Claude.ai and Claude Desktop",
      steps: [
        "Open Settings → Connectors and choose Add custom connector.",
        `Paste ${url} and choose Connect.`,
        "Approve the connection here when your browser opens.",
      ],
    },
    {
      client: "Claude Code",
      steps: [`Run: claude mcp add --transport http iot-os ${url}`, "Run /mcp and choose Authenticate, then approve here."],
    },
    {
      client: "Other MCP clients",
      steps: [`Add a remote (Streamable HTTP) server at ${url}.`, "Sign in when the client asks, then approve here."],
    },
  ]
}

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * After sign-in the portal sends the browser back to the agent's authorize request.
 * Only the API's own authorize endpoint qualifies, so the link cannot redirect elsewhere.
 */
export function isAgentAuthorizeUrl(candidate: string, apiBase: string) {
  let url: URL
  let api: URL
  try {
    url = new URL(candidate)
    api = new URL(apiBase)
  } catch {
    return false
  }
  const sameHost = url.hostname === api.hostname || (loopback.has(url.hostname) && loopback.has(api.hostname))
  return (
    url.protocol === api.protocol &&
    sameHost &&
    url.port === api.port &&
    url.pathname === "/oauth/authorize" &&
    url.username === "" &&
    url.password === ""
  )
}

const revocations: Record<string, string> = {
  person: "Disconnected by you",
  administrator: "Disconnected by an administrator",
  membership_removed: "Removed from the organization",
  password_reset: "Password was reset",
  refresh_reuse: "Its sign-in was reused",
  replaced: "Replaced by a newer connection",
}

/** Why a connection ended, in words. */
export function revocationLabel(reason: string) {
  return revocations[reason] ?? reason.replaceAll("_", " ")
}
