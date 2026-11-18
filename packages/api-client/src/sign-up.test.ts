import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiClient, ApiError, SignUpUnconfirmedError, signUpLinkProblem } from "./index"

/** Self sign-up (spec 035): guest routes never ask to restore a session. */
describe("ApiClient sign-up", () => {
  afterEach(() => vi.unstubAllGlobals())

  function browser(respond: (url: string, method: string) => Response) {
    const expired = vi.fn()
    const calls: string[] = []
    vi.stubGlobal("document", { cookie: "XSRF-TOKEN=token" })
    vi.stubGlobal("window", { dispatchEvent: expired, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("https://api.example.test", "")
      const method = init?.method ?? "GET"
      calls.push(`${method} ${url}`)
      return url === "/sanctum/csrf-cookie" ? new Response(null, { status: 204 }) : respond(url, method)
    }))
    return { calls, expired }
  }

  it("signs up after fetching the CSRF cookie", async () => {
    const { calls } = browser(() => new Response(JSON.stringify({ state: "waiting", email: "jane@example.com", resend_after: 60 }), { status: 202 }))

    await expect(new ApiClient("https://api.example.test").signUp({
      name: "Jane", email: "jane@example.com", password: "x", password_confirmation: "x",
      organization_name: "Acme", form_token: "t", website: "",
    })).resolves.toEqual({ state: "waiting", email: "jane@example.com", resend_after: 60 })
    expect(calls).toEqual(["GET /sanctum/csrf-cookie", "POST /api/v1/sign-up"])
  })

  it("does not fire the session-expired event or retry on a 419 from a sign-up route", async () => {
    const { calls, expired } = browser(() => new Response(JSON.stringify({ message: "CSRF token mismatch." }), { status: 419 }))

    await expect(new ApiClient("https://api.example.test").confirmSignUp("token")).rejects.toMatchObject({ status: 419 })
    expect(calls).toEqual(["GET /sanctum/csrf-cookie", "POST /api/v1/sign-up/confirm"])
    expect(expired).not.toHaveBeenCalled()
  })

  it("tells a link's problem apart", async () => {
    browser((url) => url.endsWith("/confirm")
      ? new Response(JSON.stringify({ code: "used", message: "Used.", email: "jane@example.com" }), { status: 410 })
      : new Response(JSON.stringify({ message: "Not found." }), { status: 404 }))
    const client = new ApiClient("https://api.example.test")

    expect(signUpLinkProblem(await client.confirmSignUp("token").catch((error: unknown) => error))).toBe("used")
    expect(signUpLinkProblem(await client.signUpStatus().catch((error: unknown) => error))).toBe("unknown")
    expect(signUpLinkProblem(new ApiError(409, { code: "account_exists" }))).toBe("account_exists")
    expect(signUpLinkProblem(new Error("network"))).toBeNull()
  })

  it("rejects sign-in for an unconfirmed sign-up with its own error", async () => {
    browser(() => new Response(JSON.stringify({ code: "sign_up_unconfirmed", message: "Confirm your email first." }), { status: 403 }))

    await expect(new ApiClient("https://api.example.test").login({ email: "jane@example.com", password: "x" }))
      .rejects.toBeInstanceOf(SignUpUnconfirmedError)
  })

  it("builds the admin list's query", async () => {
    const { calls } = browser(() => new Response(JSON.stringify({ data: [], meta: { current_page: 1, from: null, last_page: 1, per_page: 25, to: null, total: 0 } }), { status: 200 }))

    await new ApiClient("https://api.example.test").signUps({ state: "expired", search: " acme ", page: 2 })
    expect(calls).toEqual(["GET /api/v1/admin/sign-ups?state=expired&search=acme&page=2"])
  })
})
