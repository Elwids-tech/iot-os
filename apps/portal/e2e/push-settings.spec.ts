import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expectPhoneFit } from "./support/phone-fit"

/**
 * Push in the portal (spec 033, US2 and US5). The browser's push machinery is stubbed:
 * `Notification.requestPermission`, the worker registration and its PushManager. The
 * real push path is checked by hand against the dev stack (quickstart).
 */
const org = "18b842d4-dbe9-44b7-a82f-8409bf31401a"
const other = "28b842d4-dbe9-44b7-a82f-8409bf31401b"
const base = `/organizations/${org}`
const alertId = "a0000000-0000-4000-8000-000000000001"
const deviceId = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`
// 65 bytes, as a VAPID public key is; never a real key.
const KEY = "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ"
const iPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
const ago = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString()

type Device = { uuid: string; label: string; created_at: string; last_reached_at: string | null; last_failed_at: string | null }
type Settings = {
  available: boolean
  public_key: string | null
  enabled: boolean
  levels: Record<string, boolean> | null
  revision: number
  organizations: { uuid: string; name: string; enabled: boolean }[]
  devices: Device[]
}
type Stub = {
  permission: NotificationPermission
  answer: NotificationPermission
  push: boolean
  /** An existing subscription's endpoint. */
  endpoint: string | null
  /** The device this browser registered earlier, as pwa/push.ts stores it. */
  stored: string | null
  key: number[]
  /** The push service never answers: getSubscription and subscribe never settle. */
  stall: boolean
  /** This app's notifications on screen. */
  shown: number
}

/** Runs in the page before the app: fake permission, worker registration and PushManager. */
function stubPush(stub: Stub) {
  type Fake = { endpoint: string; options: { applicationServerKey: ArrayBuffer }; toJSON(): unknown; unsubscribe(): Promise<boolean> }
  const state = { ...stub, requests: 0, subscribed: 0, unsubscribed: 0, closed: 0, subscription: null as Fake | null }
  const never = () => new Promise<never>(() => {})
  ;(window as unknown as { __push: typeof state }).__push = state
  if (stub.stored && !sessionStorage.getItem("push-seeded")) {
    localStorage.setItem("iot-os.push-device", stub.stored)
    sessionStorage.setItem("push-seeded", "1")
  }
  const key = new Uint8Array(stub.key).buffer
  const subscription = (endpoint: string): Fake => ({
    endpoint,
    options: { applicationServerKey: key },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } }),
    unsubscribe: () => {
      state.unsubscribed++
      state.subscription = null
      return Promise.resolve(true)
    },
  })
  state.subscription = stub.endpoint ? subscription(stub.endpoint) : null
  const registration = {
    getNotifications: () => Promise.resolve(Array.from({ length: state.shown }, () => ({ close: () => void state.closed++ }))),
    pushManager: {
      getSubscription: () => (state.stall ? never() : Promise.resolve(state.subscription)),
      subscribe: () => {
        if (state.stall) return never()
        state.subscribed++
        state.subscription = subscription(`https://push.example.test/send/${state.subscribed}`)
        return Promise.resolve(state.subscription)
      },
    },
  }
  Object.defineProperty(ServiceWorkerContainer.prototype, "ready", { configurable: true, get: () => Promise.resolve(registration) })
  ServiceWorkerContainer.prototype.getRegistration = () => Promise.resolve(registration as unknown as ServiceWorkerRegistration)
  if (!stub.push) {
    delete (window as { PushManager?: unknown }).PushManager
    return
  }
  Object.defineProperty(window, "PushManager", { configurable: true, value: Object.assign(function PushManager() {}, { supportedContentEncodings: ["aes128gcm"] }) })
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: {
      get permission() {
        return state.permission
      },
      requestPermission: () => {
        state.requests++
        state.permission = state.answer
        return Promise.resolve(state.permission)
      },
    },
  })
}
const pushState = (page: Page) =>
  page.evaluate(() => (window as unknown as { __push: { requests: number; subscribed: number; unsubscribed: number; closed: number } }).__push)

const defaults = { critical: true, warning: true, info: true, recovery: false }

