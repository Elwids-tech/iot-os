#!/usr/bin/env node
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { verifyLifecycle } from "./verify-device-lifecycle.mjs"
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  require = createRequire(join(root, "apps/portal/package.json"))
const { chromium, expect } = require("@playwright/test"),
  AxeBuilder = require("@axe-core/playwright").default
const env = JSON.parse(readFileSync(process.argv[2], "utf8")),
  resources = JSON.parse(
    readFileSync(join(env.directory, "verified-resources.json"), "utf8"),
  )
const portal = `http://127.0.0.1:${env.ports.portal}`,
  admin = `http://127.0.0.1:${env.ports.admin}`,
  apiURL = `http://127.0.0.1:${env.ports.api}`
const basePath = `/organizations/${resources.org}`,
  apiPath = `/api/v1/organizations/${resources.org}/devices`
const browser = await chromium.launch(),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage(),
  errors = []
page.on("pageerror", (error) => errors.push(error.message))
page.setDefaultTimeout(15000)
async function choose(label, value) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByRole("option", { name: value, exact: true }).click()
}
async function api(method, path, data) {
  const cookie = (await context.cookies(apiURL)).find(
    (c) => c.name === "XSRF-TOKEN",
  )
  const response = await page.request.fetch(apiURL + path, {
    method,
    data,
    headers: {
      Accept: "application/json",
      Origin: portal,
      "X-XSRF-TOKEN": decodeURIComponent(cookie?.value ?? ""),
    },
  })
  assert.ok(
    response.ok(),
    `${method} ${path}: ${response.status()} ${await response.text()}`,
  )
  return response.json()
}
async function shot(name) {
  await page.screenshot({
    path: join(env.directory, name + ".png"),
    fullPage: true,
  })
}
async function healthy() {
  assert.deepEqual(errors, [], "No unhandled browser errors")
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "No page overflow",
  )
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze()
  assert.deepEqual(
    audit.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
    "Accessible device page",
  )
}
try {
  await page.goto(portal + basePath + "/devices")
  await page.getByLabel("Email address").fill("shared.operator@example.test")
  await page.getByLabel("Password", { exact: true }).fill("password")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Devices", exact: true }),
  ).toBeVisible()
  // Release only the simulator test record from the preceding isolated integration run.
  const bound = (await api("GET", apiPath + "?per_page=100")).data.find(
    (d) =>
      d.candidate?.uuid === resources.meter.candidate.uuid &&
      d.lifecycle !== "archived" &&
      /^(Test meter|Browser meter )/.test(d.name),
  )
  let old = (
    await api(
      "GET",
      apiPath + "/" + (bound?.uuid ?? resources.meter.device.uuid),
    )
  ).data
  if (old.lifecycle !== "archived") {
    if (old.applied_configuration_uuid) {
      await api("POST", apiPath + `/${old.uuid}/deactivate`, {
        draft_revision: old.draft_revision,
      })
      await expect
        .poll(
          async () => {
            old = (await api("GET", apiPath + "/" + old.uuid)).data
            return old.applied_configuration_uuid
          },
          { timeout: 20000 },
        )
        .toBeNull()
    }
    await api("POST", apiPath + `/${old.uuid}/archive`, {
      draft_revision: old.draft_revision,
    })
  }
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Discovery", exact: true })
    .click()
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: /^meter\b/ }) })
    .getByRole("button", { name: "Onboard", exact: true })
    .click()
  await page.getByRole("button", { name: "Register new device" }).click()
  const name = "Browser meter " + randomUUID().slice(0, 6)
  await page.getByLabel("Device name", { exact: true }).fill(name)
  await page
    .getByLabel("Device code", { exact: true })
    .fill(name.toLowerCase().replaceAll(" ", "-"))
  await page
    .getByRole("dialog", { name: "Register device" })
    .getByRole("button", { name: "Register device", exact: true })
    .click()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await choose(
    "Device profile",
    resources.meter.artifact.definition.profile.name,
  )
  await page
    .getByRole("combobox", { name: "Published revision", exact: true })
    .click()
  await page.getByRole("option", { name: /^Revision 1/ }).click()
  // Full name matches are selected up front and collapse to a summary; otherwise suggest them.
  const suggest = page.getByRole("button", { name: "Suggest matching metrics" })
  await expect(
    page.getByRole("button", { name: "Review", exact: true }).or(suggest),
  ).toBeVisible()
  if (await suggest.isVisible()) await suggest.click()
  // Apply saves, checks against the captured birth and applies in one step.
  await page.getByRole("button", { name: "Apply", exact: true }).click()
  await expect(page.getByText("Applied", { exact: true }).first()).toBeVisible({
    timeout: 20000,
  })
  const deviceUUID = new URL(page.url()).pathname.split("/")[4]
  await verifyLifecycle({ page, context, expect, api, apiPath, deviceUUID, shot, healthy })
  resources.meter.device = (await api("GET", apiPath + "/" + deviceUUID)).data
  writeFileSync(
    join(env.directory, "verified-resources.json"),
    JSON.stringify(resources, null, 2),
    { mode: 0o600 },
  )
  await page.getByRole("tab", { name: "Measurements", exact: true }).click()
  await expect(
    page.getByRole("cell", { name: /^Average voltage/ }),
  ).toBeVisible()
  await shot("devices-measurements-desktop-light")
  await healthy()
  await page.getByRole("tab", { name: "History", exact: true }).click()
  await expect(page.locator(".recharts-wrapper")).toBeVisible()
  await shot("devices-history-desktop-light")
  await page.getByRole("tab", { name: "Overview", exact: true }).click()
  await page
    .getByLabel("Description", { exact: true })
    .fill("Keep this unsaved device note")
  await api("POST", "/api/v1/auth/logout")
  const recovery = page.getByRole("dialog", { name: "Restore your session" })
  await expect(recovery).toBeVisible({ timeout: 20000 })
  await recovery.getByLabel("Session password").fill("password")
  await recovery.getByRole("button", { name: "Restore session" }).click()
  await expect(recovery).toHaveCount(0)
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "Keep this unsaved device note",
  )
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(
    page.getByText("No unsaved changes", { exact: true }),
  ).toBeVisible()
  await page.goto(
    portal + basePath + `/devices/${resources.light.device.uuid}/commands`,
  )
  await choose("Control parameter", "Power")
  const latest = (
    await api(
      "GET",
      apiPath + `/${resources.light.device.uuid}/measurements/latest`,
    )
  ).data
  await choose(
    "Proposed value",
    latest.find((r) => r.key === "power").value ? "Off / false" : "On / true",
  )
  await page
    .getByRole("button", { name: "Prepare command", exact: true })
    .click()
  await expect(page.getByRole("alertdialog")).toContainText(
    "30-second execution deadline",
  )
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirm and send" })
    .click()
  await expect(
    page
      .getByRole("row")
      .nth(1)
      .getByText("Target state observed", { exact: true }),
  ).toBeVisible({ timeout: 20000 })
  await page.getByRole("tab", { name: "Commands", exact: true }).focus()
  await page.keyboard.press("Home")
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("End")
  await expect(
    page.getByRole("tab", { name: "Commands", exact: true }),
  ).toHaveAttribute("aria-selected", "true")
  await shot("devices-commands-desktop-light")
  await healthy()
  await page.getByRole("button", { name: /theme/i }).click()
  await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await shot("devices-commands-mobile-dark")
  await healthy()
  const historyScroll = page.locator('[data-slot="table-container"]')
  await historyScroll.focus()
  await page.keyboard.press("ArrowRight")
  await expect
    .poll(() => historyScroll.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0)
  console.log(
    "PASS browser discovery, registration, mapping, activation, charts, command confirmation, session recovery, desktop/mobile, keyboard navigation and accessibility",
  )
  const adminContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    adminPage = await adminContext.newPage()
  await adminPage.goto(admin + "/settings/retention")
  await adminPage
    .getByLabel("Email", { exact: true })
    .fill("super-admin@example.test")
  await adminPage.getByLabel("Password", { exact: true }).fill("password")
  await adminPage.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(
    adminPage.getByRole("heading", {
      name: "Measurement retention",
      exact: true,
    }),
  ).toBeVisible()
  await adminPage
    .getByRole("switch", { name: "Use the 90-day fallback" })
    .click()
  await adminPage.getByLabel("Retention in days").fill("120")
  await adminPage
    .getByRole("button", { name: "Save retention", exact: true })
    .click()
  await expect(adminPage.getByText("Retention settings saved.")).toBeVisible()
  await adminPage.getByRole("combobox", { name: "Settings for" }).click()
  await adminPage
    .getByRole("option", { name: "Acme Manufacturing", exact: true })
    .click()
  await expect(
    adminPage.getByText(/Effective retention: 120 days/),
  ).toBeVisible()
  await adminPage
    .getByRole("switch", { name: "Inherit the platform default" })
    .click()
  await adminPage.getByLabel("Retention in days").fill("30")
  await adminPage
    .getByRole("button", { name: "Save retention", exact: true })
    .click()
  await expect(adminPage.getByRole("alertdialog")).toContainText(
    "permanent deletion",
  )
  await adminPage
    .getByRole("button", { name: "Confirm reduction", exact: true })
    .click()
  await expect(
    adminPage.getByText(/Effective retention: 30 days/),
  ).toBeVisible()
  await adminPage.screenshot({
    path: join(env.directory, "devices-retention-admin.png"),
    fullPage: true,
  })
  await adminPage
    .getByRole("switch", { name: "Inherit the platform default" })
    .click()
  await adminPage
    .getByRole("button", { name: "Save retention", exact: true })
    .click()
  await expect(
    adminPage.getByText(/Effective retention: 120 days/),
  ).toBeVisible()
  console.log(
    "PASS administration retention defaults, organization overrides, reduction confirmation, and restored inheritance",
  )
  writeFileSync(
    join(env.directory, "verified-resources.json"),
    JSON.stringify(resources, null, 2),
    { mode: 0o600 },
  )
} catch (error) {
  await shot("devices-browser-failure")
  writeFileSync(
    join(env.directory, "devices-browser-failure.txt"),
    await page.locator("body").innerText(),
  )
  throw error
} finally {
  await browser.close()
}
