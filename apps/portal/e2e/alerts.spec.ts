import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const org = "18b842d4-dbe9-44b7-a82f-8409bf31401a";
const gps = "18b842d4-dbe9-44b7-a82f-8409bf314d01";
const meter = "18b842d4-dbe9-44b7-a82f-8409bf314d02";
const geofence = "18b842d4-dbe9-44b7-a82f-8409bf314f01";
const voltage = "18b842d4-dbe9-44b7-a82f-8409bf314f02";
const base = `/organizations/${org}/alerts`;
// Alert links must be UUIDs; anything else reads as a broken link.
const alertIds = { a1: "a0000000-0000-4000-8000-000000000001", a2: "a0000000-0000-4000-8000-000000000002", a3: "a0000000-0000-4000-8000-000000000003" };
const settings = `/organizations/${org}/settings/notifications`;
const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60000).toISOString();
const members = [
  { id: 1, name: "Manager", email: "manager@example.test" },
  { id: 2, name: "Operator Two", email: "operator@example.test" },
];

type Alert = Record<string, unknown> & { uuid: string };
type Operation = { uuid: string; target: string; generation: number; status: string; polls: number };
/** Records a pending deployment the way WorkflowDeploymentService does. */
function start(workflow: Record<string, unknown>, uuid: string, target: string): Operation {
  const generation = (workflow.deployment_generation as number) + 1;
  Object.assign(workflow, {
    deployment_generation: generation,
    deployment_status: "pending",
    pending_operation_uuid: uuid,
  });
  return { uuid, target, generation, status: "pending", polls: 0 };
}
const view = (workflow: Record<string, unknown>, op: Operation) => ({
  uuid: op.uuid,
  generation: op.generation,
  draft_revision: workflow.draft_revision,
  target: op.target,
  status: op.status,
  stopped_reason: null,
  diagnostic: null,
  created_at: new Date().toISOString(),
  completed_at: op.status === "pending" ? null : new Date().toISOString(),
});
async function setup(page: Page, manage = true) {
  const alert = (
    uuid: string,
    workflow: string,
    device: string,
    episode: number,
    extra: Record<string, unknown>,
  ): Alert => ({
    uuid,
    workflow_uuid: workflow,
    workflow_name: workflow === geofence ? "GPS demo geofence" : "Phase voltage band",
    operation_uuid: uuid,
    device_uuid: device,
    device_name: device === gps ? "GPS tracker" : "Energy meter",
    episode,
    condition: "active",
    activated_at: ago(19),
    cleared_at: null,
    acknowledged_at: null,
    acknowledged_by: null,
    acknowledged_by_name: null,
    assignee: null,
    assigned_at: null,
    execution_stopped_reason: null,
    ...extra,
  });
  const state = {
    alerts: [
      alert(alertIds.a3, geofence, gps, 3, {}),
      alert(alertIds.a2, voltage, meter, 2, {
        condition: "cleared",
        activated_at: ago(130),
        cleared_at: ago(100),
        acknowledged_at: ago(120),
        acknowledged_by: 1,
        acknowledged_by_name: "Manager",
      }),
      alert(alertIds.a1, geofence, gps, 1, {
        condition: "cleared",
        activated_at: ago(300),
        cleared_at: ago(280),
        assignee: members[1],
        assigned_at: ago(290),
      }),
    ],
    comments: [] as Record<string, unknown>[],
    queries: [] as URLSearchParams[],
    acknowledgements: [] as Record<string, unknown>[],
    eventQueries: [] as URLSearchParams[],
    preferences: {
      revision: 0,
      email_enabled: true,
      operations_access: false,
      grid: Object.fromEntries(
        ["workflow", "service", "watchdog"].map((source) => [
          source,
          { critical: true, warning: true, info: false, recovery: false },
        ]),
      ),
    } as Record<string, unknown>,
    retried: false,
    bellReads: [] as Record<string, unknown>[],
    assigned: undefined as number | null | undefined,
    saved: null as Record<string, unknown> | null,
    posts: [] as Record<string, unknown>[],
    ops: {} as Record<string, Operation>,
    loseNextResponse: false,
    workflows: {
      [geofence]: {
        uuid: geofence,
        name: "GPS demo geofence",
        draft_revision: 2,
        deployment_generation: 1,
        deployment_status: "applied",
        applied_deployment_uuid: "op-0",
        pending_operation_uuid: null as string | null,
      },
      [voltage]: {
        uuid: voltage,
        name: "Phase voltage band",
        draft_revision: 1,
        deployment_generation: 0,
        deployment_status: "inactive",
        applied_deployment_uuid: null,
        pending_operation_uuid: null as string | null,
      },
    } as Record<string, Record<string, unknown>>,
    settings: {
      [geofence]: { enabled: true, notify_on_clear: true, recipient_ids: [1] },
      [voltage]: { enabled: false, notify_on_clear: false, recipient_ids: [] },
    } as Record<string, { enabled: boolean; notify_on_clear: boolean; recipient_ids: number[] }>,
  };
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(`/api/v1/organizations/${org}`, "");
    const body = req.postData() ? req.postDataJSON() : null;
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    const page1 = (data: unknown[]) => ({
      data,
      meta: { current_page: 1, last_page: 1, total: data.length },
    });
    const context = {
      uuid: org,
      name: "Test workspace",
      slug: "test",
      capabilities: {
        devices: { view: true, manage, activate: manage, connections: false, command: false },
      },
    };
    if (url.pathname === "/api/v1/me")
      return reply({
        data: {
          id: 1,
          name: "Manager",
          email: "manager@example.test",
          email_verified_at: "2026-01-01",
          is_super_admin: false,
          capabilities: { platform_administration: false },
          organizations: [context],
        },
      });
    if (path === "/context") return reply({ data: context });
    // The alert bell in the header (spec 022).
    if (path === "/alert-notifications/summary")
      return reply({ data: { unread: 0, newest_unread_activation_id: null } });
    if (path === "/alert-notifications/read") {
      state.bellReads.push(body);
      return reply({ data: { unread: 0, newest_unread_activation_id: null } });
    }
    const matching = (q: URLSearchParams) =>
      state.alerts.filter(
        (a) =>
          (!q.get("condition") || a.condition === q.get("condition")) &&
          (!q.get("acknowledged") ||
            (q.get("acknowledged") === "1") === Boolean(a.acknowledged_at)) &&
          (!q.get("device") || a.device_uuid === q.get("device")) &&
          (!q.get("workflow") || a.workflow_uuid === q.get("workflow")) &&
          (!q.get("assignee") || String(a.assignee?.id) === q.get("assignee")),
      );
    if (path === "/alerts") {
      const q = url.searchParams;
      state.queries.push(q);
      const rows = matching(q);
      if (q.get("group") === "source") {
        const groups = new Map<string, Alert[]>();
        for (const a of rows) {
          const key = `${a.workflow_uuid}|${a.device_uuid}`;
          groups.set(key, [...(groups.get(key) ?? []), a]);
        }
        const data = [...groups.values()].map((items) => ({
          workflow_uuid: items[0].workflow_uuid,
          device_uuid: items[0].device_uuid,
          occurrences: items.length,
          unacknowledged: items.filter((a) => !a.acknowledged_at).length,
          active: items.filter((a) => a.condition === "active").length,
          first_activated_at: items.at(-1)!.activated_at,
          last_activated_at: items[0].activated_at,
          latest: items[0],
        }));
        return reply({ data, meta: { current_page: 1, last_page: 1, total: data.length } });
      }
      return reply({
        data: rows.slice(0, Number(q.get("per_page") ?? 25)),
        meta: { current_page: 1, last_page: 1, total: rows.length },
      });
    }
    if (path === "/alerts/acknowledge") {
      state.acknowledgements.push(body);
      const targets = body.alert_uuids
        ? state.alerts.filter((a) => body.alert_uuids.includes(a.uuid))
        : matching(
            new URLSearchParams({
              workflow: body.workflow_uuid,
              device: body.device_uuid,
              ...(body.condition && { condition: body.condition }),
            }),
          );
      const fresh = targets.filter((a) => !a.acknowledged_at);
      for (const a of fresh)
        Object.assign(a, {
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: 1,
          acknowledged_by_name: "Manager",
        });
      return reply({ data: { acknowledged: fresh.length } });
    }
    if (url.pathname === "/api/v1/notifications/events") {
      state.eventQueries.push(url.searchParams);
      const events = [
        {
          uuid: "e2",
          source: "workflow",
          severity: "warning",
          status: "firing",
          active: true,
          title: "GPS demo geofence",
          summary: "Workflow condition activated; episode 3.",
          service: null,
          environment: null,
          link: `${base}/${alertIds.a3}`,
          labels: null,
          occurred_at: ago(19),
          last_seen_at: ago(19),
          occurrences: 1,
        },
        {
          uuid: "e1",
          source: "service",
          severity: "critical",
          status: "resolved",
          active: false,
          title: "ApiUnhealthy",
          summary: "API readiness restored",
          service: "api",
          environment: "staging",
          link: null,
          labels: null,
          occurred_at: ago(60),
          last_seen_at: ago(60),
          occurrences: 2,
        },
      ].filter(
        (e) =>
          !url.searchParams.get("status") ||
          (url.searchParams.get("status") === "active") === e.active,
      );
      return reply({
        data: events,
        summary: { critical: 0, warning: 1, info: 0, resolved: 1, sources: { workflow: 1, service: 0, watchdog: 0 } },
        meta: { current_page: 1, last_page: 1, total: events.length },
      });
    }
    if (url.pathname === "/api/v1/notifications/preferences") {
      if (req.method() === "PUT")
        state.preferences = { ...body, revision: (body.revision as number) + 1 };
      return reply({ data: state.preferences });
    }
    const alertMatch = path.match(/^\/alerts\/([0-9a-f-]{36})(\/.*)?$/);
    if (alertMatch) {
      const item = state.alerts.find((a) => a.uuid === alertMatch[1])!;
      const suffix = alertMatch[2] ?? "";
      if (suffix === "/acknowledge") {
        Object.assign(item, {
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: 1,
          acknowledged_by_name: "Manager",
        });
        return reply({ data: item });
      }
      if (suffix === "/assignee") {
        state.assigned = body.user_id;
        Object.assign(item, {
          assignee: members.find((m) => m.id === body.user_id) ?? null,
          assigned_at: body.user_id ? new Date().toISOString() : null,
        });
        return reply({ data: item });
      }
      if (suffix === "/comments") {
        if (req.method() === "POST") {
          state.comments.push({
            uuid: body.uuid,
            body: body.body,
            created_by: 1,
            author_name: "Manager",
            created_at: new Date().toISOString(),
          });
          return reply({ data: body }, 201);
        }
        return reply(page1(state.comments));
      }
      if (suffix.endsWith("/retry")) {
        state.retried = true;
        return reply({ data: { status: "pending" } }, 202);
      }
      if (suffix === "/deliveries")
        return reply({
          data: [
            {
              uuid: "d1",
              recipient_id: 1,
              recipient_name: "Manager",
              type: "activated",
              status: "sent",
              attempts: 1,
              retry_generation: 0,
              history: [{ attempt: 1, status: "accepted", created_at: ago(18) }],
              sent_at: ago(18),
              diagnostic: null,
            },
            {
              uuid: "d2",
              recipient_id: 2,
              recipient_name: "Operator Two",
              type: "activated",
              status: state.retried ? "pending" : "failed",
              attempts: 1,
              retry_generation: 0,
              history: [{ attempt: 1, status: "failed", created_at: ago(17) }],
              sent_at: null,
              diagnostic: "Mailbox unavailable",
            },
          ],
        });
      return reply({ data: item });
    }
    if (path === "/dashboards")
      return reply({
        data: [
          {
            uuid: "dash-1",
            name: "Fleet overview",
            widgets: [{ id: "w1", config: { sources: [{ device_uuid: gps }] } }],
          },
          {
            uuid: "dash-2",
            name: "Energy",
            widgets: [{ id: "w2", config: { sources: [{ device_uuid: meter }] } }],
          },
        ],
      });
    if (path === "/devices")
      return reply(
        page1([
          { uuid: gps, name: "GPS tracker", code: "gps-1" },
          { uuid: meter, name: "Energy meter", code: "meter-1" },
        ]),
      );
    if (path === "/workflows") return reply(page1(Object.values(state.workflows)));
    const workflowMatch = path.match(/^\/workflows\/([^/]+)(\/.*)?$/);
    if (workflowMatch) {
      const workflow = state.workflows[workflowMatch[1]];
      const suffix = workflowMatch[2] ?? "";
      if (suffix === "/notification-recipients") return reply(page1(members));
      if (suffix === "/notifications") {
        const settings = state.settings[workflowMatch[1]];
        if (req.method() === "PUT") {
          state.saved = body;
          Object.assign(settings, {
            enabled: body.enabled,
            notify_on_clear: body.notify_on_clear,
            recipient_ids: body.recipient_ids,
          });
        }
        return reply({
          data: {
            workflow_name: workflow.name,
            revision: state.saved ? 1 : 0,
            ...settings,
            recipients: members.filter((m) => settings.recipient_ids.includes(m.id)),
          },
        });
      }
      if (suffix === "/deployments" && req.method() === "POST") {
        state.posts.push({ ...body });
        const existing = state.ops[body.operation_uuid];
        if (!existing) {
          if (
            body.expected_generation !== workflow.deployment_generation ||
            workflow.pending_operation_uuid
          )
            return reply({ message: "Workflow changed. Reload before deploying." }, 409);
          state.ops[body.operation_uuid] = start(workflow, body.operation_uuid, body.target_state);
        }
        // The server applied the request but the response never arrives.
        if (state.loseNextResponse) {
          state.loseNextResponse = false;
          return route.abort("failed");
        }
        return reply({ data: workflow, deployment: view(workflow, state.ops[body.operation_uuid]) }, 202);
      }
      if (suffix.startsWith("/deployments/")) {
        const op = state.ops[suffix.split("/")[2]];
        if (!op) return reply({ message: "Not found." }, 404);
        op.polls++;
        if (op.status === "pending" && op.polls > 1) {
          op.status = "succeeded";
          Object.assign(workflow, {
            deployment_status: op.target === "inactive" ? "inactive" : "applied",
            applied_deployment_uuid: op.target === "inactive" ? null : op.uuid,
            pending_operation_uuid: null,
          });
        }
        return reply({ data: workflow, deployment: view(workflow, op) });
      }
      return reply({ data: workflow });
    }
    return reply({ data: [] });
  });
  return { state, errors };
}

