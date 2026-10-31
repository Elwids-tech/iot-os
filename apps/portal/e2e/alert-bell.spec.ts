import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Spec 022: the alert bell in every page header, and its chime.
const org = "18b842d4-dbe9-44b7-a82f-8409bf31401a";
const base = `/organizations/${org}`;
const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60000).toISOString();
/** UUIDv7-shaped ids that sort by `n`. */
const nid = (n: number) => `01a189aa-0000-7000-8000-${String(n).padStart(12, "0")}`;
const alertId = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Notification = {
  id: string;
  transition: "activated" | "cleared";
  occurred_at: string;
  created_at: string;
  read_at: string | null;
  alert: { uuid: string; episode: number; condition: "active" | "cleared" };
  kind: "workflow" | "device_offline" | "gateway_offline" | "connection_lost";
  subject: { type: "device" | "gateway" | "adapter"; uuid: string; name: string } | null;
  workflow: { uuid: string; name: string } | null;
  device: { uuid: string; name: string } | null;
};

const notification = (n: number, extra: Partial<Notification> = {}): Notification => ({
  id: nid(n),
  transition: "activated",
  occurred_at: ago(60 - n),
  created_at: ago(60 - n),
  read_at: null,
  alert: { uuid: alertId(n), episode: n, condition: "active" },
  kind: "workflow",
  subject: null,
  workflow: { uuid: "b0000000-0000-4000-8000-000000000001", name: `Cold room door open ${n}` },
  device: { uuid: "c0000000-0000-4000-8000-000000000001", name: "Freezer 2" },
  ...extra,
});

/** Counts synthesized notes; the context starts locked until the page is clicked, as in browsers. */
const stubAudio = () => {
  const audio = { notes: 0, contexts: 0 };
  (window as unknown as { __audio: typeof audio }).__audio = audio;
  class FakeAudioContext {
    state = "suspended";
    currentTime = 0;
    destination = {};
    constructor() {
      audio.contexts++;
    }
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    createOscillator() {
      return { type: "", frequency: { value: 0 }, connect: (node: unknown) => node, start: () => void audio.notes++, stop: () => {} };
    }
    createGain() {
      return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (node: unknown) => node };
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
};
const notes = (page: Page) => page.evaluate(() => (window as unknown as { __audio: { notes: number } }).__audio.notes);

type State = {
  notifications: Notification[];
  reads: Record<string, unknown>[];
  summaries: number;
  lists: number;
};

async function setup(page: Page, { view = true, manage = true, notifications = [] as Notification[] } = {}) {
  const state: State = { notifications, reads: [], summaries: 0, lists: 0 };
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(stubAudio);
  const summary = () => {
    const unread = state.notifications.filter((n) => !n.read_at);
    return {
      unread: unread.length,
      newest_unread_activation_id: unread.filter((n) => n.transition === "activated").map((n) => n.id).sort().at(-1) ?? null,
    };
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(`/api/v1/organizations/${org}`, "");
    const body = req.postData() ? req.postDataJSON() : null;
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    const context = {
      uuid: org,
      name: "Test workspace",
      slug: "test",
      capabilities: { devices: { view, manage, activate: manage, connections: false, command: false } },
    };
    if (url.pathname === "/api/v1/me")
      return reply({
        data: {
          id: 7,
          name: "Operator",
          email: "operator@example.test",
          email_verified_at: "2026-01-01",
          is_super_admin: false,
          capabilities: { platform_administration: false },
          organizations: [context],
        },
      });
    if (path === "/context") return reply({ data: context });
    if (path === "/alert-notifications/summary") {
      state.summaries++;
      return reply({ data: summary() });
    }
    if (path === "/alert-notifications/read") {
      state.reads.push(body);
      const at = new Date().toISOString();
      for (const n of state.notifications)
        if (!n.read_at && ((body.ids && body.ids.includes(n.id)) || (body.up_to && n.id <= body.up_to) || (body.alert_uuid && n.alert.uuid === body.alert_uuid)))
          n.read_at = at;
      return reply({ data: summary() });
    }
    if (path === "/alert-notifications") {
      state.lists++;
      const page = Number(url.searchParams.get("page") ?? 1);
      const sorted = [...state.notifications].sort((a, b) => (a.id < b.id ? 1 : -1));
      return reply({
        data: sorted.slice((page - 1) * 20, page * 20),
        meta: { current_page: page, last_page: Math.max(1, Math.ceil(sorted.length / 20)), total: sorted.length, unread: summary().unread },
      });
    }
    if (path === "/alerts") return reply({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } });
    const detail = path.match(/^\/alerts\/([0-9a-f-]{36})(\/.*)?$/);
    if (detail) {
      if (detail[2] === "/comments") return reply({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } });
      if (detail[2]) return reply({ data: [] });
      return reply({
        data: {
          uuid: detail[1],
          kind: "workflow",
          severity: "warning",
          workflow_uuid: "b0000000-0000-4000-8000-000000000001",
          workflow_name: "Cold room door open",
          operation_uuid: detail[1],
          device_uuid: "c0000000-0000-4000-8000-000000000001",
          device_name: "Freezer 2",
          episode: 1,
          condition: "active",
          activated_at: ago(5),
          cleared_at: null,
          acknowledged_at: null,
          acknowledged_by: null,
          acknowledged_by_name: null,
          assignee: null,
          assigned_at: null,
          execution_stopped_reason: null,
          devices: [{ uuid: "c0000000-0000-4000-8000-000000000001", name: "Freezer 2" }],
          devices_total: 1,
        },
      });
    }
    return reply({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } });
  });
  return { state, errors };
}

