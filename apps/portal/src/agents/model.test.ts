import { describe, expect, it } from "vitest"
import type { Organization } from "@iot-os/api-client"
import { agentAccessOffered, canManageAgents, connectSteps, isAgentAuthorizeUrl } from "./model"

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

describe("returning to an agent's authorize request", () => {
  const api = "https://api.example.com/"

  it("accepts only the API's authorize endpoint", () => {
    expect(isAgentAuthorizeUrl("https://api.example.com/oauth/authorize?client_id=x", api)).toBe(true)
    expect(isAgentAuthorizeUrl("https://evil.example.org/oauth/authorize", api)).toBe(false)
    expect(isAgentAuthorizeUrl("https://api.example.com.evil.org/oauth/authorize", api)).toBe(false)
    expect(isAgentAuthorizeUrl("http://api.example.com/oauth/authorize", api)).toBe(false)
    expect(isAgentAuthorizeUrl("https://api.example.com/oauth/token", api)).toBe(false)
    expect(isAgentAuthorizeUrl("https://user:pass@api.example.com/oauth/authorize", api)).toBe(false)
    expect(isAgentAuthorizeUrl("javascript:alert(1)", api)).toBe(false)
    expect(isAgentAuthorizeUrl("not a url", api)).toBe(false)
  })

  it("treats loopback names alike in development", () => {
    expect(isAgentAuthorizeUrl("http://127.0.0.1:8001/oauth/authorize?x=1", "http://localhost:8001/")).toBe(true)
    expect(isAgentAuthorizeUrl("http://127.0.0.1:9000/oauth/authorize", "http://localhost:8001/")).toBe(false)
  })
})
