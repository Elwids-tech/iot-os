import type { Page, Route } from "@playwright/test"

// Brands and logos (spec 036) for specs that open the billing accounts page or change an
// organization's logo. Registered after a spec's own catch-all, so these answer first.

export type MockImage = { url: string; width: number; height: number }

const png = (base64: string) => `data:image/png;base64,${base64}`
/** Two different one-pixel images, so a test can tell an organization's logo from its provider's. */
export const ownPixel = png("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
export const providerPixel = png("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
export const pngFile = (name: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.from(ownPixel.slice(ownPixel.indexOf(",") + 1), "base64"),
})

type Organization = {
  uuid: string
  logo?: MockImage | null
  logo_dark?: MockImage | null
  brand?: { product_name: string | null; logo: MockImage | null; logo_dark: MockImage | null }
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

/**
 * `allowed` is the account's Branding switch. `organizations` are the ones the spec's
 * `/api/v1/me` answers with: a logo change updates them, as the API would.
 */
export async function mockBranding(page: Page, options: { allowed?: boolean; organizations?: () => Organization[] } = {}) {
  const sent: { method: string; path: string; body: unknown }[] = []
  const state = {
    allowed: options.allowed ?? false,
    brand: {
      product_name: null as string | null,
      short_name: null as string | null,
      support_url: null as string | null,
      logo: null as MockImage | null,
      logo_dark: null as MockImage | null,
      icon: null as MockImage | null,
      revision: 0,
    },
  }
  const providers = new Map<string, Organization["brand"]>()
  const shown = () => ({ ...state.brand, in_effect: state.allowed && state.brand.product_name !== null })
  const refusedImage = (route: Route) =>
    json(route, { message: "Upload a PNG, JPEG or WebP image.", code: "image_type", errors: { image: ["Upload a PNG, JPEG or WebP image."] } }, 422)

  await page.route(/\/api\/v1\/billing-accounts\/[^/]+\/(branding|brand(\/images\/(logo|logo_dark|icon))?)$/, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const role = path.match(/\/images\/(logo|logo_dark|icon)$/)?.[1] as "logo" | "logo_dark" | "icon" | undefined

    if (method === "GET")
      return json(route, {
        data: {
          brand: shown(),
          addresses: [],
          allowances: { branding: state.allowed, custom_domain: false, hide_powered_by: false },
          addresses_available: false,
          name_suffix: null,
          limits: { image_bytes: 1048576, types: ["image/png", "image/jpeg", "image/webp"], icon_min: 512 },
        },
      })
    sent.push({ method, path, body: role ? null : request.postDataJSON() })
    if (!state.allowed) return json(route, { message: "Branding is not part of this billing account's plan.", code: "branding_not_allowed" }, 403)

    if (role) {
      // A file named "refused" stands for an image the API refuses.
      if (method === "POST" && (request.postData() ?? "").includes("refused")) return refusedImage(route)
      state.brand[role] = method === "POST" ? { url: providerPixel, width: role === "icon" ? 512 : 480, height: role === "icon" ? 512 : 120 } : null
      state.brand.revision++
      return json(route, { data: shown() })
    }

    const body = request.postDataJSON() as { product_name: string | null; short_name: string | null; support_url: string | null; revision: number }
    if (body.revision !== state.brand.revision)
      return json(route, { message: "The brand was changed since you opened it. Reload to see the latest version.", code: "brand_changed" }, 409)
    Object.assign(state.brand, { product_name: body.product_name, short_name: body.short_name, support_url: body.support_url, revision: state.brand.revision + 1 })
    return json(route, { data: shown() })
  })

  await page.route(/\/api\/v1\/organizations\/[^/]+\/logo(\/dark)?$/, async (route) => {
    const request = route.request()
    const [, uuid, dark] = new URL(request.url()).pathname.match(/organizations\/([^/]+)\/logo(\/dark)?$/)!
    const method = request.method()
    sent.push({ method, path: new URL(request.url()).pathname, body: null })
    if (method === "POST" && (request.postData() ?? "").includes("refused")) return refusedImage(route)

    const organization = options.organizations?.().find((item) => item.uuid === uuid)
    if (!organization) return json(route, { message: "Not Found" }, 404)
    // What it showed before it had a logo of its own is its provider's brand.
    if (!providers.has(uuid)) providers.set(uuid, organization.logo ? undefined : organization.brand)
    const provider = providers.get(uuid)
    organization[dark ? "logo_dark" : "logo"] = method === "POST" ? { url: ownPixel, width: 480, height: 120 } : null
    organization.brand = {
      product_name: provider?.product_name ?? null,
      logo: organization.logo ?? provider?.logo ?? null,
      logo_dark: organization.logo ? (organization.logo_dark ?? null) : (provider?.logo_dark ?? null),
    }
    return json(route, { data: { uuid, logo: organization.logo ?? null, logo_dark: organization.logo_dark ?? null, brand: organization.brand } })
  })

  return { sent, state }
}
