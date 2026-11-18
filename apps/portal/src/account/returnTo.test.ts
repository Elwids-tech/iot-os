import { describe, expect, it } from "vitest"
import { returnTarget } from "./returnTo"

const origins = { admin: "https://admin.example.test", api: "https://api.example.test/" }

describe("returnTarget", () => {
  it("returns to the refused portal page", () => {
    expect(returnTarget("/organizations/abc/devices?x=1#top", origins)).toEqual({ kind: "portal", path: "/organizations/abc/devices?x=1#top" })
  })

  it("follows the admin app and the agent consent page", () => {
    expect(returnTarget("https://admin.example.test/organizations", origins)).toEqual({ kind: "external", url: "https://admin.example.test/organizations" })
    expect(returnTarget("https://api.example.test/oauth/authorize?client_id=1", origins)).toEqual({
      kind: "external",
      url: "https://api.example.test/oauth/authorize?client_id=1",
    })
  })

  it("treats localhost and 127.0.0.1 as one host on a developer's machine", () => {
    const local = { admin: "http://127.0.0.1:5174", api: "http://127.0.0.1:8001" }
    expect(returnTarget("http://localhost:5174/organizations", local)).toEqual({ kind: "external", url: "http://localhost:5174/organizations" })
    expect(returnTarget("http://localhost:5175/organizations", local)).toEqual({ kind: "portal", path: "/" })
  })

  it("goes home for anything else", () => {
    for (const value of [null, "", "//evil.example.com/x", "/\\evil.example.com", "https://evil.example.com/", "https://api.example.test/api/v1/me", "javascript:alert(1)", "/account/security/setup?return=/x"])
      expect(returnTarget(value, origins)).toEqual({ kind: "portal", path: "/" })
  })
})
