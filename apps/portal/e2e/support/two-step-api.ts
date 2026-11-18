import type { Page, Route } from "@playwright/test"
import { Secret, TOTP } from "otpauth"

/**
 * A stand-in for the API's two-step routes (spec 034), shared by every browser context in
 * one test: one person, their codes, and which browsers are signed in. Codes are real
 * TOTP codes, so the test types what an authenticator app would show.
 */
export type FakeAccount = ReturnType<typeof fakeAccount>

export const PASSWORD = "correct-horse-battery"

type Requirement = "platform" | { organization: string; name: string }

/** An organization several fake people share: whether it requires two-step (spec 034, US3). */
export type FakeOrganization = { twoStepRequired: boolean; members: FakeAccount[] }

export function fakeOrganization(): FakeOrganization {
  return { twoStepRequired: false, members: [] }
}

/**
 * One person. `platform` makes them platform staff, and `organization` makes them a member
 * of a shared organization; either can require two-step for them.
 */
export function fakeAccount(options: { user?: typeof me; platform?: boolean; organization?: FakeOrganization } = {}) {
  const account = {
    user: options.user ?? me,
    organization: options.organization ?? null,
    requiredBy(): Requirement[] {
      return [
        ...(options.platform ? (["platform"] as const) : []),
        ...(options.organization?.twoStepRequired ? [{ organization: acme.uuid, name: acme.name }] : []),
      ]
    },
    secret: null as string | null,
    enabled: false,
    confirmedAt: null as string | null,
    recoveryCodes: [] as string[],
    usedCodes: new Set<string>(),
    /** Browsers with a session, by name; a kept browser also has a kept sign-in. */
    sessions: new Set<string>(),
    kept: new Set<string>(),
    passwordConfirmed: new Set<string>(),
    pending: new Map<string, { remember: boolean; attempts: number }>(),
    logins: [] as unknown[],
    mails: [] as string[],
  }
  options.organization?.members.push(account)
  return account
}

export const totp = (secret: string) => new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 })

/** The code an authenticator app shows for the setup key on screen. */
export const codeFor = (setupKey: string, offset = 0) =>
  totp(setupKey.replace(/\s+/g, "")).generate({ timestamp: Date.now() + offset * 30_000 })

const organization = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
export const acme = {
  uuid: organization,
  name: "Acme",
  slug: "acme",
  capabilities: { devices: { view: true, manage: true, command: true } },
}
export const me: {
  id: number
  name: string
  email: string
  email_verified_at: string
  capabilities: { platform_administration: boolean }
  organizations: Array<typeof acme & { capabilities: Record<string, unknown> }>
} = {
  id: 1,
  name: "Operator",
  email: "operator@example.test",
  email_verified_at: "2026-01-01",
  capabilities: { platform_administration: false },
  organizations: [acme],
}
const overview = {
  devices: { active: 0, online: 0, offline: 0, unknown: 0, registered: 0, deactivated: 0, silent: 0 },
  alerts: { active: 0, active_unacknowledged: 0, unacknowledged: 0, last_24_hours: 0, latest_active: [] },
  automations: { applied: 0 },
  discovery: { pending: 0 },
  commands: { uncertain: 0, recent: [] },
}

function newRecoveryCodes() {
  const part = () => Math.random().toString(36).slice(2, 12).padEnd(10, "x")
  return Array.from({ length: 8 }, () => `${part()}-${part()}`)
}