const bell = (page: Page) => page.getByRole("button", { name: /^Notifications/ });
const list = (page: Page) => page.getByRole("dialog", { name: "Notifications" });
/** Lets the popover's fade finish, so axe reads final colours. */
const settled = (page: Page) =>
  page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
/** The next poll, without waiting 15 seconds. */
async function poll(page: Page, state: State) {
  const before = state.summaries;
  await page.clock.fastForward(15_000);
  await expect.poll(() => state.summaries).toBeGreaterThan(before);
}

test("the bell counts unread alerts, lists them newest first and opens one", async ({ page }) => {
  const { state, errors } = await setup(page, {
    notifications: [
      notification(1, { read_at: ago(30), alert: { uuid: alertId(1), episode: 1, condition: "cleared" } }),
      notification(2, { device: null }),
      notification(3, { transition: "cleared", alert: { uuid: alertId(3), episode: 3, condition: "cleared" } }),
    ],
  });
  await page.goto(`${base}/alerts`);
  await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread");
  expect(state.lists).toBe(0);

  await bell(page).click();
  const items = list(page).getByRole("link", { name: /Cold room door open/ });
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("Cold room door open 3");
  await expect(items.nth(0)).toContainText("Cleared");
  await expect(items.nth(0)).toContainText("Unread");
  await expect(items.nth(1)).toContainText("Cold room door open 2");
  await expect(items.nth(1)).toContainText("Still active");
  await expect(items.nth(1)).not.toContainText("Freezer 2");
  await expect(items.nth(2)).toContainText("Freezer 2");
  await expect(items.nth(2)).toContainText("Cleared since");
  await expect(items.nth(2)).not.toContainText("Unread");
  await settled(page);
  expect((await new AxeBuilder({ page }).include('[data-slot="popover-content"]').analyze()).violations).toEqual([]);

  // Selecting reads that notification and lands on its alert, which reads the alert's others.
  await items.nth(1).click();
  await expect(page).toHaveURL(`${base}/alerts/${alertId(2)}`);
  await expect(list(page)).toBeHidden();
  await expect.poll(() => state.reads).toEqual([{ ids: [nid(2)] }, { alert_uuid: alertId(2) }]);
  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
  expect(errors).toEqual([]);
});

test("a device connectivity alert is named by its kind and subject (spec 018)", async ({ page }) => {
  const freezer = { uuid: "c0000000-0000-4000-8000-000000000001", name: "Freezer 2" };
  const { errors } = await setup(page, {
    notifications: [notification(1), notification(2, { kind: "device_offline", subject: { type: "device", ...freezer }, workflow: null, device: freezer })],
  });
  await page.goto(`${base}/alerts`);
  await bell(page).click();
  const offline = list(page).getByRole("link", { name: /Device offline · Freezer 2/ });
  await expect(offline).toBeVisible();
  await expect(offline).not.toContainText("Cold room door open");
  await expect(list(page).getByRole("link", { name: /Cold room door open 1/ })).toContainText("Freezer 2");
  expect(errors).toEqual([]);
});

test("Mark all read stops at the newest one shown, and Show older pages in place", async ({ page }) => {
  const { state } = await setup(page, { notifications: Array.from({ length: 22 }, (_, i) => notification(i + 1)) });
  await page.goto(`${base}/alerts`);
  await expect(bell(page)).toHaveAccessibleName("Notifications, 22 unread");
  await expect(bell(page)).toContainText("9+");
  await bell(page).click();
  const items = list(page).getByRole("link", { name: /Cold room door open/ });
  await expect(items).toHaveCount(20);
  await list(page).getByRole("button", { name: "Show older" }).click();
  await expect(items).toHaveCount(22);
  await expect(list(page).getByRole("button", { name: "Show older" })).toBeHidden();

  // One arrives after the list was shown: it stays unread.
  state.notifications.push(notification(23));
  await list(page).getByRole("button", { name: "Mark all read" }).click();
  await expect.poll(() => state.reads).toEqual([{ up_to: nid(22) }]);
  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");

  await list(page).getByRole("link", { name: "All alerts" }).click();
  await expect(page).toHaveURL(`${base}/alerts`);
  await expect(list(page)).toBeHidden();
});

