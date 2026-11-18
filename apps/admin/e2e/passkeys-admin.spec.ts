import { generateKeyPairSync, randomBytes } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"

// Passkey sign-in in the admin app (spec 034, US2) with Chrome's virtual authenticator,
// against a mocked API. A passkey added in the portal is bound to the parent domain, so
// it signs in here too. WebAuthn refuses IP addresses, so the page opens on localhost.

test.use({ baseURL: "http://localhost:4174" })

const admin = {
  id: 1,
  name: "Platform Super Admin",
  email: "super-admin@example.test",
  email_verified_at: "2026-08-24T00:00:00.000000Z",
  is_super_admin: true,
  capabilities: { platform_administration: true, manage_organizations: true, manage_assistant: true, manage_tickets: false },
  organizations: [],
}

const credentialId = randomBytes(32)

/** A virtual platform authenticator holding the passkey the person added in the portal. */
async function authenticatorWithPasskey(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
  await cdp.send("WebAuthn.addCredential", {
    authenticatorId,
    credential: {
      credentialId: credentialId.toString("base64"),
      isResidentCredential: true,
      rpId: "localhost",
      privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      userHandle: Buffer.from("user-1").toString("base64"),
      signCount: 0,
    },
  })
}

async function mockApi(page: Page) {
  const state = { signedIn: false, challenge: "", answers: [] as Record<string, unknown>[] }
  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data })
    if (path === "/api/v1/auth/passkeys/options") {
      state.challenge = randomBytes(32).toString("base64url")
      return json({ options: { challenge: state.challenge, rpId: "localhost", allowCredentials: [], userVerification: "required", timeout: 60000 } })
    }
    if (path === "/api/v1/auth/passkeys") {
      state.answers.push(body)
      const credential = body.credential as { id?: string; response?: { clientDataJSON?: string } }
      const client = JSON.parse(Buffer.from(credential.response?.clientDataJSON ?? "", "base64url").toString()) as Record<string, string>
      if (credential.id !== credentialId.toString("base64url") || client.challenge !== state.challenge || client.type !== "webauthn.get")
        return json({ message: "Unable to verify passkey.", errors: { credential: ["Unable to verify passkey."] } }, 422)
      state.signedIn = true
      return json({ data: admin })
    }
    if (!state.signedIn) return json({ message: "Unauthenticated." }, 401)
    if (path === "/api/v1/me") return json({ data: admin })
    if (path === "/api/v1/admin/tickets/summary") return json({ data: { awaiting_team: 0 } })
    return json({ data: [], links: {}, meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } })
  })
  return state
}

test("a passkey signs in to the admin app without a password", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  // The button, as in a browser without passkey suggestions in the email field.
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = async () => false
  })
  const state = await mockApi(page)
  await authenticatorWithPasskey(page)
  await page.goto("/")

  await page.getByRole("button", { name: "Sign in with a passkey" }).click()

  await expect(page).toHaveURL(/\/organizations$/)
  expect(state.answers).toHaveLength(1)
  expect(state.answers[0].remember).toBe(false)
  expect(errors).toEqual([])
})

test("the email field suggests the passkey, and picking it signs in", async ({ page }) => {
  const state = await mockApi(page)
  await authenticatorWithPasskey(page)
  await page.goto("/")

  // The virtual authenticator picks the suggestion as soon as the page asks for it.
  await expect(page).toHaveURL(/\/organizations$/)
  expect(state.signedIn).toBe(true)
})
