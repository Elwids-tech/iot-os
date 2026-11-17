import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { execSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The installable portal (spec 033, US3). Runs under playwright.pwa.config.ts against a
 * production build served by `vite preview`, with its service worker.
 */
const org = "18b842d4-dbe9-44b7-a82f-8409bf31401a"
const alertId = "a0000000-0000-4000-8000-000000000001"
const meter = "18b842d4-dbe9-44b7-a82f-8409bf314d02"
const alertPath = `/organizations/${org}/alerts/${alertId}`
const outDir = process.env.PWA_OUT_DIR ?? join(tmpdir(), "iot-portal-pwa-e2e")
// The build's fallback API address, on the page's host (src/lib/api.ts).
const apiOrigin = "http://127.0.0.1:8001"

type Api = { acknowledgements: number; requests: string[]; offline: boolean }

/** The API this portal talks to, for every page of the context, including /up for the connection probe. */
async function mockApi(context: BrowserContext): Promise<Api> {
  const api: Api = { acknowledgements: 0, requests: [], offline: false }
  const alert = {
    uuid: alertId,
    kind: "workflow",
    severity: "warning",
    workflow_uuid: "18b842d4-dbe9-44b7-a82f-8409bf314f02",
    workflow_name: "Phase voltage band",
    operation_uuid: alertId,
    device_uuid: meter,
    device_name: "Energy meter",
    episode: 4,
    condition: "active",
    activated_at: new Date(Date.now() - 5 * 60000).toISOString(),
    cleared_at: null,
    acknowledged_at: null as string | null,
    acknowledged_by: null as number | null,
    acknowledged_by_name: null as string | null,
    assignee: null,
    assigned_at: null,
    execution_stopped_reason: null,
    devices: [{ uuid: meter, name: "Energy meter" }],
    devices_total: 1,
  }
  const organization = {
    uuid: org,
    name: "Test workspace",
    slug: "test",
    capabilities: { devices: { view: true, manage: true, activate: true, connections: false, command: false } },
  }
  await context.route(`${apiOrigin}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    // Routes answer even when the context is offline, so the mock goes offline with it.
    if (api.offline) return route.abort("internetdisconnected")
    api.requests.push(`${request.method()} ${url.pathname}`)
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    if (url.pathname === "/up") return route.fulfill({ status: 200, body: "ok" })
    if (url.pathname === "/api/v1/me")
      return reply({
        data: {
          id: 1,
          name: "Manager",
          email: "manager@example.test",
          email_verified_at: "2026-01-01",
          is_super_admin: false,
          capabilities: { platform_administration: false },
          organizations: [organization],
        },
      })
    const path = url.pathname.replace(`/api/v1/organizations/${org}`, "")
    if (path === "/context") return reply({ data: organization })
    if (path === "/alert-notifications/summary") return reply({ data: { unread: 0, newest_unread_activation_id: null } })
    const page1 = (data: unknown[]) => ({ data, meta: { current_page: 1, last_page: 1, total: data.length } })
    if (path === "/alerts" && url.searchParams.get("group") === "source")
      return reply(
        page1([
          {
            kind: alert.kind,
            workflow_uuid: alert.workflow_uuid,
            device_uuid: alert.device_uuid,
            occurrences: 1,
            unacknowledged: alert.acknowledged_at ? 0 : 1,
            active: 1,
            first_activated_at: alert.activated_at,
            last_activated_at: alert.activated_at,
            latest: alert,
          },
        ]),
      )
    if (path === "/alerts") return reply(page1([alert]))
    if (["/devices", "/workflows", "/dashboards"].includes(path)) return reply(page1([]))
    if (path === `/alerts/${alertId}/acknowledge`) {
      api.acknowledgements++
      Object.assign(alert, { acknowledged_at: new Date().toISOString(), acknowledged_by: 1, acknowledged_by_name: "Manager" })
      return reply({ data: alert })
    }
    if (path === `/alerts/${alertId}/comments`) return reply(page1([]))
    if (path === `/alerts/${alertId}/deliveries`) return reply({ data: [] })
    if (path === `/alerts/${alertId}`) return reply({ data: alert })
    if (path === "/runtime-status") return reply({ data: { state: "operational", live_data: "available", automations: "running" } })
    return reply({ message: "Not Found" }, 404)
  })
  return api
}

/** Waits until this page's service worker is active and the page is under its control. */
async function controlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready)
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
}

/** Takes the browser and the mocked API offline, or back. */
async function setOffline(context: BrowserContext, api: Api, offline: boolean) {
  api.offline = offline
  await context.setOffline(offline)
}

const offlineNotice = (page: Page) => page.getByRole("status").filter({ hasText: "You're offline." })

test("the manifest names the app and its icons load", async ({ page, request }) => {
  await page.goto("/")
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest")
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon-180x180.png")
  const manifest = await (await request.get("/manifest.webmanifest")).json()
  expect(manifest).toMatchObject({
    name: "IoT OS",
    short_name: "IoT OS",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
  })
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192" }),
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]),
  )
  for (const icon of [...manifest.icons, { src: "apple-touch-icon-180x180.png" }]) {
    const response = await request.get(`/${icon.src}`)
    expect(response.status(), icon.src).toBe(200)
    expect(response.headers()["content-type"]).toBe("image/png")
  }
})

test("the worker activates and caches the app shell only, never the API", async ({ page, context }) => {
  await mockApi(context)
  await page.goto(alertPath)
  await controlled(page)
  // Chromium's own verdict on whether the app can be installed (FR-009).
  const cdp = await context.newCDPSession(page)
  expect((await cdp.send("Page.getAppManifest")).errors).toEqual([])
  expect((await cdp.send("Page.getInstallabilityErrors")).installabilityErrors).toEqual([])
  // Using the app (and so the API) adds nothing from the API host to any cache.
  await page.reload()
  await expect(page.getByRole("button", { name: "Acknowledge alert" })).toBeVisible()
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
    }
    return urls
  })
  expect(cached.length).toBeGreaterThan(10)
  expect(cached.filter((url) => new URL(url).origin !== new URL(page.url()).origin)).toEqual([])
  expect(cached.filter((url) => new URL(url).pathname.startsWith("/api/"))).toEqual([])
  expect(cached.some((url) => new URL(url).pathname === "/index.html")).toBe(true)
})

test("opened offline it shows only the offline screen, then loads by itself", async ({ page, context }) => {
  const api = await mockApi(context)
  await page.goto(alertPath)
  await controlled(page)
  await expect(page.getByText("Phase voltage band").first()).toBeVisible()

  await setOffline(context, api, true)
  await page.reload()
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible()
  await expect(page.getByText("Alerts and readings need a connection.")).toBeVisible()
  // Nothing from the earlier session is on the page.
  await expect(page.getByText("Phase voltage band")).toHaveCount(0)
  await expect(page.getByText("Energy meter")).toHaveCount(0)

  await setOffline(context, api, false)
  await expect(page.getByRole("button", { name: "Acknowledge alert" })).toBeVisible({ timeout: 15000 })
})

test("an open page says it is offline within 10 s and saves nothing, now or later", async ({ page, context }) => {
  const api = await mockApi(context)
  await page.goto(alertPath)
  await expect(page.getByRole("button", { name: "Acknowledge alert" })).toBeVisible()

  await setOffline(context, api, true)
  await expect(offlineNotice(page)).toBeVisible({ timeout: 10000 })
  // Values already on the page stay, with their age.
  await expect(page.getByText("Phase voltage band").first()).toBeVisible()

  await page.getByRole("button", { name: "Acknowledge alert" }).click()
  await expect(page.getByText("You're offline. Nothing was saved.")).toBeVisible()

  await setOffline(context, api, false)
  await expect(offlineNotice(page)).toHaveCount(0, { timeout: 15000 })
  // Nothing was queued to send on reconnect.
  await page.waitForTimeout(2000)
  expect(api.acknowledgements).toBe(0)
  expect(api.requests.filter((line) => line.endsWith("/acknowledge"))).toEqual([])
})

test("a new release offers Reload, and the next launch runs it (SC-006)", async ({ page, context }) => {
  await mockApi(context)
  await page.goto("/")
  await controlled(page)
  const before = await page.locator('meta[name="build-id"]').getAttribute("content")
  expect(before).toBeTruthy()

  // Deploy a new build into the folder vite preview serves.
  const next = `pwa-${Date.now()}`
  execSync(`pnpm exec vite build --outDir "${outDir}" --emptyOutDir`, {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, BUILD_ID: next },
    stdio: "ignore",
  })
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update()
  })
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "A new version is available" })
  await expect(toast).toBeVisible({ timeout: 30000 })
  await expect(toast.getByRole("button", { name: "Reload" })).toBeVisible()
  // The open page keeps running the version it started with.
  await expect(page.locator('meta[name="build-id"]')).toHaveAttribute("content", before!)

  // Close the app and start it again.
  for (const open of context.pages()) await open.close()
  await expect
    .poll(
      async () => {
        const relaunched = await context.newPage()
        await relaunched.goto("/")
        const id = await relaunched.locator('meta[name="build-id"]').getAttribute("content")
        await relaunched.close()
        return id
      },
      { timeout: 30000 },
    )
    .toBe(next)
})

test("the browser's own reload runs a waiting release when no other window is open (FR-014)", async ({ page, context }) => {
  await mockApi(context)
  await page.goto("/")
  await controlled(page)
  const before = await page.locator('meta[name="build-id"]').getAttribute("content")
  const next = `pwa-${Date.now()}`
  execSync(`pnpm exec vite build --outDir "${outDir}" --emptyOutDir`, {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, BUILD_ID: next },
    stdio: "ignore",
  })
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update()
  })
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "A new version is available" })).toBeVisible({ timeout: 30000 })

  // A second window open: a reload keeps the version both windows run.
  const other = await context.newPage()
  await other.goto("/")
  await page.reload()
  await expect(page.locator('meta[name="build-id"]')).toHaveAttribute("content", before!)

  // Alone again: the reload switches to the new release.
  await other.close()
  await page.reload()
  await expect(page.locator('meta[name="build-id"]')).toHaveAttribute("content", next, { timeout: 15000 })
})