test("at phone width the bell is an icon and its list fits without sideways scroll", async ({ page }) => {
  await setup(page, {
    notifications: [notification(1, { workflow: { uuid: "b0000000-0000-4000-8000-000000000001", name: "Compressor discharge temperature above the high-limit setpoint for more than ten minutes" } })],
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/alerts`);
  await bell(page).click();
  await expect(list(page).getByRole("link", { name: /Compressor discharge/ })).toBeVisible();
  await settled(page);
  const box = (await list(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect((await new AxeBuilder({ page }).include('[data-slot="popover-content"]').analyze()).violations).toEqual([]);
});

test("people without device view get no bell and no polling", async ({ page }) => {
  const { state } = await setup(page, { view: false, notifications: [notification(1)] });
  await page.goto(`${base}/settings/email`);
  await expect(page.getByRole("button", { name: "Help" }).first()).toBeVisible();
  await expect(bell(page)).toHaveCount(0);
  expect(state.summaries).toBe(0);
});

test("an empty bell explains recipients and links managers to Settings", async ({ page }) => {
  await setup(page);
  await page.goto(`${base}/alerts`);
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await bell(page).click();
  await expect(list(page).getByText("No alert notifications")).toBeVisible();
  await expect(list(page).getByText("Alerts appear here when an automation lists you as a recipient.")).toBeVisible();
  await expect(list(page).getByRole("button", { name: "Mark all read" })).toBeDisabled();
  await list(page).getByRole("link", { name: "Choose recipients" }).click();
  await expect(page).toHaveURL(`${base}/settings/notifications`);
});

test("an empty bell tells viewers who can add them", async ({ page }) => {
  await setup(page, { manage: false });
  await page.goto(`${base}/alerts`);
  await bell(page).click();
  await expect(list(page).getByText(/Ask someone who manages automations to add you/)).toBeVisible();
  await expect(list(page).getByRole("link", { name: "Choose recipients" })).toHaveCount(0);
});

test.describe("the chime", () => {
  test("plays once for a new activation, never for the backlog, a clear or while muted", async ({ page }) => {
    const { state, errors } = await setup(page, { notifications: [notification(1), notification(2)] });
    await page.clock.install();
    await page.goto(`${base}/alerts`);
    await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread");
    await page.getByRole("heading", { level: 1 }).first().click();
    await poll(page, state);
    expect(await notes(page)).toBe(0);

    state.notifications.push(notification(3), notification(4));
    await poll(page, state);
    await expect(bell(page)).toHaveAccessibleName("Notifications, 4 unread");
    // One chime of two notes for both arrivals.
    await expect.poll(() => notes(page)).toBe(2);
    await expect(page.getByRole("status").filter({ hasText: "New alert" })).toHaveText("New alert: Cold room door open 4, Freezer 2");

    // A cleared notification arrives silently.
    state.notifications.push(notification(5, { transition: "cleared" }));
    await poll(page, state);
    await expect(bell(page)).toHaveAccessibleName("Notifications, 5 unread");
    await page.waitForTimeout(500);
    expect(await notes(page)).toBe(2);

    // Muted in this browser: nothing plays.
    await bell(page).click();
    const sound = list(page).getByRole("switch", { name: "Sound for new alerts in this browser" });
    await expect(sound).toBeChecked();
    await sound.click();
    await expect(sound).not.toBeChecked();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => localStorage.getItem("iot-os.alert-bell.sound"))).toBe("off");
    state.notifications.push(notification(6));
    await poll(page, state);
    await expect(bell(page)).toHaveAccessibleName("Notifications, 6 unread");
    await page.waitForTimeout(500);
    expect(await notes(page)).toBe(2);
    expect(errors).toEqual([]);
  });

  test("two tabs of one browser play one chime", async ({ context }) => {
    const pages = [await context.newPage(), await context.newPage()];
    const shared = [notification(1)];
    const states = [];
    for (const page of pages) {
      const { state } = await setup(page, { notifications: shared });
      states.push(state);
      await page.clock.install();
      await page.goto(`${base}/alerts`);
      await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
      await page.getByRole("heading", { level: 1 }).first().click();
    }
    shared.push(notification(2));
    // Both tabs check at the same moment.
    await Promise.all(pages.map((page, i) => poll(page, states[i])));
    await expect.poll(async () => (await notes(pages[0])) + (await notes(pages[1]))).toBe(2);
    await pages[0].waitForTimeout(1000);
    expect((await notes(pages[0])) + (await notes(pages[1]))).toBe(2);
    for (const page of pages) await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread");
  });

  test("a page nobody clicked yet plays nothing, shows no error and still counts", async ({ page }) => {
    const { state, errors } = await setup(page, { notifications: [notification(1)] });
    await page.clock.install();
    await page.goto(`${base}/alerts`);
    await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
    state.notifications.push(notification(2));
    await poll(page, state);
    await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread");
    await page.waitForTimeout(500);
    expect(await notes(page)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __audio: { contexts: number } }).__audio.contexts)).toBe(0);
    await expect(page.getByRole("status").filter({ hasText: "New alert" })).toHaveText("New alert: Cold room door open 2, Freezer 2");
    expect(errors).toEqual([]);
  });
});
