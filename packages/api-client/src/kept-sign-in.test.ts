import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiClient } from "./index"

/**
 * Keep me signed in (spec 033, FR-011a): after hours idle the session has lapsed, so the
 * API refuses the first change with 419 before the kept sign-in can resume it.
 */
describe("ApiClient after a kept sign-in's session lapsed", () => {
  afterEach(() => vi.unstubAllGlobals())

  /** A browser whose XSRF cookie the API renews when a read resumes the session. */
  function browser(meStatus: number) {
    const cookies = { token: "stale" }
    const expired = vi.fn()
    const calls: string[] = []
    vi.stubGlobal("document", { get cookie() { return `XSRF-TOKEN=${cookies.token}` } })
    vi.stubGlobal("window", { dispatchEvent: expired, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      calls.push(`${method} ${url.replace("https://api.example.test", "")} ${new Headers(init?.headers).get("X-XSRF-TOKEN") ?? ""}`.trim())
      if (url.endsWith("/api/v1/me")) {
        if (meStatus === 200) cookies.token = "renewed"
        return new Response(JSON.stringify({ data: { id: 7 } }), { status: meStatus })
      }
      return cookies.token === "renewed" && new Headers(init?.headers).get("X-XSRF-TOKEN") === "renewed"
        ? new Response(JSON.stringify({ data: { acknowledged: true } }), { status: 200 })
        : new Response(JSON.stringify({ message: "CSRF token mismatch." }), { status: 419 })
    }))
    return { calls, expired }
  }

  it("resumes with a read and sends the refused change once more", async () => {
    const { calls, expired } = browser(200)

    await expect(new ApiClient("https://api.example.test").acknowledgeAlert("org", "alert")).resolves.toMatchObject({ acknowledged: true })

    expect(calls).toEqual([
      "POST /api/v1/organizations/org/alerts/alert/acknowledge stale",
      "GET /api/v1/me",
      "POST /api/v1/organizations/org/alerts/alert/acknowledge renewed",
    ])
    expect(expired).not.toHaveBeenCalled()
  })

  it("asks for the password when nobody is signed in any more, and retries only once", async () => {
    const { calls, expired } = browser(401)

    await expect(new ApiClient("https://api.example.test").acknowledgeAlert("org", "alert")).rejects.toMatchObject({ status: 419 })

    expect(calls).toEqual(["POST /api/v1/organizations/org/alerts/alert/acknowledge stale", "GET /api/v1/me"])
    expect(expired).toHaveBeenCalledOnce()
  })
})
