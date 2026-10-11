import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a";
const id = "08b842d4-dbe9-44b7-a82f-8409bf31402a";
const device = "08b842d4-dbe9-44b7-a82f-8409bf31403a";
const base = `/organizations/${org}/integrations`;
async function setup(page: Page, manage = true) {
  const state: any = {
    app: null,
    hook: null,
    conflict: false,
    retried: false,
    attempts: 0,
  };
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      body = req.postDataJSON();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    const context = {
      uuid: org,
      name: "Test workspace",
      slug: "test",
      capabilities: { devices: { view: true, manage, command: false } },
    };
    if (path === "/api/v1/me")
      return reply({
        data: {
          id: 1,
          name: "Manager",
          email: "manager@example.test",
          email_verified_at: "2026-01-01",
          capabilities: { platform_administration: false },
          organizations: [context],
        },
      });
    if (path.endsWith("/context")) return reply({ data: context });
    if (path.endsWith("/devices"))
      return reply({
        data: [{ uuid: device, name: "Field tag", code: "tag-1" }],
        meta: { current_page: 1, last_page: 1, total: 1 },
      });
    if (path.endsWith("/applications")) {
      if (req.method() === "POST")
        state.app = {
          ...body,
          uuid: id,
          revision: 1,
          grant_revision: 1,
          revoked_at: null,
          credential: null,
          devices: [{ uuid: device, name: "Field tag", code: "tag-1" }],
        };
      return reply(
        {
          data:
            req.method() === "POST" ? state.app : state.app ? [state.app] : [],
        },
        req.method() === "POST" ? 201 : 200,
      );
    }
    if (path.endsWith("/token")) {
      state.app.revision++;
      state.app.credential = {
        abilities: body.abilities,
        expires_at: "2026-12-01T00:00:00Z",
      };
      return reply(
        {
          data: {
            application: state.app,
            token: "fixture-secret-token",
            expires_at: state.app.credential.expires_at,
          },
        },
        201,
      );
    }
    if (path.endsWith("/revoke")) {
      state.app.revoked_at = "2026-09-25";
      state.app.credential = null;
      state.app.revision++;
      if (state.hook) state.hook.enabled = false;
      return reply({ data: state.app });
    }
    if (path.endsWith("/webhook")) {
      if (req.method() === "PUT") {
        state.hook = {
          uuid: id,
          url: body.url,
          revision: (state.hook?.revision ?? 0) + 1,
          enabled: true,
          diagnostic: null,
          grant_revision: state.app.grant_revision,
        };
        return reply({
          data: { ...state.hook, signing_secret: "fixture-signing-secret" },
        });
      }
      return reply({ data: state.hook });
    }
    if (path.endsWith("/disable")) {
      state.hook.enabled = false;
      state.hook.revision++;
      return reply({ data: state.hook });
    }
    if (path.endsWith("/retry")) {
      state.retried = true;
      return reply({ data: { status: "pending" } }, 202);
    }
    if (path.endsWith("/deliveries"))
      return reply({
        data: [
          {
            uuid: id,
            status: state.retried ? "pending" : "failed",
            attempts: 1,
            retry_revision: 0,
            diagnostic: "Receiver unavailable",
            next_attempt_at: null,
            expires_at: "2026-12-01T00:00:00Z",
            delivered_at: null,
            history: [
              {
                attempt: 1,
                http_status: 503,
                outcome: "retryable",
                created_at: "2026-09-25T00:00:00Z",
              },
            ],
          },
        ],
        meta: { current_page: 1, last_page: 1, total: 1 },
      });
    if (path.endsWith("/" + id) && req.method() === "PUT") {
      if (state.conflict) {
        state.conflict = false;
        state.app.revision++;
        return reply({ message: "Changed" }, 409);
      }
      state.app = {
        ...state.app,
        ...body,
        revision: state.app.revision + 1,
        grant_revision: state.app.grant_revision + 1,
        credential: null,
      };
      if (state.hook) state.hook.enabled = false;
      return reply({ data: state.app });
    }
    return reply({ data: [] });
  });
  return { state, errors };
}
async function create(page: Page) {
  await page.goto(base);
  await page
    .getByRole("button", { name: "New application", exact: true })
    .click();
  await page.getByLabel("Application name").fill("Field application");
  for (const name of [
    "Device details",
    "Telemetry and location",
    "Alerts",
    "Alert and geofence event feed",
  ])
    await page.getByRole("checkbox", { name, exact: true }).check();
  await page.getByRole("combobox", { name: "Add a device" }).click();
  await page
    .getByRole("combobox", { name: "Search add a device" })
    .fill("Field");
  await page.getByRole("option", { name: "Field tag · tag-1" }).click();
  await page
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Field application", exact: true })
    .click();
}
async function confirm(page: Page, name: string) {
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name, exact: true })
    .click();
}