async function setup(
  page: Page,
  {
    settings = {} as Partial<Settings>,
    stub = {} as Partial<Stub>,
    sync = "mine" as "mine" | "released" | "unknown",
    replaced = null as { label: string } | null,
  } = {},
) {
  const state = {
    settings: {
      available: true,
      public_key: KEY,
      enabled: false,
      levels: null,
      revision: 0,
      organizations: [
        { uuid: org, name: "Test workspace", enabled: true },
        { uuid: other, name: "Second site", enabled: true },
      ],
      devices: [],
      ...settings,
    } as Settings,
    registrations: [] as Record<string, unknown>[],
    puts: [] as Record<string, unknown>[],
    organizationPuts: [] as { uuid: string; enabled: boolean }[],
    tests: [] as string[],
    removed: [] as string[],
    syncs: [] as string[],
    errors: [] as string[],
    signedOut: false,
  }
  page.on("pageerror", (error) => state.errors.push(error.message))
  await page.addInitScript(stubPush, {
    permission: "default",
    answer: "granted",
    push: true,
    endpoint: null,
    stored: null,
    key: [...Buffer.from(KEY, "base64url")],
    stall: false,
    shown: 0,
    ...stub,
  })
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(`/api/v1/organizations/${org}`, "")
    const body = request.postData() ? request.postDataJSON() : null
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    const context = {
      uuid: org,
      name: "Test workspace",
      slug: "test",
      capabilities: { devices: { view: true, manage: true, activate: true, connections: false, command: false } },
    }
    if (url.pathname === "/api/v1/auth/logout") {
      state.signedOut = true
      return route.fulfill({ status: 204 })
    }
    if (url.pathname === "/api/v1/me" && state.signedOut) return reply({ message: "Unauthenticated." }, 401)
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
      })
    if (path === "/context") return reply({ data: context })
    if (url.pathname === "/api/v1/notifications/push") {
      if (request.method() === "PUT") {
        state.puts.push(body)
        if (body.revision !== state.settings.revision) return reply({ message: "Your push settings changed. Reload and try again." }, 409)
        Object.assign(state.settings, { enabled: body.enabled, levels: body.levels, revision: state.settings.revision + 1 })
      }
      return reply({ data: state.settings })
    }
    const organization = url.pathname.match(/^\/api\/v1\/notifications\/push\/organizations\/([0-9a-f-]{36})$/)
    if (organization) {
      state.organizationPuts.push({ uuid: organization[1], enabled: body.enabled })
      state.settings.organizations = state.settings.organizations.map((item) => (item.uuid === organization[1] ? { ...item, enabled: body.enabled } : item))
      return reply({ data: state.settings })
    }
    if (url.pathname === "/api/v1/notifications/push/devices") {
      state.registrations.push(body)
      const uuid = deviceId(100 + state.registrations.length)
      state.settings.devices.push({ uuid, label: body.label, created_at: new Date().toISOString(), last_reached_at: null, last_failed_at: null })
      if (!state.settings.levels) Object.assign(state.settings, { enabled: true, levels: defaults })
      return reply({ data: { uuid, label: body.label, replaced } }, 201)
    }
    if (url.pathname === "/api/v1/notifications/push/devices/sync") {
      state.syncs.push(body.endpoint)
      return reply({ data: { status: sync, uuid: sync === "mine" ? deviceId(9) : null } })
    }
    const device = url.pathname.match(/^\/api\/v1\/notifications\/push\/devices\/([0-9a-f-]{36})(\/test)?$/)
    if (device && device[2]) {
      state.tests.push(device[1])
      return reply({ data: { status: "accepted" } })
    }
    if (device && request.method() === "DELETE") {
      state.removed.push(device[1])
      state.settings.devices = state.settings.devices.filter((item) => item.uuid !== device[1])
      return route.fulfill({ status: 204 })
    }
    if (url.pathname === "/api/v1/notifications/preferences")
      return reply({
        data: {
          revision: 0,
          email_enabled: true,
          operations_access: false,
          ticket_email: true,
          grid: Object.fromEntries(["workflow", "service", "watchdog"].map((source) => [source, { critical: true, warning: true, info: false, recovery: false }])),
        },
      })
    if (path === "/alert-notifications/summary") return reply({ data: { unread: 0, newest_unread_activation_id: null } })
    if (path === "/alert-notifications") return reply({ data: [], meta: { current_page: 1, last_page: 1, total: 0, unread: 0 } })
    if (path === `/alerts/${alertId}/deliveries`)
      return reply({
        data: [
          { uuid: "e1", recipient_id: 7, recipient_name: "Operator", type: "activated", channel: "email", status: "sent", attempts: 1, retry_generation: 0, devices_total: null, devices_reached: null, history: [{ attempt: 1, status: "accepted", created_at: ago(9), device_label: null, response_status: null }], sent_at: ago(9), diagnostic: null },
          { uuid: "p1", recipient_id: 7, recipient_name: "Operator", type: "activated", channel: "push", status: "failed", attempts: 5, retry_generation: 0, devices_total: 2, devices_reached: 0, history: [{ attempt: 5, status: "transport_failed", created_at: ago(8), device_label: "Chrome on Android", response_status: 503 }], sent_at: null, diagnostic: "Push services did not answer; retry scheduled." },
          { uuid: "p2", recipient_id: 8, recipient_name: "Second Operator", type: "activated", channel: "push", status: "sent", attempts: 1, retry_generation: 0, devices_total: 2, devices_reached: 1, history: [{ attempt: 1, status: "accepted", created_at: ago(8), device_label: "Safari on iPhone", response_status: 201 }], sent_at: ago(8), diagnostic: null },
          { uuid: "p3", recipient_id: 9, recipient_name: "Third Operator", type: "activated", channel: "push", status: "summarised", attempts: 0, retry_generation: 0, devices_total: null, devices_reached: null, history: [], sent_at: null, diagnostic: null },
        ],
      })
    if (path === `/alerts/${alertId}/comments`) return reply({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
    if (path === `/alerts/${alertId}`)
      return reply({
        data: {
          uuid: alertId,
          kind: "workflow",
          severity: "warning",
          workflow_uuid: "b0000000-0000-4000-8000-000000000001",
          workflow_name: "Cold room door open",
          operation_uuid: alertId,
          device_uuid: "c0000000-0000-4000-8000-000000000001",
          device_name: "Freezer 2",
          episode: 1,
          condition: "active",
          activated_at: ago(10),
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
      })
    return reply({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
  })
  return state
}

const myNotifications = `${base}/settings/my-notifications`
const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text })

