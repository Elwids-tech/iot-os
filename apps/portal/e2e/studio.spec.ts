import { test, expect, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

const apiURL = process.env.STUDIO_API_URL ?? "http://127.0.0.1:8013"

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}
async function openProfiles(page: Page) {
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Device profiles", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "Device profiles", exact: true }),
  ).toBeVisible()
}
async function switchOrganization(page: Page, name: string) {
  await page.getByRole("button", { name: /^Organization: / }).click()
  await page.getByRole("menuitemradio", { name, exact: true }).click()
}
async function userMenu(page: Page, user: string) {
  await page.getByRole("button", { name: user }).click()
}
async function signOut(page: Page, user: string) {
  await userMenu(page, user)
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click()
}
async function login(page: Page) {
  await page.goto("/")
  await expect(page).toHaveTitle(/IoT/i)
  await page.getByLabel("Email address").fill("shared.operator@example.test")
  await page.getByLabel("Password", { exact: true }).fill("password")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.getByRole("link", { name: /Acme Manufacturing/ }).click()
  await openProfiles(page)
}
function resource(page: Page) {
  const match = new URL(page.url()).pathname.match(
    /organizations\/([^/]+)\/device-profiles(?:\/([^/]+))?/,
  )
  if (!match) throw new Error("Not on an organization profile route")
  return `/api/v1/organizations/${match[1]}/device-profiles${match[2] ? "/" + match[2] : ""}`
}
async function request(
  page: Page,
  method: string,
  path: string,
  data?: unknown,
) {
  const cookie = (await page.context().cookies(apiURL)).find(
    (item) => item.name === "XSRF-TOKEN",
  )
  return page.request.fetch(apiURL + path, {
    method,
    data,
    headers: {
      Accept: "application/json",
      Origin: new URL(page.url()).origin,
      Referer: page.url(),
      ...(cookie ? { "X-XSRF-TOKEN": decodeURIComponent(cookie.value) } : {}),
    },
  })
}
async function saved(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByText(/Saved draft \d+/)).toBeVisible()
}
async function createProfile(page: Page, name: string) {
  await page.getByRole("button", { name: "New profile", exact: true }).click()
  await page.getByLabel("Profile name", { exact: true }).fill(name)
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click()
  await saved(page)
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
}
async function addParameter(
  page: Page,
  label: string,
  key: string,
  kind = "Measurement",
) {
  await page.getByRole("button", { name: "Add parameter", exact: true }).click()
  await page.getByLabel("Label", { exact: true }).fill(label)
  await page.getByLabel("Key", { exact: true }).fill(key)
  if (kind !== "Measurement") await choose(page, "Kind", kind)
}
async function saveParameter(page: Page, existing = false) {
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: existing ? "Save parameter" : "Add parameter",
      exact: true,
    })
    .click()
  await saved(page)
}
async function section(page: Page, name: string) {
  await page
    .getByRole("tablist", { name: "Profile sections" })
    .getByRole("tab", { name, exact: true })
    .click()
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({
    path: info.outputPath(name + ".png"),
    fullPage: false,
  })
}
async function healthy(page: Page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame)
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    )
  })
  await expect(page.locator("vite-error-overlay")).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true)
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze()
  expect(
    result.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
  ).toEqual([])
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("Failed to load resource")
    )
      errors.push(message.text())
  })
  await login(page)
  ;(page as Page & { studioErrors: string[] }).studioErrors = errors
})
test.afterEach(async ({ page }) => {
  expect(
    (page as Page & { studioErrors?: string[] }).studioErrors ?? [],
  ).toEqual([])
})

