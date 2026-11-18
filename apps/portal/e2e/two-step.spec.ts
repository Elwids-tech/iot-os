import { test, expect, type Page } from "@playwright/test"
import { codeFor, fakeAccount, me, PASSWORD, serve, type FakeAccount } from "./support/two-step-api"

/** Two-step sign-in with an authenticator app (spec 034, US1), against a mocked API. */

async function signIn(page: Page, { keep = false } = {}) {
  await page.goto("/")
  await page.getByLabel("Email address").fill(me.email)
  await page.getByLabel("Password").fill(PASSWORD)
  if (keep) await page.getByRole("checkbox", { name: "Keep me signed in" }).check()
  await page.getByRole("button", { name: "Sign in" }).click()
}

async function enterCode(page: Page, code: string) {
  await page.getByLabel("Code from your authenticator app").fill(code)
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: me.name }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()
}

/** Sets up two-step from the security page and returns the setup key and recovery codes. */
async function setUp(page: Page, account: FakeAccount) {
  await page.goto("/account/security")
  const panel = page.getByRole("region", { name: "Two-step sign-in" })
  await expect(panel.getByText("Not set up")).toBeVisible()
  await panel.getByRole("button", { name: "Set up" }).click()

  // The first change asks for the password again (FR-013).
  const confirm = page.getByRole("dialog", { name: "Confirm it's you" })
  await confirm.getByLabel("Password").fill(PASSWORD)
  await confirm.getByRole("button", { name: "Confirm" }).click()

  const dialog = page.getByRole("dialog", { name: "Set up two-step sign-in" })
  await expect(dialog.getByRole("img", { name: /QR code/ })).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/)
  const setupKey = (await dialog.getByTestId("two-step-setup-key").textContent())!.trim()
  expect(setupKey.replace(/\s+/g, "")).toBe(account.secret)

  await dialog.getByLabel("2. Enter the six-digit code the app shows").fill(codeFor(setupKey))
  await expect(dialog.getByText("Two-step sign-in is on")).toBeVisible()
  const codes = await dialog.getByRole("list", { name: "Recovery codes" }).getByRole("listitem").allTextContents()
  expect(codes).toHaveLength(8)
  expect(codes).toEqual(account.recoveryCodes)

  const done = dialog.getByRole("button", { name: "Done" })
  await expect(done).toBeDisabled()
  await dialog.getByRole("checkbox", { name: "I have saved these codes" }).check()
  await done.click()
  await expect(page.getByText("Two-step sign-in is on").first()).toBeVisible()
  await expect(panel.getByText("On", { exact: true })).toBeVisible()
  await expect(page.getByTestId("recovery-codes-remaining")).toHaveText("8 of 8 left")
  return { setupKey, codes }
}

test("set up two-step, save the codes, and sign in again with a code", async ({ page }) => {
  const account = fakeAccount()
  const { errors } = await serve(page, account, "laptop", { signedIn: true })
  const { setupKey } = await setUp(page, account)
  expect(account.mails).toEqual(["two_step_enabled"])

  await signOut(page)
  await signIn(page)
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible()

  // A wrong code says how many tries are left.
  const right = codeFor(setupKey, 1)
  await enterCode(page, right === "000000" ? "111111" : "000000")
  await expect(page.getByText("That code is not valid. 4 tries left.")).toBeVisible()

  await enterCode(page, right)
  await expect(page).toHaveURL(/\/organizations\//)
  expect(errors).toEqual([])
})

test("a recovery code signs in once and says how many are left", async ({ page }) => {
  const account = fakeAccount()
  const { errors } = await serve(page, account, "laptop", { signedIn: true })
  const { codes } = await setUp(page, account)
  await signOut(page)

  await signIn(page)
  await page.getByRole("button", { name: "Use a recovery code" }).click()
  await page.getByLabel("Recovery code").fill(codes[2])
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page.getByText("7 recovery codes left")).toBeVisible()
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page).toHaveURL(/\/organizations\//)
  expect(account.mails).toContain("recovery_code_used")

  // The same code fails on its second use.
  await signOut(page)
  await signIn(page)
  await page.getByRole("button", { name: "Use a recovery code" }).click()
  await page.getByLabel("Recovery code").fill(codes[2])
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page.getByText("That recovery code is not valid. 4 tries left.")).toBeVisible()
  expect(errors).toEqual([])
})

