import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiClient, ApiError, ConfirmationRequiredError, NOT_AVAILABLE_HERE_EVENT, isNotAvailableHere, TWO_STEP_SETUP_REQUIRED_EVENT, TwoStepRequiredError, TwoStepSetupRequiredError } from "./index"

/** Two-step sign-in (spec 034) in the client. */
describe("ApiClient two-step sign-in", () => {
  afterEach(() => vi.unstubAllGlobals())

  function api(respond: (method: string, path: string, body: unknown) => Response) {
    const calls: string[] = []
    vi.stubGlobal("document", { cookie: "XSRF-TOKEN=token" })
    vi.stubGlobal("window", { dispatchEvent: vi.fn(), localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      const path = String(input).replace("https://api.example.test", "")
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      calls.push(`${method} ${path}${body ? ` ${JSON.stringify(body)}` : ""}`)
      return path === "/sanctum/csrf-cookie" ? new Response(null, { status: 204 }) : respond(method, path, body)
    }))
    return { client: new ApiClient("https://api.example.test"), calls }
  }

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

  it("turns a 202 from the password step into TwoStepRequiredError", async () => {
    const { client } = api(() => json(202, { two_step_required: true, expires_in: 300, methods: ["code", "recovery_code"] }))

    const error = await client.login({ email: "a@example.test", password: "secret", remember: true }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(TwoStepRequiredError)
    expect(error).toMatchObject({ status: 202, expiresIn: 300, methods: ["code", "recovery_code"] })
  })

  it("still returns the user when no second step is due", async () => {
    const { client } = api(() => json(200, { data: { id: 7, email: "a@example.test" } }))

    await expect(client.login({ email: "a@example.test", password: "secret" })).resolves.toMatchObject({ id: 7 })
  })

  it("sends a code or a recovery code and reports the codes left", async () => {
    const { client, calls } = api((_method, _path, body) =>
      json(200, { data: { id: 7 }, ...((body as Record<string, string>).recovery_code ? { recovery_codes_remaining: 7 } : {}) }),
    )

    await expect(client.twoStepChallenge({ code: "123456" })).resolves.toEqual({ user: { id: 7 }, recoveryCodesRemaining: null })
    await expect(client.twoStepChallenge({ recoveryCode: "abc-def" })).resolves.toEqual({ user: { id: 7 }, recoveryCodesRemaining: 7 })
    expect(calls).toEqual(['POST /api/v1/auth/two-step {"code":"123456"}', 'POST /api/v1/auth/two-step {"recovery_code":"abc-def"}'])
  })

  it("rejects a wrong code with the attempts left", async () => {
    const { client } = api(() => json(422, { message: "That code is not valid.", errors: { code: ["That code is not valid."] }, attempts_left: 3 }))

    const error = await client.twoStepChallenge({ code: "000000" }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, payload: { attempts_left: 3 } })
  })

  it("maps 423 to ConfirmationRequiredError so the caller can confirm and retry", async () => {
    let confirmed = false
    const { client, calls } = api((method, path) => {
      if (path === "/api/v1/auth/confirm-password") {
        confirmed = true
        return new Response(null, { status: 204 })
      }
      return confirmed ? json(200, { recovery_codes: ["a", "b"] }) : json(423, { message: "Password confirmation required." })
    })

    const first = await client.regenerateRecoveryCodes().catch((e: unknown) => e)
    expect(first).toBeInstanceOf(ConfirmationRequiredError)
    await client.confirmPassword("secret")
    await expect(client.regenerateRecoveryCodes()).resolves.toEqual(["a", "b"])
    expect(calls).toEqual([
      "POST /api/v1/me/two-step/recovery-codes",
      'POST /api/v1/auth/confirm-password {"password":"secret"}',
      "POST /api/v1/me/two-step/recovery-codes",
    ])
  })

  it("reads security settings and drives setup", async () => {
    const { client, calls } = api((method, path) => {
      if (path === "/api/v1/me/security") return json(200, { data: { two_step: { enabled: false, recovery_codes_remaining: 0 } } })
      if (path === "/api/v1/me/two-step" && method === "POST") return json(200, { qr_svg: "<svg/>", setup_key: "ABCD EFGH", otpauth_url: "otpauth://totp/x" })
      if (path === "/api/v1/me/two-step/confirm") return json(200, { recovery_codes: ["one"] })
      return new Response(null, { status: 204 })
    })

    await expect(client.security()).resolves.toMatchObject({ two_step: { enabled: false } })
    await expect(client.startTwoStep()).resolves.toMatchObject({ setup_key: "ABCD EFGH" })
    await expect(client.confirmTwoStep("123456")).resolves.toEqual(["one"])
    await client.disableTwoStep()
    expect(calls.at(-1)).toBe("DELETE /api/v1/me/two-step")
  })

  it("turns two_step_setup_required into a typed error and a window event", async () => {
    const { client } = api(() => json(403, { code: "two_step_setup_required", message: "Set up two-step sign-in to continue." }))
    const error = await client.organizationSecurity("org-1").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TwoStepSetupRequiredError)
    const fired = vi.mocked(window.dispatchEvent).mock.calls.map(([event]) => event.type)
    expect(fired).toEqual([TWO_STEP_SETUP_REQUIRED_EVENT])

    // Another 403 stays an ordinary refusal.
    const { client: other } = api(() => json(403, { message: "This action is unauthorized." }))
    const refused = await other.organizationSecurity("org-1").catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(ApiError)
    expect(refused).not.toBeInstanceOf(TwoStepSetupRequiredError)
    expect(vi.mocked(window.dispatchEvent)).not.toHaveBeenCalled()
  })

  it("fires an event when a signed-in request is refused at a portal address, but not for sign-in itself", async () => {
    const refusal = { code: "not_available_here", message: "This account cannot sign in at this address." }
    const { client } = api(() => json(403, refusal))
    const error = await client.organizationSecurity("org-1").catch((e: unknown) => e)
    expect(isNotAvailableHere(error)).toBe(true)
    expect(vi.mocked(window.dispatchEvent).mock.calls.map(([event]) => event.type)).toEqual([NOT_AVAILABLE_HERE_EVENT])

    // The sign-in page shows its own refusal, and reading the session shows it too.
    const { client: guest } = api(() => json(403, refusal))
    expect(isNotAvailableHere(await guest.login({ email: "bo@example.test", password: "password" }).catch((e: unknown) => e))).toBe(true)
    expect(isNotAvailableHere(await guest.me().catch((e: unknown) => e))).toBe(true)
    expect(vi.mocked(window.dispatchEvent)).not.toHaveBeenCalled()

    // Another account's organization is a 404 with the same code, and no event.
    const { client: elsewhere } = api(() => json(404, { code: "not_available_here", message: "This organization is not available at this address." }))
    expect(isNotAvailableHere(await elsewhere.organizationSecurity("org-2").catch((e: unknown) => e))).toBe(true)
    expect(vi.mocked(window.dispatchEvent)).not.toHaveBeenCalled()
    expect(isNotAvailableHere(new ApiError(403, { message: "This action is unauthorized." }))).toBe(false)
  })

  it("reads and changes an organization's two-step requirement", async () => {
    const { client, calls } = api(() => json(200, { data: { two_step_required: true, members_without_two_step: 2, can_change: true } }))

    await expect(client.organizationSecurity("org-1")).resolves.toMatchObject({ members_without_two_step: 2 })
    await expect(client.setOrganizationTwoStep("org-1", true)).resolves.toMatchObject({ two_step_required: true })
    expect(calls).toEqual(["GET /api/v1/organizations/org-1/security", 'PUT /api/v1/organizations/org-1/security {"two_step_required":true}'])
  })

  it("points the passkey ceremonies at the API and removes a passkey", async () => {
    const { client, calls } = api((method, path) => {
      if (path === "/api/v1/me/passkeys/12" && method === "DELETE") return new Response(null, { status: 204 })
      return json(423, { message: "Password confirmation required." })
    })

    expect(client.passkeyEndpoints()).toEqual({
      signIn: { options: "https://api.example.test/api/v1/auth/passkeys/options", submit: "https://api.example.test/api/v1/auth/passkeys" },
      confirm: { options: "https://api.example.test/api/v1/auth/confirm-passkey/options", submit: "https://api.example.test/api/v1/auth/confirm-passkey" },
      register: { options: "https://api.example.test/api/v1/me/passkeys/options", submit: "https://api.example.test/api/v1/me/passkeys" },
    })
    await client.removePasskey(12)
    expect(calls).toEqual(["DELETE /api/v1/me/passkeys/12"])
    await expect(client.removePasskey(13)).rejects.toBeInstanceOf(ConfirmationRequiredError)
  })
})