test("tenant authoring, calculation, alarm CRUD and immutable publication", async ({
  page,
}, info) => {
  test.setTimeout(120000)
  await createProfile(page, "Energy meter studio")
  await page.getByRole("button", { name: /Manage parameter groups/ }).click()
  await page.getByRole("button", { name: "New group", exact: true }).click()
  await page.getByLabel("Group label").fill("Electrical")
  await page.getByLabel("Group code").fill("electrical")
  await page.getByRole("button", { name: "Save group" }).click()
  await saved(page)
  await addParameter(page, "Voltage", "voltage")
  await choose(page, "Group", "Electrical")
  await page.getByLabel("Stored unit").fill("V")
  await page.getByRole("tab", { name: "Validation", exact: true }).click()
  await choose(page, "Value constraints", "Number range")
  await page.getByLabel("Maximum (inclusive)").fill("480")
  await page.getByLabel("Sample value (JSON)", { exact: true }).fill("230")
  await page.getByRole("button", { name: "Test sample value" }).click()
  await expect(page.getByText("Sample accepted", { exact: true })).toBeVisible()
  await healthy(page)
  await screenshot(page, info, "parameter-validation-light")
  await saveParameter(page)
  await addParameter(page, "Double voltage", "voltage.double", "Derived")
  await saveParameter(page)
  await section(page, "Calculations")
  await page.getByRole("button", { name: "Add calculation" }).click()
  await choose(page, "Output", "Use existing derived parameter")
  await page.getByRole("button", { name: "Add named input" }).click()
  await choose(page, "Source parameter 1", "Voltage · voltage")
  await page.getByLabel("Input alias 1", { exact: true }).fill("voltage")
  await choose(page, "Operation", "Multiply")
  await choose(page, "Operand 1", "Parameter input")
  await page.getByLabel("Operand 2 value", { exact: true }).fill("2")
  await page.getByLabel("Sample voltage (JSON)").fill("230")
  await page.getByRole("button", { name: "Test formula" }).click()
  await expect(
    page.getByText("Formula result: 460", { exact: true }),
  ).toBeVisible()
  await screenshot(page, info, "calculation-builder")
  await page.getByRole("button", { name: "Save calculation" }).click()
  await saved(page)
  await section(page, "Alarm templates")
  await page.getByRole("button", { name: "Add alarm template" }).click()
  await page.getByLabel("Template name").fill("Missing voltage")
  await page.getByLabel("Template code").fill("missing-voltage")
  await page.getByRole("button", { name: "Add parameter reference" }).click()
  await choose(page, "Referenced parameter 1", "Voltage")
  await page.getByRole("button", { name: "Save alarm template" }).click()
  await saved(page)
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  await page.getByLabel("Maximum age (seconds)").fill("600")
  await page.getByRole("button", { name: "Save alarm template" }).click()
  await saved(page)
  await page.reload()
  await expect(page.getByText("Missing voltage", { exact: true })).toBeVisible()
  const path = resource(page)
  const draft = (await (await request(page, "GET", path)).json()).data
  expect(draft.alarm_templates[0].condition_config.max_age_seconds).toBe(600)
  expect(
    draft.parameters.find(
      (item: { key: string }) => item.key === "voltage.double",
    ).calculation.inputs[0].alias,
  ).toBe("voltage")
  await section(page, "Review and publish")
  await page
    .getByRole("button", { name: "Validate draft", exact: true })
    .click()
  await expect(
    page.getByText("Saved draft passed validation", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Publish revision 1", exact: true }),
  ).toBeEnabled()
  await expect(
    page.getByRole("cell", { name: "Energy meter studio", exact: true }),
  ).toBeVisible()
  await page.getByRole("tab", { name: "JSON", exact: true }).click()
  await expect(
    page.getByRole("textbox", { name: "Changes as JSON", exact: true }),
  ).toContainText("Energy meter studio")
  await healthy(page)
  await screenshot(page, info, "review-before-publish")
  await page
    .getByRole("button", { name: "Publish revision 1", exact: true })
    .click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Publish revision", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Inspect revision 1" }),
  ).toBeVisible()
  const first = (
    await (await request(page, "GET", path + "/artifacts/1")).json()
  ).data
  await section(page, "Overview")
  await page.getByLabel("Profile name").fill("Energy meter studio revised")
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(
    page.getByRole("heading", {
      name: "Energy meter studio revised",
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText("Unpublished changes", { exact: true }),
  ).toBeVisible()
  expect(
    (await (await request(page, "GET", path + "/artifacts/1")).json()).data
      .definition,
  ).toEqual(first.definition)
  await section(page, "Review and publish")
  await page
    .getByRole("button", { name: "Validate draft", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Publish revision 2", exact: true })
    .click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Publish revision", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Inspect revision 2" }),
  ).toBeVisible()
  expect(
    (await (await request(page, "GET", path + "/artifacts/1")).json()).data
      .definition,
  ).toEqual(first.definition)
  await page.getByRole("button", { name: "Inspect revision 1" }).click()
  const definition = page.getByRole("textbox", {
    name: "Published revision 1",
    exact: true,
  })
  await expect(definition).toHaveAttribute("aria-readonly", "true")
  await definition.focus()
  await expect(definition).toBeFocused()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Search", exact: true })
    .click()
  await expect(
    page.getByRole("textbox", { name: "Find", exact: true }),
  ).toBeVisible()
  await healthy(page)
  await screenshot(page, info, "published-history-json")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click()
  await section(page, "Alarm templates")
  await page.getByRole("button", { name: "Delete Missing voltage" }).click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click()
  await expect(
    page.getByText("No alarm templates yet.", { exact: false }),
  ).toBeVisible()
  await section(page, "Calculations")
  await page
    .getByRole("button", { name: "Delete calculation for Double voltage" })
    .click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click()
  await expect(page.getByText("No calculation configured yet")).toBeVisible()
})

