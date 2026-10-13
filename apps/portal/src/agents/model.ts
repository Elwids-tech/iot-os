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
