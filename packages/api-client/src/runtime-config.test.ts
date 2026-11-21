import { afterEach, describe, expect, it, vi } from "vitest"
// The one fixture the portal's inline bootstrap also tests against (spec 036).
import fixture from "../../../apps/portal/src/lib/__fixtures__/runtime-config.branded.js?raw"
import { runtimeAddress, runtimeApiUrl, runtimeBrand, runtimeConfig } from "./runtime-config"

function load(script: string, origin = "https://acme.example.com") {
  const window: Record<string, unknown> = { location: { origin } }
  new Function("window", script)(window)
  vi.stubGlobal("window", window)
}

afterEach(() => vi.unstubAllGlobals())

describe("runtime config", () => {
  it("reads the brand and address of a name under the platform's domain", () => {
    load(fixture)

    expect(runtimeAddress()).toEqual({ kind: "name", host: "acme.example.com", state: "active" })
    expect(runtimeBrand()).toMatchObject({ product_name: "Acme Monitor", short_name: "Acme", powered_by: "IoT OS", logo_dark: null })
    expect(runtimeApiUrl("http://build.example")).toBe("https://api.example.com")
    expect(runtimeConfig("VITE_ADMIN_URL", "http://build.example")).toBe("http://build.example")
    expect(runtimeConfig("environment")).toBe("production")
  })

  it("takes an empty API address on an address to mean this origin", () => {
    load('window.__IOT_CONFIG__ = {"VITE_API_URL":"","address":{"kind":"domain","host":"portal.example.org","state":"active"},"brand":null};', "https://portal.example.org")

    expect(runtimeApiUrl("http://build.example")).toBe("https://portal.example.org")
    expect(runtimeBrand()).toBeNull()
  })

  it("is the platform's own address without an address, as before", () => {
    load('window.__IOT_CONFIG__ = {"VITE_API_URL":"","environment":"local"};', "http://localhost:5173")

    expect(runtimeAddress()).toBeNull()
    expect(runtimeBrand()).toBeNull()
    expect(runtimeApiUrl("http://build.example")).toBe("http://build.example")
  })

  it("has no brand on a host that is not in use", () => {
    load('window.__IOT_CONFIG__ = {"VITE_API_URL":"","address":{"state":"not_in_use"}};')

    expect(runtimeAddress()).toBeNull()
    expect(runtimeBrand()).toBeNull()
    expect(runtimeApiUrl("http://build.example")).toBe("http://build.example")
  })
})