test("cancel, navigation protection, duplicate keys, failed saves and session recovery", async ({
  page,
}, info) => {
  test.setTimeout(120000)
  await createProfile(page, "Editing safety")
  await addParameter(page, "Temperature", "temperature")
  await saveParameter(page)
  await page
    .getByRole("button", { name: "Edit Temperature", exact: true })
    .click()
  await page.getByLabel("Label", { exact: true }).fill("Not saved")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click()
  await expect(page.getByRole("alertdialog")).toContainText(
    "Discard unsaved changes?",
  )
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click()
  await expect(page.getByLabel("Label", { exact: true })).toHaveValue(
    "Not saved",
  )
  // Cancel asks the same question as closing the sheet (N7).
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click()
  await expect(page.getByRole("alertdialog")).toContainText(
    "Discard unsaved changes?",
  )
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Discard changes", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Temperature", exact: true }),
  ).toBeVisible()
  await addParameter(page, "Duplicate", "temperature")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add parameter", exact: true })
    .click()
  await expect(page.getByLabel("Key", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  )
  await expect(page.getByLabel("Key", { exact: true })).toBeFocused()
  await screenshot(page, info, "duplicate-key-error")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Discard changes", exact: true })
    .click()
  await section(page, "Overview")
  await page.getByLabel("Profile name").fill("Keep this local edit")
  await section(page, "Parameters")
  await expect(page.getByRole("alertdialog")).toContainText(
    "Leave without saving?",
  )
  await page.getByRole("button", { name: "Keep editing", exact: true }).click()
  await expect(page.getByLabel("Profile name")).toHaveValue(
    "Keep this local edit",
  )
  await switchOrganization(page, "Northstar Utilities")
  await expect(page.getByRole("alertdialog")).toBeVisible()
  await page.getByRole("button", { name: "Keep editing", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Organization: Acme Manufacturing" }),
  ).toBeVisible()
  const path = resource(page)
  await page.route("**" + path, async (route) =>
    route.request().method() === "PATCH"
      ? route.abort("failed")
      : route.continue(),
  )
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(
    page.getByText("Action needs attention", { exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel("Profile name")).toHaveValue(
    "Keep this local edit",
  )
  await page.unroute("**" + path)
  expect((await request(page, "POST", "/api/v1/auth/logout")).ok()).toBe(true)
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(
    page.getByRole("dialog", { name: "Restore your session" }),
  ).toBeVisible()
  await page.getByLabel("Session password").fill("password")
  await page
    .getByRole("button", { name: "Restore session", exact: true })
    .click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByLabel("Profile name")).toHaveValue(
    "Keep this local edit",
  )
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Keep this local edit", exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByLabel("Profile name")).toHaveValue(
    "Keep this local edit",
  )
})

