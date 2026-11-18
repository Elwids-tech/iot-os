import { test, expect, type Page } from "@playwright/test"
import { codeFor, fakeAccount, me, PASSWORD, serve, type FakeAccount } from "./support/two-step-api"

/**
 * Passkeys (spec 034, US2) with Chrome's virtual authenticator, against a mocked API
 * that checks each answer's challenge, type and origin. WebAuthn refuses IP addresses,
 * so these pages open on `localhost`.
 */
test.use({ baseURL: (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4173").replace("127.0.0.1", "localhost") })

/** A platform authenticator with user verification, like Touch ID, answering at once. */
async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return {
    credentials: async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials,
  }
}

/**
 * The virtual authenticator answers the email field's passkey suggestions (conditional
 * mediation) at once, where a person would pick from a list. Tests of the button turn
 * the suggestions off, as in a browser without them.
 */
async function withoutAutofill(page: Page) {
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = async () => false
  })
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: me.name }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible()
}

async function addPasskey(page: Page, name: string) {
  await page.goto("/account/security")
  const panel = page.getByRole("region", { name: "Passkeys" })
  await expect(panel.getByText("No passkeys yet.")).toBeVisible()
  await panel.getByRole("button", { name: "Add a passkey" }).click()
  const dialog = page.getByRole("dialog", { name: "Add a passkey" })
  await dialog.getByLabel("Name").fill(name)
  await dialog.getByRole("button", { name: "Add passkey" }).click()
  return panel
}

async function confirmPassword(page: Page) {
  const confirm = page.getByRole("dialog", { name: "Confirm it's you" })
  await confirm.getByLabel("Password").fill(PASSWORD)
  await confirm.getByRole("button", { name: "Confirm" }).click()
}

