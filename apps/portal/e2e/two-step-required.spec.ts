import { test, expect, type Page } from "@playwright/test"
import { acme, codeFor, fakeAccount, fakeOrganization, me, PASSWORD, serve, type FakeAccount } from "./support/two-step-api"

/** Required two-step sign-in (spec 034, US3), against a mocked API. */

/** A platform authenticator with user verification, like Touch ID, answering at once. */
async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
}

const home = `/organizations/${acme.uuid}/home`

/** Finishes setup on the setup-required page and returns where it went. */
async function setUpWhenAsked(page: Page) {
  await expect(page).toHaveURL(/\/account\/security\/setup\?return=/)
  await page.getByRole("button", { name: "Set up" }).click()
  const confirm = page.getByRole("dialog", { name: "Confirm it's you" })
  await confirm.getByLabel("Password").fill(PASSWORD)
  await confirm.getByRole("button", { name: "Confirm" }).click()

  const setupKey = (await page.getByTestId("two-step-setup-key").textContent())!.trim()
  await page.getByLabel("2. Enter the six-digit code the app shows").fill(codeFor(setupKey))
  await expect(page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem")).toHaveCount(8)
  await page.getByRole("checkbox", { name: "I have saved these codes" }).check()
  await page.getByRole("button", { name: "Done" }).click()
}

test("platform staff without two-step land on setup, then reach the page they asked for", async ({ page }) => {
  const account = fakeAccount({ platform: true })
  const { errors } = await serve(page, account, "laptop", { signedIn: true })
  await page.goto(`/organizations/${acme.uuid}/devices`)

  await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible()
  await expect(page.getByText("Two-step sign-in is required for platform staff.")).toBeVisible()
  // Only setup and sign-out: no workspace around it.
  await expect(page.getByRole("navigation")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible()

  await setUpWhenAsked(page)
  await expect(page).toHaveURL(new RegExp(`/organizations/${acme.uuid}/devices$`))
  expect(account.enabled).toBe(true)

  // Required two-step stays on: the security page says why and offers no Turn off (FR-023).
  await page.goto("/account/security")
  await expect(page.getByTestId("two-step-required-by")).toHaveText("Two-step sign-in is required for platform staff. It cannot be turned off.")
  await expect(page.getByRole("region", { name: "Two-step sign-in" }).getByRole("button", { name: "Turn off" })).toHaveCount(0)
  expect(errors).toEqual([])
})

test("platform staff go straight to setup after their password, even with no organization to open", async ({ page }) => {
  const account = fakeAccount({ platform: true, user: { ...me, organizations: [] } })
  const { errors } = await serve(page, account, "laptop")
  await page.goto("/")
  await page.getByLabel("Email address").fill(me.email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()

  await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible()
  await setUpWhenAsked(page)
  await expect(page.getByRole("heading", { name: "Choose an organization" })).toBeVisible()
  expect(errors).toEqual([])
})

test("an organization administrator requires two-step and a signed-in member is sent to setup on the next click", async ({ browser }) => {
  const organization = fakeOrganization()
  const administrator = fakeAccount({ organization, user: withAdministration({ ...me, id: 2, name: "Ada Admin", email: "ada@example.test" }) })
  administrator.enabled = true
  const member: FakeAccount = fakeAccount({ organization, user: { ...me, id: 3, name: "Max Member", email: "max@example.test" } })

  const adminPage = await (await browser.newContext()).newPage()
  const memberPage = await (await browser.newContext()).newPage()
  const adminRun = await serve(adminPage, administrator, "admin-laptop", { signedIn: true })
  const memberRun = await serve(memberPage, member, "member-laptop", { signedIn: true })

  // The member is working in the app.
  await memberPage.goto(home)
  await expect(memberPage.getByRole("navigation").first()).toBeVisible()

  // The administrator sees who has it, then requires it.
  await adminPage.goto(`/organizations/${acme.uuid}/settings/members`)
  const members = adminPage.getByRole("table", { name: "Members" })
  await expect(members.getByRole("row", { name: /Ada Admin/ }).getByText("On", { exact: true })).toBeVisible()
  await expect(members.getByRole("row", { name: /Max Member/ }).getByText("Not set up")).toBeVisible()

  await adminPage.getByRole("link", { name: "Security" }).click()
  await expect(adminPage.getByTestId("members-without-two-step")).toHaveText("1 member does not have two-step sign-in yet.")
  await adminPage.getByRole("switch", { name: "Require two-step sign-in" }).click()
  const confirm = adminPage.getByRole("alertdialog", { name: "Require two-step sign-in?" })
  await expect(confirm).toContainText("1 member without two-step sign-in will be asked to set it up")
  await confirm.getByRole("button", { name: "Require it" }).click()
  await expect(adminPage.getByRole("switch", { name: "Require two-step sign-in" })).toBeChecked()
  expect(organization.twoStepRequired).toBe(true)

  // The member's next click opens setup, then returns to where they were going.
  await memberPage.getByRole("link", { name: "Devices" }).first().click()
  await expect(memberPage.getByText("Acme requires two-step sign-in for every member.")).toBeVisible()
  await setUpWhenAsked(memberPage)
  await expect(memberPage).toHaveURL(new RegExp(`/organizations/${acme.uuid}/devices`))

  expect(adminRun.errors).toEqual([])
  expect(memberRun.errors).toEqual([])
})

test("an administrator without two-step is asked to set up their own first", async ({ page }) => {
  const organization = fakeOrganization()
  const administrator = fakeAccount({ organization, user: withAdministration(me) })
  await serve(page, administrator, "laptop", { signedIn: true })

  await page.goto(`/organizations/${acme.uuid}/settings/security`)
  await expect(page.getByRole("switch", { name: "Require two-step sign-in" })).toBeDisabled()
  await expect(page.getByTestId("organization-two-step-own-first")).toContainText("Set up two-step sign-in for your own account first")
})

test("an invited new person sets up two-step before reaching the app", async ({ page }) => {
  const organization = fakeOrganization()
  organization.twoStepRequired = true
  const invited = fakeAccount({ organization, user: { ...me, id: 4, name: "Nia New", email: "nia@example.test" } })
  const { errors } = await serve(page, invited, "phone")

  await page.goto("/accept-invitation?token=invite-token")
  await page.getByLabel("Name").fill("Nia New")
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByLabel("Confirm password").fill(PASSWORD)
  await page.getByRole("button", { name: "Create account and accept" }).click()
  await page.getByRole("link", { name: "Open tenant portal" }).click()

  await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible()
  await setUpWhenAsked(page)
  await expect(page).toHaveURL(new RegExp(`/organizations/${acme.uuid}/`))
  await expect(page.getByRole("navigation").first()).toBeVisible()
  expect(errors).toEqual([])
})

test("sign out from the setup page", async ({ page }) => {
  const account = fakeAccount({ platform: true })
  await serve(page, account, "laptop", { signedIn: true })
  await page.goto(home)
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible()
  expect(account.sessions.size).toBe(0)
})

/** The person administers the organization: Security and Members appear in its settings. */
function withAdministration(user: typeof me): typeof me {
  return {
    ...user,
    organizations: user.organizations.map((organization) => ({
      ...organization,
      capabilities: {
        ...organization.capabilities,
        manage_administration: true,
        administration: {
          members_view: true,
          invite: false,
          members_update: false,
          members_remove: false,
          roles_view: false,
          roles_create: false,
          roles_update: false,
          roles_delete: false,
        },
      },
    })),
  }
}

test.describe("with passkeys", () => {
  // WebAuthn refuses IP addresses, so these pages open on `localhost`.
  test.use({ baseURL: (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4173").replace("127.0.0.1", "localhost") })

  test("a passkey satisfies the requirement, and then the password alone asks for it", async ({ page }) => {
    await page.addInitScript(() => {
      PublicKeyCredential.isConditionalMediationAvailable = async () => false
    })
    await virtualAuthenticator(page)
    const account = fakeAccount({ platform: true })
    const { errors } = await serve(page, account, "laptop", { signedIn: true })
    await page.goto(home)

    // Setup offers a passkey instead of the authenticator app.
    await page.getByRole("button", { name: "Add a passkey instead" }).click()
    const confirm = page.getByRole("dialog", { name: "Confirm it's you" })
    const add = page.getByRole("dialog", { name: "Add a passkey" })
    await add.getByLabel("Name").fill("Laptop Touch ID")
    await add.getByRole("button", { name: "Add passkey" }).click()
    // Adding needs the password confirmed first.
    await confirm.getByLabel("Password").fill(PASSWORD)
    await confirm.getByRole("button", { name: "Confirm" }).click()
    await expect(page).toHaveURL(new RegExp(`${home}$`))
    expect(account.passkeys).toHaveLength(1)
    expect(account.enabled).toBe(false)

    // Signing in again: the right password asks for the passkey, never a code (FR-022).
    await page.getByRole("button", { name: me.name }).click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    await page.getByLabel("Email address").fill(me.email)
    await page.getByLabel("Password").fill(PASSWORD)
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Continue with your passkey" })).toBeVisible()
    await expect(page.getByLabel("Code from your authenticator app")).toHaveCount(0)
    expect(account.sessions.has("laptop")).toBe(false)
    await page.getByRole("button", { name: "Continue with your passkey" }).click()
    await expect(page).toHaveURL(/\/organizations\//)
    expect(errors).toEqual([])
  })
})

test("on a billing account's address the setup page carries its brand, not the platform's mark", async ({ page }) => {
  // Spec 036 FR-006: the pages around sign-in show the brand of the address.
  const brand = { product_name: "Acme Monitor", short_name: "Acme", support_url: "https://support.example.org/help", logo: null, logo_dark: null, icon: null, touch_icon: null, powered_by: "IoT OS" }
  await page.route("**/runtime-config.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.__IOT_CONFIG__ = ${JSON.stringify({ VITE_API_URL: "", address: { kind: "name", host: "127.0.0.1", state: "active" }, brand })};` }),
  )
  const { errors } = await serve(page, fakeAccount({ platform: true }), "laptop", { signedIn: true })
  await page.goto(`/organizations/${acme.uuid}/devices`)

  await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible()
  await expect(page.getByRole("main").getByText("Acme Monitor", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Help" })).toHaveAttribute("href", brand.support_url)
  await expect(page.getByText("Powered by IoT OS")).toBeVisible()
  expect(errors).toEqual([])
})