test("stale draft review retains local changes and rebases explicitly", async ({
  page,
}, info) => {
  await createProfile(page, "Concurrent authoring")
  await section(page, "Overview")
  await page.getByLabel("Profile name").fill("My reviewed name")
  const path = resource(page)
  const draft = (await (await request(page, "GET", path)).json()).data
  expect(
    (
      await request(page, "PATCH", path, {
        draft_revision: draft.draft_revision,
        name: "A colleague's saved name",
      })
    ).ok(),
  ).toBe(true)
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.getByText(/Another change was saved/)).toBeVisible()
  await expect(page.getByLabel("Profile name")).toHaveValue("My reviewed name")
  await page.getByRole("button", { name: "Review latest saved values" }).click()
  await expect(
    page.getByRole("textbox", { name: "Latest saved values" }),
  ).toContainText("A colleague's saved name")
  await screenshot(page, info, "concurrent-change-review")
  await page
    .getByRole("button", { name: "Keep my edits on latest revision" })
    .click()
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "My reviewed name", exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByLabel("Profile name")).toHaveValue("My reviewed name")
})

test("group CRUD, keyboard reorder and referenced deletion safety", async ({
  page,
}) => {
  await createProfile(page, "Group management")
  await page.getByRole("button", { name: /Manage parameter groups/ }).click()
  for (const name of ["Electrical", "Environment"]) {
    await page.getByRole("button", { name: "New group", exact: true }).click()
    await page.getByLabel("Group label").fill(name)
    await page.getByLabel("Group code").fill(name.toLowerCase())
    await page.getByRole("button", { name: "Save group" }).click()
    await saved(page)
  }
  await page
    .getByRole("button", { name: "Edit group Electrical", exact: true })
    .click()
  await page.getByLabel("Group label").fill("Energy")
  await page.getByRole("button", { name: "Save group" }).click()
  await saved(page)
  await page
    .getByRole("button", { name: "Reorder groups", exact: true })
    .click()
  await page.getByRole("button", { name: "Move group Environment up" }).focus()
  await page.keyboard.press("Enter")
  await page.getByRole("button", { name: "Save order", exact: true }).click()
  await expect(
    page.getByText("Unsaved group order", { exact: true }),
  ).toHaveCount(0)
  await addParameter(page, "Temperature", "temperature")
  await choose(page, "Group", "Environment")
  await saveParameter(page)
  await addParameter(page, "Current", "current")
  await choose(page, "Group", "Energy")
  await saveParameter(page)
  await page.getByRole("button", { name: "Reorder", exact: true }).click()
  await page.getByRole("button", { name: "Move Current up" }).focus()
  await page.keyboard.press("Enter")
  await page.getByRole("button", { name: "Save order", exact: true }).click()
  await expect(
    page.getByText("Unsaved parameter order", { exact: true }),
  ).toHaveCount(0)
  const path = resource(page)
  let draft = (await (await request(page, "GET", path)).json()).data
  expect(draft.parameters[0].key).toBe("current")
  expect(draft.parameter_groups[0].label).toBe("Environment")
  await page
    .getByRole("button", { name: "Delete group Environment", exact: true })
    .click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Delete group Environment", exact: true }),
  ).toHaveCount(0)
  draft = (await (await request(page, "GET", path)).json()).data
  const temperature = draft.parameters.find(
    (item: { key: string }) => item.key === "temperature",
  )
  expect(temperature.parameter_group_uuid).toBeNull()
  expect(
    (
      await request(page, "POST", path + "/alarm-templates", {
        draft_revision: draft.draft_revision,
        code: "stale",
        name: "Temperature stale",
        type: "staleness",
        severity: "warning",
        enabled_by_default: true,
        condition_config: { max_age_seconds: 300 },
        parameter_references: [
          { parameter_uuid: temperature.uuid, role: "subject" },
        ],
      })
    ).ok(),
  ).toBe(true)
  await page.reload()
  await page
    .getByRole("button", { name: "Delete Temperature", exact: true })
    .click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click()
  await expect(page.getByRole("alertdialog")).toContainText("Temperature stale")
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Delete Current", exact: true })
    .click()
  const beforeDelete = (await (await request(page, "GET", path)).json()).data
  expect(
    (
      await request(page, "PATCH", path, {
        draft_revision: beforeDelete.draft_revision,
        description: "Concurrent change before deletion",
      })
    ).ok(),
  ).toBe(true)
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click()
  await expect(page.getByRole("alertdialog")).toContainText(
    "Another change was saved",
  )
  await page
    .getByRole("button", { name: "Reload latest draft", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Current", exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Delete Current", exact: true })
    .click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Current", exact: true }),
  ).toHaveCount(0)
})