/** Makes TanStack Query treat the window as refocused, which refetches stale queries. */
const refocus = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("filters the list, then acknowledges, assigns, retries and comments in the detail", async ({
  page,
}) => {
  const { state, errors } = await setup(page);
  await page.goto(base);
  // Active alerts first, repeats of one workflow on one device grouped.
  const sources = page.getByRole("list", { name: "Alert sources" }).getByRole("listitem");
  await expect(sources).toHaveCount(1);
  await expect(page.getByRole("radio", { name: "Active 1" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Cleared 2" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Grouped" })).toBeChecked();
  await expect(page.getByText("Episode", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Summary" })).toContainText("Active now");
  await page.getByRole("radio", { name: /^All/ }).click();
  await expect(page).toHaveURL(/condition=all/);
  await expect(sources).toHaveCount(2);
  await expect(sources.first()).toContainText("GPS demo geofence — GPS tracker");
  await expect(sources.first()).toContainText("2 occurrences");
  await expect(sources.first()).toContainText("Active for 19 min");
  await expect(sources.nth(1)).toContainText("Cleared after 30 min");
  await page.getByRole("radio", { name: "Individual" }).click();
  await expect(page).toHaveURL(/view=individual/);
  const episodes = page.getByRole("list", { name: "Alerts" }).getByRole("listitem");
  await expect(episodes).toHaveCount(3);
  await page.getByLabel("Unacknowledged only").click();
  await expect(page.getByLabel("Unacknowledged only")).toBeChecked();
  await expect(page).toHaveURL(/acknowledged=0/);
  await expect(episodes).toHaveCount(2);
  // Device and workflow live in the Filters popover; the button counts active ones.
  await page.getByRole("button", { name: "Filters" }).click();
  await pick(page, "Device", "GPS tracker");
  await expect(page).toHaveURL(new RegExp(`device=${gps}`));
  await pick(page, "Workflow", "GPS demo geofence");
  await expect(page).toHaveURL(new RegExp(`workflow=${geofence}`));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Filters, 2 active" })).toBeVisible();
  await expect
    .poll(() =>
      state.queries.some(
        (q) =>
          q.get("acknowledged") === "0" &&
          q.get("device") === gps &&
          q.get("workflow") === geofence &&
          q.get("per_page") !== "1",
      ),
    )
    .toBe(true);
  await expect(episodes).toHaveCount(2);

  await page
    .getByRole("link", { name: "GPS demo geofence — GPS tracker", exact: true })
    .first()
    .click();
  const detail = page.getByRole("region", { name: "Alert detail" });
  await expect(
    detail.getByRole("heading", { name: "GPS demo geofence — GPS tracker" }),
  ).toBeVisible();
  await expect(detail.getByText("Occurrence 3", { exact: true })).toBeVisible();
  await expect(detail.getByText("Unacknowledged", { exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: "GPS tracker" })).toHaveAttribute(
    "href",
    `/organizations/${org}/devices/${gps}`,
  );
  await expect(detail.getByRole("link", { name: "Fleet overview" })).toHaveAttribute(
    "href",
    `/organizations/${org}/dashboards/dash-1`,
  );
  await expect(detail.getByRole("link", { name: "Energy" })).toHaveCount(0);
  await expect(
    detail.getByRole("link", { name: "GPS demo geofence", exact: true }),
  ).toHaveAttribute("href", `${settings}/${geofence}`);

  await detail.getByRole("button", { name: "Acknowledge alert" }).click();
  await expect(detail.getByText("Acknowledged by Manager")).toBeVisible();
  await expect(detail.getByRole("button", { name: "Acknowledge alert" })).toHaveCount(0);
  await expect(detail.getByText("Active", { exact: true }).first()).toBeVisible();

  // The other occurrences of this workflow on this device; one cleared one is still unacknowledged.
  const occurrences = detail.getByRole("list", { name: "Recent occurrences" });
  await expect(occurrences.getByRole("listitem")).toHaveCount(2);
  await expect(detail.getByRole("link", { name: "Show all 2" })).toHaveAttribute(
    "href",
    `${base}?view=individual&condition=all&workflow=${geofence}&device=${gps}`,
  );
  await detail.getByRole("button", { name: "Acknowledge all cleared (1)" }).click();
  await expect(detail.getByText("Acknowledged 1 cleared alert.")).toBeVisible();
  expect(state.acknowledgements.at(-1)).toEqual({
    workflow_uuid: geofence,
    device_uuid: gps,
    condition: "cleared",
  });
  await expect(detail.getByRole("button", { name: /Acknowledge all cleared/ })).toHaveCount(0);

  await pick(page, "Assignee", "Operator Two");
  await expect(detail.getByText("Assigned to Operator Two")).toBeVisible();
  expect(state.assigned).toBe(2);

  await detail.getByRole("button", { name: "Retry email" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Retry email" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(state.retried).toBe(true);

  await detail.getByLabel("Add a comment").fill("Checked with dispatch.");
  await detail.getByRole("button", { name: "Add comment" }).click();
  await expect(detail.getByText("Comment by Manager")).toBeVisible();
  await expect(detail.getByText("Checked with dispatch.")).toBeVisible();

  expect(errors).toEqual([]);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
});

test("notification settings live in Settings, list the email state and disable a workflow after confirming", async ({
  page,
}) => {
  const { state, errors } = await setup(page);
  await page.goto(base);
  await page.getByRole("link", { name: "Notification settings" }).click();
  await expect(page).toHaveURL(new RegExp(`${settings}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Notifications" }),
  ).toHaveAttribute("aria-current", "page");
  const row = page.getByRole("row", { name: /GPS demo geofence/ });
  await expect(row).toContainText("Active");
  await expect(row).toContainText("On");
  await expect(row).toContainText("1");
  await expect(row).toContainText("Email");
  await expect(page.getByRole("row", { name: /Phase voltage band/ })).toContainText("Off");

  await page.getByRole("link", { name: "GPS demo geofence", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${settings}/${geofence}$`));
  await expect(page.getByRole("heading", { level: 1, name: "GPS demo geofence" })).toBeVisible();
  await expect(page.getByRole("link", { name: /alerts?$/ })).toHaveAttribute(
    "href",
    `${base}?condition=all&workflow=${geofence}`,
  );
  const detail = page.getByRole("region", { name: "Workflow notifications" });
  await expect(detail.getByText("Draft revision 2")).toBeVisible();
  await expect(detail.getByRole("button", { name: "Activate" })).toBeDisabled();
  await expect(detail.getByText("Already active")).toBeVisible();
  await detail.getByRole("button", { name: "Disable workflow" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Disable GPS demo geofence?");
  await dialog.getByRole("button", { name: "Disable workflow" }).click();
  await expect(detail.getByText("Workflow disabled.")).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toMatchObject({
    target_state: "inactive",
    draft_revision: 2,
    expected_generation: 1,
  });
  expect(Object.values(state.ops)[0].polls).toBeGreaterThan(1);
  await expect(detail.getByText("Inactive", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Activate" })).toBeEnabled();
  await expect(detail.getByRole("button", { name: "Disable workflow" })).toBeDisabled();

  await detail.getByLabel("Email when the condition clears").click();
  await detail.getByRole("button", { name: "Save notification settings" }).click();
  await expect(detail.getByText("Notification settings saved.")).toBeVisible();
  expect(state.saved).toMatchObject({ notify_on_clear: false, recipient_ids: [1] });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Back to Notifications" }).click();
  await expect(row).toContainText("No email");

  expect(errors).toEqual([]);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
});

test("a lost deployment response is resolved before retrying, so it is never sent twice", async ({
  page,
}) => {
  const { state, errors } = await setup(page);
  await page.goto(`${settings}/${geofence}`);
  // CSS locator: the open dialog hides the page from the accessibility tree.
  const detail = page.locator("section[aria-label='Workflow notifications']");
  await detail.getByRole("button", { name: "Disable workflow" }).click();
  const dialog = page.getByRole("alertdialog");
  state.loseNextResponse = true;
  await dialog.getByRole("button", { name: "Disable workflow" }).click();
  await expect(dialog).toContainText("Action needs attention");
  // A refocus refetches the workflow, whose generation has moved on in the meantime.
  await refocus(page);
  await expect(detail.getByText("Inactive", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Disable workflow" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(detail.getByText("Workflow disabled.")).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(Object.keys(state.ops)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("after our operation settles, polling follows another user's operation", async ({ page }) => {
  const { state } = await setup(page);
  await page.goto(`${settings}/${geofence}`);
  const detail = page.getByRole("region", { name: "Workflow notifications" });
  await detail.getByRole("button", { name: "Disable workflow" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disable workflow" }).click();
  await expect(detail.getByText("Workflow disabled.")).toBeVisible();
  state.ops["op-other"] = start(state.workflows[geofence], "op-other", "active");
  await refocus(page);
  await expect(detail.getByText("Waiting for the runtime to confirm…")).toBeVisible();
  await expect(detail.getByText("Active", { exact: true })).toBeVisible();
  await expect(detail.getByText("Workflow disabled.")).toHaveCount(0);
  expect(state.ops["op-other"].polls).toBeGreaterThan(1);
});

test("opening an alert reads its notifications in the bell once", async ({ page }) => {
  const { state, errors } = await setup(page, false);
  await page.goto(`${base}/${alertIds.a3}`);
  await expect(page.getByRole("heading", { name: /GPS demo geofence/ }).first()).toBeVisible();
  await expect.poll(() => state.bellReads).toEqual([{ alert_uuid: alertIds.a3 }]);
  // Refreshing the detail does not read it again.
  await refocus(page);
  await page.waitForTimeout(500);
  expect(state.bellReads).toEqual([{ alert_uuid: alertIds.a3 }]);
  await page.goto(`${base}/${alertIds.a2}`);
  await expect.poll(() => state.bellReads).toEqual([{ alert_uuid: alertIds.a3 }, { alert_uuid: alertIds.a2 }]);
  expect(errors).toEqual([]);
});

test("drafts survive crossing the 1280px layout breakpoint", async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${base}/${alertIds.a3}`);
  await page.getByLabel("Add a comment").fill("Draft kept across layouts");
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(
    page.getByRole("heading", { level: 1, name: "GPS demo geofence — GPS tracker" }),
  ).toBeVisible();
  await expect(page.getByLabel("Add a comment")).toHaveValue("Draft kept across layouts");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole("list", { name: "Alert sources" })).toBeVisible();
  await expect(page.getByLabel("Add a comment")).toHaveValue("Draft kept across layouts");
  expect(errors).toEqual([]);
});

test("mobile shows one pane at a time without sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await setup(page);
  await page.goto(base);
  await page.getByRole("link", { name: "GPS demo geofence — GPS tracker", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "GPS demo geofence — GPS tracker" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Alert sources" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Back to Alerts" }).click();
  await expect(page.getByRole("list", { name: "Alert sources" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(`${settings}/${geofence}`);
  await expect(page.getByRole("heading", { level: 1, name: "GPS demo geofence" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("viewers read alerts without management actions", async ({ page }) => {
  await setup(page, false);
  await page.goto(`${base}/${alertIds.a1}`);
  const detail = page.getByRole("region", { name: "Alert detail" });
  await expect(detail.getByText("Operator Two", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Notification settings" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Acknowledge alert" })).toHaveCount(0);
  await expect(detail.getByRole("combobox", { name: "Assignee" })).toHaveCount(0);
  await expect(detail.getByLabel("Add a comment")).toHaveCount(0);
  await expect(detail.getByRole("list", { name: "Recent occurrences" })).toBeVisible();
  await expect(detail.getByRole("button", { name: /Acknowledge all cleared/ })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /^Select/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Acknowledge selected/ })).toHaveCount(0);
  // The old address redirects into Settings, which explains the missing access.
  await page.goto(`${base}/notifications`);
  await expect(page).toHaveURL(new RegExp(`${settings}$`));
  await expect(page.getByText("Settings unavailable")).toBeVisible();
});

test("acknowledges whole sources after confirming and single selected alerts directly", async ({
  page,
}) => {
  const { state, errors } = await setup(page);
  Object.assign(state.alerts[1], { acknowledged_at: null, acknowledged_by: null, acknowledged_by_name: null });
  await page.goto(`${base}?condition=all`);
  const sources = page.getByRole("list", { name: "Alert sources" }).getByRole("listitem");
  await expect(sources.first()).toContainText("2 occurrences over 5 h · 2 unacknowledged");
  await page.getByRole("checkbox", { name: "Select GPS demo geofence — GPS tracker" }).check();
  await expect(page.getByText("1 source selected")).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge selected (2)" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Acknowledge 2 alerts?");
  await dialog.getByRole("button", { name: "Acknowledge" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Acknowledged 2 alerts.")).toBeVisible();
  // "All" sends no condition, so every unacknowledged alert of the source is acknowledged.
  expect(state.acknowledgements).toEqual([{ workflow_uuid: geofence, device_uuid: gps }]);
  await expect(sources.first()).toContainText("all acknowledged");
  await expect(page.getByRole("checkbox", { name: "Select GPS demo geofence — GPS tracker" })).toBeDisabled();

  await page.getByRole("radio", { name: "Individual" }).click();
  const rows = page.getByRole("list", { name: "Alerts" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(page.getByRole("checkbox", { name: "Select every alert on this page" })).toBeEnabled();
  await page.getByRole("checkbox", { name: "Select every alert on this page" }).check();
  await expect(page.getByRole("checkbox", { name: "Select Phase voltage band — Energy meter, occurrence 2" })).toBeChecked();
  await page.getByRole("button", { name: "Acknowledge selected (1)" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByText("Acknowledged 1 alert.")).toBeVisible();
  expect(state.acknowledgements.at(-1)).toEqual({ alert_uuids: [alertIds.a2] });
  await expect(page.getByRole("checkbox", { name: "Select every alert on this page" })).toBeDisabled();
  expect(errors).toEqual([]);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
});

test("the event log lives in Alerts, email preferences in Settings, and old links redirect", async ({
  page,
}) => {
  const { state, errors } = await setup(page);
  await page.goto(`/organizations/${org}/notifications?status=resolved`);
  await expect(page).toHaveURL(new RegExp(`${base}/events\\?status=cleared$`));
  await expect(page.getByRole("tab", { name: "Event log" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("radio", { name: "Cleared" })).toBeChecked();
  await expect.poll(() => state.eventQueries.at(-1)?.get("organization")).toBe(org);
  expect(state.eventQueries.at(-1)?.get("status")).toBe("cleared");
  const log = page.getByRole("table", { name: "Event log" });
  await expect(log.getByRole("row")).toHaveCount(2);
  await expect(log).toContainText("Cleared");
  await expect(page.getByText(/Recover|Resolved/)).toHaveCount(0);
  await expect(page.getByText("Active by type")).toBeVisible();
  await page.getByRole("button", { name: "Workflow alerts" }).click();
  await expect(page).toHaveURL(/status=active/);
  await expect(page).toHaveURL(/source=workflow/);
  await expect(log.getByRole("row")).toHaveCount(2);
  await expect(log).toContainText("Active");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);

  await expect(page.getByRole("tab", { name: "Email preferences" })).toHaveCount(0);
  await page.goto(`${base}/preferences`);
  await expect(page).toHaveURL(new RegExp(`/organizations/${org}/settings/email$`));
  await expect(page.getByRole("heading", { name: "Email preferences" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Cleared" })).toBeVisible();
  await page.getByRole("button", { name: "Turn off all emails" }).click();
  await expect(page.getByText("All alert emails are off")).toBeVisible();
  expect(state.preferences.email_enabled).toBe(false);
  await expect(page.getByRole("button", { name: "Turn off all emails" })).toBeDisabled();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);

  await page.goto(`/organizations/${org}/notifications?tab=preferences`);
  await expect(page).toHaveURL(new RegExp(`/organizations/${org}/settings/email$`));
  await page.goto(`${base}/events`);
  await page.getByRole("tab", { name: "Alerts" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}$`));
  await expect(page.getByRole("list", { name: "Alert sources" })).toBeVisible();
  expect(errors).toEqual([]);
});
