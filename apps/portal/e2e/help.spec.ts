import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a";
const other = "5d0c1f9e-7a44-4f7e-9d6b-0c1f2a3b4c5d";
const root = fileURLToPath(
  new URL("../../api/resources/help/", import.meta.url),
);
const contexts = JSON.parse(readFileSync(root + "contexts.json", "utf8"));
const articles = readdirSync(root)
  .filter((name) => name.endsWith(".md"))
  .map((name) => {
    const text = readFileSync(root + name, "utf8");
    const [, metadata, body] = /---\n([\s\S]*?)\n---\n([\s\S]*)/.exec(text)!;
    const chunks = body
      .split(/^## /m)
      .slice(1)
      .map((section) => {
        const [title, ...lines] = section.split("\n");
        return {
          id: title.toLowerCase().replaceAll(" ", "-"),
          title,
          html: `<p>${lines
            .join("\n")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replace(
              /\[([^\]]+)\]\((\/help\/[^)]+)\)/g,
              '<a href="$2">$1</a>',
            )}</p>`,
        };
      });
    return { ...JSON.parse(metadata), chunks };
  });

async function setup(page: Page, enabled = true) {
  const errors: string[] = [];
  const requests: Record<string, unknown>[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let runs: Record<string, unknown>[] = [];
  let hasConversation = false;
  const conversation = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Help conversation",
    scope: "help",
    profile_uuid: null,
    profile_name: null,
    updated_at: new Date().toISOString(),
  };
  const organization = {
    uuid: org,
    name: "Acme",
    slug: "acme",
    capabilities: {
      devices: {
        view: true,
        manage: true,
        command: true,
        activate: true,
        connections: true,
      },
      device_profiles: {
        view: true,
        view_any: true,
        create: true,
        update: true,
        validate: true,
        publish: true,
      },
    },
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      method = route.request().method();
    const data = (value: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ data: value }),
      });
    if (path === "/api/v1/me")
      return data({
        id: 1,
        name: "Operator",
        email: "operator@example.test",
        email_verified_at: "2026-01-01",
        capabilities: { platform_administration: false },
        organizations: [
          organization,
          {
            ...organization,
            uuid: other,
            name: "Northstar",
            slug: "northstar",
          },
        ],
      });
    if (path.endsWith("/context")) return data(organization);
    if (path.endsWith("/help/page")) {
      const key = url.searchParams.get("context")!;
      return data({
        key,
        ...contexts[key],
        articles: articles.filter((article) => article.contexts.includes(key)),
      });
    }
    if (path.endsWith("/help/articles")) {
      const query = url.searchParams.get("query")?.toLowerCase() ?? "";
      return data(
        articles.filter((article) =>
          JSON.stringify(article).toLowerCase().includes(query),
        ),
      );
    }
    if (path.includes("/help/articles/"))
      return data(
        articles.find((article) => path.endsWith("/" + article.slug)),
      );
    if (path.endsWith("/assistant/settings"))
      return data(
        url.searchParams.get("scope") === "help"
          ? { enabled }
          : {
              enabled: false,
              capabilities: organization.capabilities.device_profiles,
              schema: {},
              supported_extensions: [],
              max_file_bytes: 100000,
            },
      );
    if (path.endsWith("/assistant/conversations")) {
      if (method === "POST") {
        hasConversation = true;
        return data(conversation, 201);
      }
      return data(
        url.searchParams.get("scope") === "help" && hasConversation
          ? [conversation]
          : [],
      );
    }
    if (path.endsWith("/messages")) {
      const body = route.request().postDataJSON();
      requests.push(body);
      const selected = contexts[body.page_context];
      runs.push({
        id: crypto.randomUUID(),
        request_id: body.request_id,
        status: "completed",
        prompt: body.text,
        answer: "Review the documented steps, then confirm explicitly.",
        source_ids: [],
        usage: {},
        cost_usd: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        help_context: { key: body.page_context, title: selected.title },
        help_answer: {
          answer: "Review the documented steps, then confirm explicitly.",
          supported: true,
          citations: [
            {
              citation_id: `${selected.overview}#steps`,
              slug: selected.overview,
              heading: "steps",
              title: articles.find(
                (article) => article.slug === selected.overview,
              ).title,
              heading_title: "Steps",
              revision: 1,
            },
          ],
        },
      });
      return data(runs.at(-1), 202);
    }
    if (path.endsWith(`/assistant/conversations/${conversation.id}`)) {
      if (method === "DELETE") {
        runs = [];
        hasConversation = false;
        return route.fulfill({ status: 204 });
      }
      return data({
        ...conversation,
        runs,
        sources: [],
        proposals: [],
        onboarding_state: null,
        cursor: 0,
      });
    }
    if (path.endsWith("/events")) return data({ events: [], active: false });
    if (path.endsWith("/dag/node-types")) return data([]);
    if (path.endsWith("/settings") && path.includes("automation"))
      return data({ enabled: true, stopped: false });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        meta: { total: 0, current_page: 1, last_page: 1 },
      }),
    });
  });
  return { errors, requests };
}

const openHelp = async (page: Page) =>
  page
    .locator('[data-slot="page-header"]')
    .first()
    .getByRole("button", { name: "Help", exact: true })
    .click();