test("guided values and advanced JSON preserve custom configuration", async ({
  page,
}) => {
  await createProfile(page, "Lossless configuration")
  await addParameter(page, "Mode", "mode", "State")
  await choose(page, "Data type", "string")
  await page.getByRole("tab", { name: "Validation", exact: true }).click()
  await choose(page, "Value constraints", "Allowed values")
  let typed = ""
  for (const character of "blink\nstrobe\nrainbow") {
    await page
      .getByLabel("Allowed values", { exact: true })
      .press(character === "\n" ? "Enter" : character)
    typed += character
    await expect(
      page.getByLabel("Allowed values", { exact: true }),
    ).toHaveValue(typed)
  }
  await expect(page.getByLabel("Allowed values", { exact: true })).toHaveValue(
    "blink\nstrobe\nrainbow",
  )
  await saveParameter(page)
  const path = resource(page)
  let draft = (await (await request(page, "GET", path)).json()).data
  expect(draft.parameters[0].validation_logic.rule.in[1]).toEqual([
    "blink",
    "strobe",
    "rainbow",
  ])
  const custom = {
    engine: "json_logic",
    rule: { if: [{ "===": [{ var: "value" }, "blink"] }, true, false] },
    diagnostic_code: "mode",
    message: "Choose blink",
    vendor_metadata: { retained: true },
  }
  const display = {
    widget: "select",
    options: ["blink", "strobe"],
    vendor: { color: "custom" },
  }
  expect(
    (
      await request(
        page,
        "PATCH",
        path + "/parameters/" + draft.parameters[0].uuid,
        {
          draft_revision: draft.draft_revision,
          validation_logic: custom,
          display_config: display,
        },
      )
    ).ok(),
  ).toBe(true)
  await page.reload()
  await page.getByRole("button", { name: "Edit Mode", exact: true }).click()
  await page.getByRole("tab", { name: "Validation", exact: true }).click()
  await expect(
    page.getByText("Custom validation is preserved", { exact: true }),
  ).toBeVisible()
  await page.getByRole("tab", { name: "Advanced", exact: true }).click()
  await expect(
    page.getByRole("textbox", { name: "Validation rule", exact: true }),
  ).toContainText("vendor_metadata")
  await page
    .getByRole("textbox", { name: "Display settings", exact: true })
    .fill(JSON.stringify({ ...display, custom: { version: 2 } }))
  await page.getByRole("tab", { name: "Basics", exact: true }).click()
  await page
    .getByLabel("Description", { exact: true })
    .fill("Guided edit keeps custom fields")
  await saveParameter(page, true)
  await page.reload()
  draft = (await (await request(page, "GET", path)).json()).data
  expect(draft.parameters[0].validation_logic).toEqual(custom)
  expect(draft.parameters[0].display_config).toEqual({
    ...display,
    custom: { version: 2 },
  })
})