test("turning push on registers this browser, sends a test and marks This device", async ({ page }) => {
  const state = await setup(page)
  await page.goto(myNotifications)
  await expect(page.getByRole("heading", { name: "My notifications" })).toBeVisible()
  await expect(page.getByText("Push is off for this device.")).toBeVisible()
  // Levels appear once push was turned on somewhere.
  await expect(page.getByRole("heading", { name: "What gets pushed" })).toHaveCount(0)

  await page.getByRole("button", { name: "Turn on push on this device" }).click()
  await expect(toast(page, "Push is on for this device")).toContainText("Test sent")
  expect((await pushState(page)).requests).toBe(1)
  expect(state.registrations).toEqual([
    expect.objectContaining({
      endpoint: "https://push.example.test/send/1",
      keys: { p256dh: expect.any(String), auth: "tBHItJI5svbpez7KI4CCXg" },
      content_encoding: "aes128gcm",
      label: expect.stringMatching(/^Chrome on /),
    }),
  ])
  expect(state.tests).toEqual([deviceId(101)])
  await expect(page.getByText("Push is on for this device.")).toBeVisible()
  await expect(page.getByRole("table", { name: "Push devices" }).getByText("This device")).toBeVisible()
  await expect(page.getByRole("heading", { name: "What gets pushed" })).toBeVisible()
  await expect(page.getByRole("switch", { name: "Cleared", exact: true })).not.toBeChecked()
  // The toast fades in; axe reads final colours only once it has settled.
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"))
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([])
  expect(state.errors).toEqual([])
})

test("a replaced device and a refused permission are explained", async ({ page }) => {
  const state = await setup(page, { replaced: { label: "Firefox on Linux" } })
  await page.goto(myNotifications)
  await page.getByRole("button", { name: "Turn on push on this device" }).click()
  await expect(toast(page, "Firefox on Linux was removed to make room")).toBeVisible()
  expect(state.registrations).toHaveLength(1)

  const refused = await setup(await page.context().newPage(), { stub: { answer: "denied" } })
  const second = page.context().pages()[1]
  await second.goto(myNotifications)
  await second.getByRole("button", { name: "Turn on push on this device" }).click()
  await expect(toast(second, "Notifications are blocked")).toBeVisible()
  expect(refused.registrations).toEqual([])
})