test("contextual guidance, citations and panel switching preserve unsaved workflow and question drafts", async ({
  page,
}) => {
  const { errors, requests } = await setup(page);
  await page.goto(`/organizations/${org}/automation/new`);
  await page.getByLabel("Name", { exact: true }).fill("Unsaved bench workflow");
  await openHelp(page);
  const help = page.getByRole("complementary", { name: "Assistant", exact: true });
  await expect(
    help.getByRole("heading", { name: "Build and activate automations" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Simulation", exact: true }).click();
  await expect(
    help.getByRole("heading", { name: "Simulate a saved workflow" }),
  ).toBeVisible();
  // In the automation editor the Ask tab opens on the workflow assistant; usage help is one toggle away.
  await help.getByRole("tab", { name: "Ask", exact: true }).click();
  await expect(
    help.getByRole("region", { name: "Automation assistant" }),
  ).toBeVisible();
  await help.getByRole("radio", { name: "Usage help" }).click();
  await help
    .getByLabel("Ask a usage question")
    .fill("Does simulation send commands?");
  // The shared Assistant control returns the Ask tab to the editor's assistant in the same panel.
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect(
    help.getByRole("region", { name: "Automation assistant" }),
  ).toBeVisible();
  await expect(help.getByLabel("Ask a usage question")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await page
    .locator('[data-slot="page-header"]')
    .first()
    .getByRole("button", { name: "Help", exact: true })
    .click();
  await help.getByRole("tab", { name: "Ask", exact: true }).click();
  await help.getByRole("radio", { name: "Usage help" }).click();
  await expect(help.getByLabel("Ask a usage question")).toHaveValue(
    "Does simulation send commands?",
  );
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Unsaved bench workflow",
  );
  await help.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    help.getByText("Review the documented steps, then confirm explicitly.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(Object.keys(requests[0]).sort()).toEqual([
    "page_context",
    "request_id",
    "text",
  ]);
  expect(requests[0].page_context).toBe("automation.simulation");
  await help
    .getByRole("button", { name: "Simulate a saved workflow · Steps" })
    .click();
  await expect(
    help.getByRole("heading", { name: "Simulate a saved workflow" }),
  ).toHaveCount(1);
  await expect(help.locator('[data-heading="steps"]')).toBeInViewport();
  await help.getByRole("button", { name: "Back to Ask" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Unsaved bench workflow",
  );
  await help.getByRole("button", { name: "Close assistant" }).click();
  await expect(help).toBeHidden();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect(
    help.getByRole("region", { name: "Automation assistant" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile Help fits the viewport, supports search and restores keyboard focus", async ({
  page,
}) => {
  const { errors } = await setup(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/organizations/${org}/dashboards`);
  await openHelp(page);
  const help = page.getByRole("dialog", { name: "Assistant", exact: true });
  await expect(
    help.getByRole("heading", { name: "Build and use dashboards" }),
  ).toBeVisible();
  await help.getByRole("tab", { name: "All guides" }).click();
  await help.getByLabel("Search guides").fill("quasar unicorn");
  await expect(help.getByText("No matching guides")).toBeVisible();
  await help.getByLabel("Search guides").fill("unit conversions");
  await help
    .getByRole("button", { name: /Define parameters and unit conversions/ })
    .click();
  await expect(
    help.getByRole("heading", {
      name: "Define parameters and unit conversions",
    }),
  ).toBeVisible();
  await help.getByRole("tab", { name: "Ask", exact: true }).click();
  await expect(
    help.getByText("Usage help unavailable", { exact: true }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  const bounds = await help.boundingBox();
  expect(bounds?.width).toBe(390);
  expect(bounds!.height).toBeLessThanOrEqual(844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(
    page
      .locator('[data-slot="page-header"]')
      .getByRole("button", { name: "Help", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});

test("all sections offer Help; navigation retains an article and organization switching clears private drafts", async ({
  page,
}) => {
  const { errors } = await setup(page);
  for (const section of [
    "dashboards",
    "alerts",
    "devices",
    "gateways",
    "telemetry",
    "geofences",
    "discovery",
    "device-profiles",
    "integrations",
    "automation",
  ]) {
    await page.goto(`/organizations/${org}/${section}`);
    await expect(
      page
        .locator('[data-slot="page-header"]')
        .first()
        .getByRole("button", { name: "Help", exact: true }),
    ).toBeVisible();
  }
  await page.goto(`/organizations/${org}/dashboards`);
  await openHelp(page);
  const help = page.getByRole("complementary", { name: "Assistant", exact: true });
  await help.getByRole("tab", { name: "All guides" }).click();
  await help.getByLabel("Search guides").fill("unit conversions");
  await help
    .getByRole("button", { name: /Define parameters and unit conversions/ })
    .click();
  await page.getByRole("link", { name: "Devices", exact: true }).click();
  await expect(
    help.getByRole("heading", {
      name: "Define parameters and unit conversions",
    }),
  ).toBeVisible();
  await help.getByRole("tab", { name: "Ask", exact: true }).click();
  await help.getByLabel("Ask a usage question").fill("Private Acme draft");
  await page.getByRole("button", { name: "Organization: Acme" }).click();
  await page.getByRole("menuitemradio", { name: "Northstar" }).click();
  await expect(page).toHaveURL(`/organizations/${other}/devices`);
  await help.getByRole("tab", { name: "Ask", exact: true }).click();
  await expect(help.getByLabel("Ask a usage question")).toHaveValue("");
  await expect(
    help.getByText("Guides and usage questions · Northstar"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