test("add a passkey, sign in with it alone, remove it, and it no longer signs in", async ({ page }) => {
  const account = fakeAccount()
  const { errors } = await serve(page, account, "laptop", { signedIn: true })
  await withoutAutofill(page)
  const authenticator = await virtualAuthenticator(page)

  const panel = await addPasskey(page, "Virtual key")
  // The first change asks who it is (FR-013); the ceremony then runs on its own.
  await confirmPassword(page)
  await expect(page.getByText('Passkey "Virtual key" added')).toBeVisible()
  const row = panel.getByRole("row", { name: /Virtual key/ })
  await expect(row).toContainText("Not yet")
  expect(account.passkeys).toHaveLength(1)
  expect(account.mails).toContain("passkey_added:Virtual key")
  const [credential] = await authenticator.credentials()
  expect(credential.isResidentCredential).toBe(true)
  expect(credential.rpId).toBe("localhost")

  // Sign in with the passkey alone: no password and no code (FR-017).
  await signOut(page)
  const started = Date.now()
  await page.getByRole("button", { name: "Sign in with a passkey" }).click()
  await expect(page.getByRole("button", { name: me.name })).toBeVisible()
  expect(Date.now() - started).toBeLessThan(10_000)
  expect(account.logins).toEqual([])
  expect(account.passkeys[0].last_used_at).not.toBeNull()

  await page.goto("/account/security")
  await expect(row).not.toContainText("Not yet")
  await row.getByRole("button", { name: "Remove Virtual key" }).click()
  const confirm = page.getByRole("alertdialog", { name: "Remove Virtual key?" })
  await confirm.getByRole("button", { name: "Remove" }).click()
  await expect(page.getByText('Passkey "Virtual key" removed')).toBeVisible()
  await expect(panel.getByText("No passkeys yet.")).toBeVisible()
  expect(account.mails).toContain("passkey_removed:Virtual key")

  // The browser still holds it, but the account no longer accepts it.
  await signOut(page)
  await page.getByRole("button", { name: "Sign in with a passkey" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Passkey not recognized" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test("a passkey finishes a sign-in that waits for a code, and keeps the browser signed in", async ({ browser }) => {
  const account = fakeAccount()
  const context = await browser.newContext()
  const page = await context.newPage()
  await serve(page, account, "laptop", { signedIn: true })
  await withoutAutofill(page)
  await virtualAuthenticator(page)
  await addPasskey(page, "Laptop")
  await confirmPassword(page)
  await expect(page.getByText('Passkey "Laptop" added')).toBeVisible()
  enableTwoStep(account)
  await signOut(page)

  await page.getByLabel("Email address").fill(me.email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("checkbox", { name: "Keep me signed in" }).check()
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible()

  await page.getByRole("button", { name: "Use a passkey instead" }).click()
  await expect(page.getByRole("button", { name: me.name })).toBeVisible()
  expect(account.pending.has("laptop")).toBe(false)
  // Keep me signed in from the password step carried over to the passkey.
  expect(account.kept.has("laptop")).toBe(true)
  await context.close()
})

test("the email field suggests the browser's passkeys, and picking one signs in", async ({ page }) => {
  const account = fakeAccount()
  const { errors } = await serve(page, account, "laptop", { signedIn: true })
  await virtualAuthenticator(page)
  await addPasskey(page, "Laptop")
  await confirmPassword(page)
  await expect(page.getByText('Passkey "Laptop" added')).toBeVisible()

  await page.getByRole("button", { name: me.name }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  // The sign-in page asks for suggestions as it opens; the virtual authenticator picks one.
  await expect(page.getByRole("button", { name: me.name })).toBeVisible()
  expect(account.logins).toEqual([])
  expect(account.passkeys[0].last_used_at).not.toBeNull()
  expect(errors).toEqual([])
})

test("a browser that cannot offer passkey suggestions says nothing until the button is used", async ({ page }) => {
  const account = fakeAccount()
  await serve(page, account, "laptop")
  // No authenticator at all: the suggestions requested as the page opens fail quietly.
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.getByRole("alert")).toHaveCount(0)
})

test("the confirmation dialog offers the person's passkey instead of the password", async ({ page }) => {
  const account = fakeAccount()
  await serve(page, account, "laptop", { signedIn: true })
  await virtualAuthenticator(page)
  await addPasskey(page, "Laptop")
  await confirmPassword(page)
  await expect(page.getByText('Passkey "Laptop" added')).toBeVisible()
  account.passwordConfirmed.clear()

  const panel = page.getByRole("region", { name: "Passkeys" })
  await panel.getByRole("button", { name: "Add a passkey" }).click()
  const dialog = page.getByRole("dialog", { name: "Add a passkey" })
  await dialog.getByLabel("Name").fill("Laptop again")
  await dialog.getByRole("button", { name: "Add passkey" }).click()

  const confirm = page.getByRole("dialog", { name: "Confirm it's you" })
  await confirm.getByRole("button", { name: "Use a passkey" }).click()
  // Confirmed with the passkey; the authenticator already holds one for this account,
  // so the browser refuses to add it twice.
  await expect(dialog.getByText("This passkey is already added to your account.")).toBeVisible()
  expect(account.passwordConfirmed.has("laptop")).toBe(true)
  expect(account.passkeys).toHaveLength(1)
})

test("where passkeys need HTTPS, the page says so, sign-in has no passkey button, and codes still work", async ({ page }) => {
  const account = fakeAccount()
  account.passkeysUnavailable = true
  await serve(page, account, "laptop", { signedIn: true })
  await virtualAuthenticator(page)

  await page.goto("/account/security")
  const panel = page.getByRole("region", { name: "Passkeys" })
  await expect(panel.getByText("Passkeys need this site to be served over HTTPS.")).toBeVisible()
  await expect(panel.getByRole("button", { name: "Add a passkey" })).toHaveCount(0)

  await signOut(page)
  await expect(page.getByLabel("Email address")).toBeVisible()
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0)

  enableTwoStep(account)
  await page.getByLabel("Email address").fill(me.email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.getByRole("button", { name: "Use a passkey instead" })).toHaveCount(0)
  await page.getByLabel("Code from your authenticator app").fill(codeFor(account.secret!))
  await expect(page.getByRole("button", { name: me.name })).toBeVisible()
})

function enableTwoStep(account: FakeAccount) {
  account.enabled = true
  account.secret = "JBSWY3DPEHPK3PXP"
  account.confirmedAt = new Date().toISOString()
}