test("a push service that never answers: turning on says so, and signing out neither waits nor leaves notifications", async ({ page }) => {
  const state = await setup(page, { stub: { stall: true, shown: 2 } })
  await page.clock.install()
  await page.goto(myNotifications)
  await page.getByRole("button", { name: "Turn on push on this device" }).click()
  await expect(page.getByRole("button", { name: /Turning on/ })).toBeVisible()
  await page.clock.fastForward(21_000)
  await expect(toast(page, "Push couldn't be turned on")).toContainText("push service didn't answer")
  await expect(page.getByRole("button", { name: "Turn on push on this device" })).toBeEnabled()
  expect(state.registrations).toEqual([])

  // A shared phone: the next person must not see this person's alerts in the tray.
  await page.getByRole("button", { name: "Operator" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await page.clock.fastForward(3_500)
  await expect(page.getByRole("heading", { name: "Welcome to your workspace" })).toBeVisible()
  expect((await pushState(page)).closed).toBe(2)
  expect(state.errors).toEqual([])
})

test("levels, the switch and organizations save together; tests and removal ask the API", async ({ page }) => {
  const state = await setup(page, {
    settings: {
      enabled: true,
      levels: defaults,
      revision: 3,
      devices: [{ uuid: deviceId(2), label: "Chrome on Android", created_at: ago(60 * 24 * 3), last_reached_at: ago(5), last_failed_at: null }],
    },
  })
  await page.goto(myNotifications)
  const devices = page.getByRole("table", { name: "Push devices" })
  await expect(devices.getByRole("row", { name: /Chrome on Android/ })).toBeVisible()
  await expect(devices.getByText("This device")).toHaveCount(0)

  await page.getByRole("switch", { name: "Warning", exact: true }).click()
  await page.getByRole("switch", { name: "Second site" }).click()
  await expect(page.getByText("Unsaved changes")).toBeVisible()
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("No unsaved changes", { exact: true }).or(page.getByText("Saved", { exact: true }))).toBeVisible()
  expect(state.puts).toEqual([{ revision: 3, enabled: true, levels: { ...defaults, warning: false } }])
  expect(state.organizationPuts).toEqual([{ uuid: other, enabled: false }])
  await expect(page.getByRole("switch", { name: "Second site" })).not.toBeChecked()

  // Another window saved meanwhile: the save is refused and the latest settings load.
  state.settings.revision = 9
  await page.getByRole("switch", { name: "Info", exact: true }).click()
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Your push settings changed in another window")).toBeVisible()
  await expect(page.getByRole("switch", { name: "Info", exact: true })).toBeChecked()

  await devices.getByRole("button", { name: "Send test" }).click()
  await expect(toast(page, "Test sent to Chrome on Android")).toBeVisible()
  expect(state.tests).toEqual([deviceId(2)])

  await devices.getByRole("button", { name: "Remove" }).click()
  const confirm = page.getByRole("alertdialog", { name: "Remove Chrome on Android?" })
  await expect(confirm).toContainText("signed out there")
  expect(state.removed).toEqual([])
  await confirm.getByRole("button", { name: "Remove" }).click()
  await expect(toast(page, "Chrome on Android was removed")).toBeVisible()
  expect(state.removed).toEqual([deviceId(2)])

  await page.getByRole("button", { name: "Turn off push everywhere" }).click()
  await expect.poll(() => state.settings.enabled).toBe(false)
  await expect(page.getByRole("switch", { name: "Push notifications" })).not.toBeChecked()
  expect(state.errors).toEqual([])
})

test.describe("on iPhone in Safari", () => {
  test.use({ userAgent: iPhone, viewport: { width: 390, height: 844 } })

  test("push needs the app on the Home Screen first", async ({ page }) => {
    const state = await setup(page, { stub: { push: false } })
    await page.goto(myNotifications)
    await expect(page.getByText("Add the app to your Home Screen first")).toBeVisible()
    await expect(page.getByRole("button", { name: "Turn on push on this device" })).toHaveCount(0)
    await page.getByRole("button", { name: "Show me how" }).click()
    await expect(page.getByRole("dialog", { name: "Install the app" })).toContainText("Add to Home Screen")
    expect(state.errors).toEqual([])
  })
})

test("blocked notifications explain the settings; browsers without push say so", async ({ page }) => {
  await setup(page, { stub: { permission: "denied" } })
  await page.goto(myNotifications)
  await expect(page.getByText("Notifications are blocked for this site")).toBeVisible()
  await expect(page.getByRole("button", { name: "Turn on push on this device" })).toHaveCount(0)
  expect((await pushState(page)).requests).toBe(0)

  const without = await page.context().newPage()
  await setup(without, { stub: { push: false } })
  await without.goto(myNotifications)
  await expect(without.getByText("This browser can't receive push notifications")).toBeVisible()
})

test("push stays hidden where the deployment has no push key", async ({ page }) => {
  await setup(page, { settings: { available: false, public_key: null } })
  await page.goto(myNotifications)
  await expect(page.getByRole("heading", { name: "Alert emails" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Push notifications" })).toHaveCount(0)
})

test("each start checks this browser's subscription with the API", async ({ page }) => {
  const endpoint = "https://push.example.test/send/kept"
  const stored = JSON.stringify({ user: 7, uuid: deviceId(9), endpoint })
  const state = await setup(page, { stub: { permission: "granted", endpoint, stored }, sync: "unknown" })
  await page.goto(`${base}/alerts`)
  await expect(toast(page, "Push stopped on this device")).toBeVisible()
  expect(state.syncs).toEqual([endpoint])
  expect((await pushState(page)).unsubscribed).toBe(1)
  await toast(page, "Push stopped on this device").getByRole("button", { name: "Turn on again" }).click()
  await expect(toast(page, "Push is on for this device")).toBeVisible()
  expect(state.registrations).toHaveLength(1)

})

test("someone else's subscription on a shared browser is released, never inherited", async ({ page }) => {
  const endpoint = "https://push.example.test/send/other"
  const state = await setup(page, { stub: { permission: "granted", endpoint }, sync: "released" })
  await page.goto(`${base}/alerts`)
  await expect.poll(() => state.syncs).toEqual([endpoint])
  await expect.poll(async () => (await pushState(page)).unsubscribed).toBe(1)
  await expect(toast(page, "Push stopped on this device")).toHaveCount(0)
  expect(state.registrations).toEqual([])
})

test("the bell offers push until this browser has a device", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/alerts`)
  await page.getByRole("button", { name: /^Notifications/ }).click()
  const bell = page.getByRole("dialog", { name: "Notifications" })
  await bell.getByRole("button", { name: "Turn on push on this device" }).click()
  await expect(toast(page, "Push is on for this device")).toBeVisible()
  expect(state.registrations).toHaveLength(1)
  expect(state.tests).toEqual([deviceId(101)])
  await expect(bell.getByRole("button", { name: "Turn on push on this device" })).toHaveCount(0)

  const unsupported = await page.context().newPage()
  await setup(unsupported, { stub: { push: false } })
  await unsupported.goto(`${base}/alerts`)
  await unsupported.getByRole("button", { name: /^Notifications/ }).click()
  await unsupported.getByRole("dialog", { name: "Notifications" }).getByRole("link", { name: "Get alerts on your phone" }).click()
  await expect(unsupported).toHaveURL(new RegExp(`${base}/settings/my-notifications$`))
  await expect(unsupported.getByText("This browser can't receive push notifications")).toBeVisible()
})

test("an alert's deliveries show the channel and the devices reached", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/alerts/${alertId}`)
  const deliveries = page.getByRole("table", { name: "Deliveries" })
  await expect(deliveries.getByRole("columnheader", { name: "Channel" })).toBeVisible()
  await expect(deliveries.getByRole("row", { name: /Second Operator/ })).toContainText("1 of 2")
  await expect(deliveries.getByRole("row", { name: /Third Operator/ })).toContainText("In summary")
  await expect(deliveries.getByRole("row", { name: /Operator.*Email/ }).first()).toContainText("Sent")
  await expect(deliveries.getByRole("button", { name: "Retry push" })).toHaveCount(1)
  await expect(page.getByText("Activation push to Second Operator · Safari on iPhone")).toBeVisible()
  expect(state.errors).toEqual([])
})

for (const width of [320, 360, 390]) {
  test(`My notifications fits a ${width} px phone`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 })
    await setup(page, {
      settings: {
        enabled: true,
        levels: defaults,
        revision: 1,
        devices: [
          { uuid: deviceId(2), label: "Samsung Internet on Android", created_at: ago(60 * 24 * 30), last_reached_at: ago(5), last_failed_at: null },
          { uuid: deviceId(3), label: "Safari on iPad", created_at: ago(60 * 24 * 2), last_reached_at: null, last_failed_at: null },
        ],
      },
    })
    await page.goto(myNotifications)
    await expect(page.getByRole("heading", { name: "What gets pushed" })).toBeVisible()
    await expectPhoneFit(page)
  })
}