test("large profiles, light/dark/mobile layouts and tenant read-only permissions", async ({
  page,
}, info) => {
  await page
    .getByRole("link", { name: "Large device profile", exact: true })
    .click()
  await section(page, "Parameters")
  await expect(page.getByText("500 parameters", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Sensor 0001", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Sensor 0026", exact: true }),
  ).toBeVisible()
  await page.getByLabel("Search parameters").fill("Sensor 0499")
  await expect(
    page.getByRole("button", { name: "Sensor 0499", exact: true }),
  ).toBeVisible()
  await expect(page.getByText("1 parameter", { exact: true })).toBeVisible()
  await healthy(page)
  await screenshot(page, info, "desktop-light")
  await userMenu(page, "Shared Operations Admin")
  await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await healthy(page)
  await screenshot(page, info, "desktop-dark")
  await page.setViewportSize({ width: 390, height: 844 })
  await healthy(page)
  await screenshot(page, info, "mobile-dark")
  await page
    .getByRole("button", { name: "Edit Sensor 0499", exact: true })
    .click()
  await healthy(page)
  await screenshot(page, info, "mobile-parameter-editor")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click()
  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  await switchOrganization(page, "Northstar Utilities")
  await expect(
    page.getByRole("heading", { name: "Device profiles", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "New profile", exact: true }),
  ).toHaveCount(0)
  expect(
    (
      await request(page, "POST", resource(page), {
        code: "not-allowed",
        name: "Not allowed",
      })
    ).status(),
  ).toBe(403)
  await page.reload()
  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  await expect(
    page.getByRole("button", { name: "Organization: Northstar Utilities" }),
  ).toBeVisible()
})

test("tenant invitation acceptance for new and existing accounts", async ({
  page,
}) => {
  await signOut(page, "Shared Operations Admin")
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible()
  await page.goto("/accept-invitation?token=" + "a".repeat(64))
  await expect(
    page.getByRole("heading", { name: "Create your account", exact: true }),
  ).toBeVisible()
  await page.getByLabel("Name", { exact: true }).fill("Studio author")
  await page.getByLabel("Password", { exact: true }).fill("new-studio-password")
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("new-studio-password")
  await page.getByRole("button", { name: "Create account and accept" }).click()
  await expect(
    page.getByRole("heading", { name: "Account ready" }),
  ).toBeVisible()
  await page.getByRole("link", { name: "Open tenant portal" }).click()
  await openProfiles(page)
  await expect(
    page.getByRole("button", { name: "New profile", exact: true }),
  ).toBeVisible()
  await signOut(page, "Studio author")
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible()
  await page.goto("/accept-invitation?token=" + "a".repeat(64))
  await expect(
    page.getByRole("heading", { name: "Invitation unavailable" }),
  ).toBeVisible()
  await page.goto("/accept-invitation?token=" + "b".repeat(64))
  await expect(
    page.getByRole("heading", { name: "Sign in to accept invitation" }),
  ).toBeVisible()
  await page.getByLabel("Password", { exact: true }).fill("password")
  await page.getByRole("button", { name: "Sign in and accept" }).click()
  await expect(
    page.getByRole("heading", { name: "Account ready" }),
  ).toBeVisible()
  await page.getByRole("link", { name: "Open tenant portal" }).click()
  await page.getByRole("link", { name: /Northstar Utilities/ }).click()
  await openProfiles(page)
  await expect(
    page.getByRole("button", { name: "New profile", exact: true }),
  ).toHaveCount(0)
})
test("directory filters and safe deletion persist after reload", async ({
  page,
}, info) => {
  await createProfile(page, "Disposable draft")
  await section(page, "Overview")
  await page.getByLabel("Category", { exact: true }).fill("Testing")
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled()
  await page
    .getByRole("link", { name: "Back to Device profiles", exact: true })
    .click()
  await page.getByLabel("Search profiles").fill("Disposable")
  await page.getByLabel("Category", { exact: true }).fill("Testing")
  await choose(page, "Status", "Draft / unpublished changes")
  await expect(
    page.getByRole("link", { name: "Disposable draft", exact: true }),
  ).toBeVisible()
  await healthy(page)
  await screenshot(page, info, "profile-directory")
  await page
    .getByRole("button", { name: "Delete Disposable draft", exact: true })
    .click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click()
  await expect(
    page.getByRole("link", { name: "Disposable draft", exact: true }),
  ).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByText("No matching profiles", { exact: true }),
  ).toBeVisible()
})