/** Serves the API to one browser (`name`) of the account. */
export async function serve(page: Page, account: FakeAccount, name: string, { signedIn = false } = {}) {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  if (signedIn) account.sessions.add(name)
  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    const signedInHere = () => account.sessions.has(name)
    const signIn = (remember: boolean) => {
      account.sessions.add(name)
      if (remember) account.kept.add(name)
    }

    if (path === "/api/v1/auth/login" && method === "POST") {
      account.logins.push(body)
      if (body.password !== PASSWORD)
        return json({ message: "These credentials do not match.", errors: { email: ["These credentials do not match our records."] } }, 422)
      if (account.enabled) {
        account.pending.set(name, { remember: body.remember === true, attempts: 0 })
        return json({ two_step_required: true, expires_in: 300, methods: ["code", "recovery_code"] }, 202)
      }
      signIn(body.remember === true)
      return json({ data: account.user })
    }
    if (path === "/api/v1/auth/two-step" && method === "POST") {
      const pending = account.pending.get(name)
      if (!pending) return json({ message: "Start again.", errors: { pending: ["Start again with your password."] } }, 422)
      const recovery = typeof body.recovery_code === "string" ? body.recovery_code.trim() : null
      const code = typeof body.code === "string" ? body.code : null
      const field = recovery !== null ? "recovery_code" : "code"
      let ok = false
      if (recovery !== null && account.recoveryCodes.includes(recovery)) {
        account.recoveryCodes = account.recoveryCodes.filter((each) => each !== recovery)
        account.mails.push("recovery_code_used")
        ok = true
      } else if (code !== null && account.secret && !account.usedCodes.has(code) && totp(account.secret).validate({ token: code, window: 1 }) !== null) {
        account.usedCodes.add(code)
        ok = true
      }
      if (!ok) {
        pending.attempts += 1
        if (pending.attempts >= 5) {
          account.pending.delete(name)
          return json({ message: "Start again.", errors: { pending: ["Start again with your password."] } }, 422)
        }
        const message = field === "code" ? "That code is not valid." : "That recovery code is not valid."
        return json({ message, errors: { [field]: [message] }, attempts_left: 5 - pending.attempts }, 422)
      }
      account.pending.delete(name)
      signIn(pending.remember)
      return json(recovery !== null ? { data: account.user, recovery_codes_remaining: account.recoveryCodes.length } : { data: account.user })
    }
    if (path === "/api/v1/auth/logout") {
      account.sessions.delete(name)
      account.kept.delete(name)
      return route.fulfill({ status: 204 })
    }
    // An invitation for a new person (spec 034, US3): accepting it signs them in.
    if (path === "/api/v1/invitations/invite-token" && method === "GET")
      return json({ data: { grants_super_admin: false, organization: { uuid: acme.uuid, name: acme.name }, email: account.user.email, expires_at: "2099-01-01T00:00:00Z", acceptance_mode: "create_account" } })
    if (path === "/api/v1/invitations/invite-token/accept" && method === "POST") {
      signIn(false)
      return json({ data: account.user })
    }
    // A kept sign-in brings the session back in a new context of the same browser (spec 033).
    if (!signedInHere() && account.kept.has(name)) account.sessions.add(name)
    if (!signedInHere()) return json({ message: "Unauthenticated." }, 401)

    // Required two-step that is not set up: only setup and sign-out (spec 034, FR-022).
    const setupRoute = path === "/api/v1/me" || path === "/api/v1/me/security" || path.startsWith("/api/v1/me/two-step") || path === "/api/v1/auth/confirm-password"
    if (account.requiredBy().length > 0 && !account.enabled && !setupRoute)
      return json({ code: "two_step_setup_required", message: "Set up two-step sign-in to continue." }, 403)

    if (path === "/api/v1/me") return json({ data: account.user })
    if (path === "/api/v1/auth/confirm-password" && method === "POST") {
      if (body.password !== PASSWORD) return json({ message: "Wrong.", errors: { password: ["The provided password is incorrect."] } }, 422)
      account.passwordConfirmed.add(name)
      return route.fulfill({ status: 204 })
    }
    if (path === "/api/v1/me/security")
      return json({
        data: {
          two_step: {
            enabled: account.enabled,
            confirmed_at: account.confirmedAt,
            recovery_codes_remaining: account.recoveryCodes.length,
            required: account.requiredBy().length > 0,
            required_by: account.requiredBy(),
            satisfied: account.enabled,
          },
        },
      })
    if (path.startsWith("/api/v1/me/two-step")) {
      const confirmNeeded = !(path === "/api/v1/me/two-step/confirm") && !account.passwordConfirmed.has(name)
      if (confirmNeeded) return json({ message: "Password confirmation required." }, 423)
      if (path === "/api/v1/me/two-step" && method === "POST") {
        if (account.enabled) return json({ message: "Already on.", code: "two_step_already_on" }, 409)
        account.secret = new Secret({ size: 20 }).base32
        return json({
          qr_svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/><rect x="2" y="2" width="6" height="6" fill="#222"/></svg>',
          setup_key: account.secret.match(/.{1,4}/g)!.join(" "),
          otpauth_url: `otpauth://totp/example.test:${me.email}?secret=${account.secret}`,
        })
      }
      if (path === "/api/v1/me/two-step/confirm" && method === "POST") {
        const code = String(body.code ?? "")
        if (!account.secret || totp(account.secret).validate({ token: code, window: 1 }) === null)
          return json({ message: "That code is not valid.", errors: { code: ["That code is not valid."] } }, 422)
        account.usedCodes.add(code)
        account.enabled = true
        account.confirmedAt = new Date().toISOString()
        account.recoveryCodes = newRecoveryCodes()
        account.mails.push("two_step_enabled")
        // Every other browser of this person is signed out (FR-027).
        for (const other of [...account.sessions]) if (other !== name) account.sessions.delete(other)
        for (const other of [...account.kept]) if (other !== name) account.kept.delete(other)
        return json({ recovery_codes: account.recoveryCodes })
      }
      if (path === "/api/v1/me/two-step/recovery-codes" && method === "POST") {
        account.recoveryCodes = newRecoveryCodes()
        account.mails.push("recovery_codes_regenerated")
        return json({ recovery_codes: account.recoveryCodes })
      }
      if (path === "/api/v1/me/two-step" && method === "DELETE") {
        if (account.enabled && account.requiredBy().length > 0)
          return json({ code: "two_step_required", message: "Two-step sign-in is required for your account, so it cannot be turned off." }, 409)
        account.enabled = false
        account.secret = null
        account.confirmedAt = null
        account.recoveryCodes = []
        account.mails.push("two_step_disabled")
        return route.fulfill({ status: 204 })
      }
    }
    const shared = account.organization
    if (shared && path === `/api/v1/organizations/${organization}/security`) {
      const settings = () => ({
        two_step_required: shared.twoStepRequired,
        members_without_two_step: shared.members.filter((member) => !member.enabled).length,
        can_change: account.enabled,
      })
      if (method === "PUT") {
        if (!account.enabled) return json({ code: "two_step_setup_required", message: "Set up two-step sign-in for your own account first." }, 409)
        shared.twoStepRequired = body.two_step_required === true
      }
      return json({ data: settings() })
    }
    if (shared && path === `/api/v1/organizations/${organization}/members`)
      return json({
        data: shared.members.map((member) => ({
          id: member.user.id,
          name: member.user.name,
          email: member.user.email,
          is_current_user: member === account,
          two_step_enabled: member.enabled,
          manageable: false,
          roles: [],
        })),
        meta: { current_page: 1, last_page: 1, total: shared.members.length, per_page: 25, from: 1, to: shared.members.length },
      })
    if (path.endsWith("/context")) return json({ data: { ...acme, two_step_required: shared?.twoStepRequired ?? false } })
    if (path.endsWith("/overview")) return json({ data: overview })
    if (path.endsWith("/runtime-status"))
      return json({ data: { state: "operational", live_data: "available", automations: "running", automation_fault: null, since: null, checked_at: "2026-10-09T00:00:00Z" } })
    return json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
  })
  return { errors }
}
