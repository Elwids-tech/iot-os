import { describe, expect, it } from "vitest"
import type { Organization } from "@iot-os/api-client"
import { agentAccessOffered, canManageAgents, connectSteps } from "./model"

const organization = (capabilities: Organization["capabilities"]): Organization => ({
  uuid: "org",
  name: "Acme",
  slug: "acme",
  capabilities,
})

describe("agent access visibility", () => {
  it("is hidden while the deployment does not offer it", () => {
    expect(agentAccessOffered(undefined)).toBe(false)
    expect(agentAccessOffered(organization({ manage_administration: true, features: { device_adapters: true } }))).toBe(false)
    expect(
      agentAccessOffered(organization({ manage_administration: true, features: { device_adapters: false, agent_access: false } })),
    ).toBe(false)
    expect(
      agentAccessOffered(organization({ manage_administration: false, features: { device_adapters: false, agent_access: true } })),
    ).toBe(true)
  })

  it("lets only administrators switch it", () => {
    expect(canManageAgents(organization({ manage_administration: false, agents: { enabled: true, manage: false } }))).toBe(false)
    expect(canManageAgents(organization({ manage_administration: true, agents: { enabled: false, manage: true } }))).toBe(true)
    expect(canManageAgents(organization({ manage_administration: true }))).toBe(false)
  })

  it("puts the connector address into every client's steps", () => {
    const url = "https://api.example.com/mcp"
    const steps = connectSteps(url)
    expect(steps.map((item) => item.client)).toEqual(["Claude.ai and Claude Desktop", "Claude Code", "Other MCP clients"])
    for (const item of steps) expect(item.steps.join(" ")).toContain(url)
  })
})