test("manager creates grants, handles secrets, webhook retries, conflicts and revocation", async ({
  page,
}) => {
  const { state, errors } = await setup(page);
  await create(page);
  expect(state.app.abilities).toHaveLength(4);
  await page.getByRole("button", { name: "Issue new token" }).click();
  await confirm(page, "Issue token");
  await expect(page.getByLabel("Application token value")).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByRole("button", { name: "Reveal secret" }).click();
  await expect(page.getByLabel("Application token value")).toHaveValue(
    "fixture-secret-token",
  );
  // Leave through the sidebar; the unsaved secret guard must still ask.
  await page.getByRole("link", { name: "Dashboards", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Leave without saving?",
  );
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.getByRole("button", { name: "I've stored it" }).click();
  await expect(page.getByLabel("Application token value")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
    ),
  ).not.toContain("fixture-secret-token");
  await page
    .getByLabel("Receiver URL")
    .fill("https://receiver.example.test/events");
  await page.getByRole("button", { name: "Configure / rotate key" }).click();
  await confirm(page, "Configure webhook");
  await expect(page.getByLabel("Webhook signing secret value")).toHaveValue(
    "fixture-signing-secret",
  );
  await page.getByRole("button", { name: "I've stored it" }).click();
  await page.getByText("Attempt history", { exact: true }).click();
  await expect(page.getByText(/HTTP 503/)).toBeVisible();
  await page
    .getByRole("button", { name: "Retry delivery", exact: true })
    .click();
  await confirm(page, "Retry delivery");
  await expect(page.getByText("Delivery queued for retry.")).toBeVisible();
  expect(state.retried).toBe(true);
  await page
    .getByRole("button", { name: "Disable webhook", exact: true })
    .click();
  await confirm(page, "Disable webhook");
  expect(state.hook.enabled).toBe(false);
  await page.getByLabel("Application name").fill("Edited application");
  state.conflict = true;
  await page.getByRole("button", { name: "Save grants", exact: true }).click();
  await confirm(page, "Save grants");
  await expect(page.getByRole("alertdialog")).toContainText("Another change");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByLabel("Application name")).toHaveValue(
    "Edited application",
  );
  await page.getByRole("button", { name: "Reload latest state" }).click();
  await confirm(page, "Reload");
  await expect(page.getByLabel("Application name")).toHaveValue(
    "Field application",
  );
  await page.getByLabel("Application name").fill("Updated application");
  await page.getByRole("button", { name: "Save grants", exact: true }).click();
  await confirm(page, "Save grants");
  await expect(
    page.getByText("No token is currently issued.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Revoke application", exact: true })
    .click();
  await confirm(page, "Revoke application");
  await expect(
    page.getByRole("button", { name: "Issue new token" }),
  ).toBeDisabled();
  expect(state.app.revoked_at).not.toBeNull();
  expect(errors).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("mobile forms preserve edits and fit viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await create(page);
  await page.getByLabel("Application name").fill("Unsaved mobile edit");
  await page.getByRole("link", { name: "Back to Integrations" }).click();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Application name")).toHaveValue(
    "Unsaved mobile edit",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/iot-integrations-mobile.png",
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("a one-time secret survives crossing the 1280px layout breakpoint", async ({
  page,
}) => {
  const { errors } = await setup(page);
  await create(page);
  await page.getByRole("button", { name: "Issue new token" }).click();
  await confirm(page, "Issue token");
  await page.getByRole("button", { name: "Reveal secret" }).click();
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Field application" }),
  ).toBeVisible();
  await expect(page.getByLabel("Application token value")).toHaveValue(
    "fixture-secret-token",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Field application" }),
  ).toBeVisible();
  await expect(page.getByLabel("Application token value")).toHaveValue(
    "fixture-secret-token",
  );
  expect(errors).toEqual([]);
});
test("viewer cannot open management tools", async ({ page }) => {
  await setup(page, false);
  await page.goto(base);
  await expect(
    page.getByText("Integrations unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New application", exact: true }),
  ).toHaveCount(0);
});

test("session expiry removes one-time secrets", async ({ page }) => {
  await setup(page);
  await create(page);
  await page.getByRole("button", { name: "Issue new token" }).click();
  await confirm(page, "Issue token");
  await expect(page.getByLabel("Application token value")).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("iot-session-expired")),
  );
  await expect(page.getByLabel("Application token value")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Restore your session", exact: true }),
  ).toBeVisible();
});