test("five wrong codes send the person back to the password", async ({ page }) => {
  const account = fakeAccount()
  await serve(page, account, "laptop", { signedIn: true })
  const { setupKey } = await setUp(page, account)
  await signOut(page)
  await signIn(page)

  const wrong = codeFor(setupKey, 1) === "000000" ? "111111" : "000000"
  for (const left of [4, 3, 2, 1]) {
    await enterCode(page, wrong)
    await expect(page.getByText(`That code is not valid. ${left} ${left === 1 ? "try" : "tries"} left.`)).toBeVisible()
  }
  await enterCode(page, wrong)
  await expect(page.getByRole("heading", { name: "Start again" })).toBeVisible()
  await page.getByRole("button", { name: "Start again" }).click()
  // The email stays; the password is entered again.
  await expect(page.getByLabel("Email address")).toHaveValue(me.email)
  await expect(page.getByLabel("Password")).toHaveValue("")
})

test("Keep me signed in on the password step keeps a new window signed in after the code", async ({ browser }) => {
  const account = fakeAccount()
  account.sessions.add("laptop")
  const first = await browser.newContext()
  const page = await first.newPage()
  await serve(page, account, "laptop")
  const { setupKey } = await setUp(page, account)
  await signOut(page)

  await signIn(page, { keep: true })
  await enterCode(page, codeFor(setupKey, 1))
  await expect(page).toHaveURL(/\/organizations\//)
  expect(account.logins.at(-1)).toEqual({ email: me.email, password: PASSWORD, remember: true })
  await first.close()

  // The browser is closed and opened again: no password and no code are asked.
  account.sessions.delete("laptop")
  const reopened = await browser.newContext()
  const again = await reopened.newPage()
  await serve(again, account, "laptop")
  await again.goto("/")
  await expect(again).toHaveURL(/\/organizations\//)
  await expect(again.getByRole("button", { name: "Sign in" })).toHaveCount(0)
  await reopened.close()
})

test("turning two-step on signs out the person's other browsers", async ({ browser }) => {
  const account = fakeAccount()
  const phoneContext = await browser.newContext()
  const phone = await phoneContext.newPage()
  await serve(phone, account, "phone", { signedIn: true })
  await phone.goto("/")
  await expect(phone).toHaveURL(/\/organizations\//)

  const laptopContext = await browser.newContext()
  const laptop = await laptopContext.newPage()
  await serve(laptop, account, "laptop", { signedIn: true })
  await setUp(laptop, account)

  await phone.reload()
  await expect(phone.getByRole("button", { name: "Sign in" })).toBeVisible()
  await laptop.reload()
  await expect(laptop.getByRole("heading", { name: "Security" })).toBeVisible()
  await phoneContext.close()
  await laptopContext.close()
})

test("make new recovery codes, then turn two-step off", async ({ page }) => {
  const account = fakeAccount()
  const { errors } = await serve(page, account, "laptop", { signedIn: true })
  const { codes } = await setUp(page, account)

  await page.getByRole("button", { name: "Make new codes" }).click()
  const fresh = page.getByRole("dialog", { name: "New recovery codes" })
  const items = fresh.getByRole("list", { name: "Recovery codes" }).getByRole("listitem")
  await expect(items).toHaveCount(8)
  const newCodes = await items.allTextContents()
  expect(newCodes.filter((code) => codes.includes(code))).toEqual([])
  await fresh.getByRole("checkbox", { name: "I have saved these codes" }).check()
  await fresh.getByRole("button", { name: "Done" }).click()

  await page.getByRole("button", { name: "Turn off" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Turn off" }).click()
  await expect(page.getByText("Two-step sign-in is off")).toBeVisible()
  const panel = page.getByRole("region", { name: "Two-step sign-in" })
  await expect(panel.getByText("Not set up")).toBeVisible()
  await expect(page.getByRole("region", { name: "Recovery codes" })).toHaveCount(0)
  expect(account.mails).toEqual(["two_step_enabled", "recovery_codes_regenerated", "two_step_disabled"])

  // With two-step off, the password alone signs in again.
  await signOut(page)
  await signIn(page)
  await expect(page).toHaveURL(/\/organizations\//)
  expect(errors).toEqual([])
})

test("a wrong password is refused and Cancel changes nothing", async ({ page }) => {
  const account = fakeAccount()
  await serve(page, account, "laptop", { signedIn: true })
  await page.goto("/account/security")
  await page.getByRole("button", { name: "Set up" }).click()
  const confirm = page.getByRole("dialog", { name: "Confirm it's you" })
  await confirm.getByLabel("Password").fill("not-the-password")
  await confirm.getByRole("button", { name: "Confirm" }).click()
  await expect(confirm.getByText("The provided password is incorrect.")).toBeVisible()
  await confirm.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Set up" })).toBeEnabled()
})
