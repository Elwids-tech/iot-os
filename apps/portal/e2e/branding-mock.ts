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

export type MockAddress = {
  uuid: string
  kind: "name" | "domain"
  host: string
  url: string
  state: "waiting_dns" | "active" | "unreachable" | "suspended" | "lapsed"
  main: boolean
  claimed_at: string | null
  activated_at: string | null
  last_checked_at: string | null
  unreachable_since: string | null
  suspended_at: string | null
  record: { type: "CNAME"; name: string; value: string } | null
  lapses_at: string | null
}

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
export async function mockBranding(
  page: Page,
  options: {
    allowed?: boolean
    organizations?: () => Organization[]
    /** The deployment's domain for names, such as `example.com`; without it addresses are not available. */
    addressesDomain?: string
    /** The account's Custom domain switch. */
    customDomain?: boolean
    /** Addresses the account already has. */
    addresses?: MockAddress[]
    /** The brand already has this product name. */
    productName?: string
  } = {},
) {
  const sent: { method: string; path: string; body: unknown }[] = []
  const state = {
    allowed: options.allowed ?? false,
    brand: {
      product_name: (options.productName ?? null) as string | null,
      short_name: null as string | null,
      support_url: null as string | null,
      logo: null as MockImage | null,
      logo_dark: null as MockImage | null,
      icon: null as MockImage | null,
      revision: options.productName ? 1 : 0,
    },
    addresses: [...(options.addresses ?? [])] as MockAddress[],
    /** Whether the domain's DNS record is in place: a check then activates it. */
    recordFound: false,
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
          addresses: state.addresses,
          allowances: { branding: state.allowed, custom_domain: options.customDomain ?? false, hide_powered_by: false },
          addresses_available: options.addressesDomain !== undefined,
          name_suffix: options.addressesDomain === undefined ? null : `.${options.addressesDomain}`,
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

  // Portal addresses (spec 036 US1): `taken` stands for a name another account holds.
  await page.route(/\/api\/v1\/billing-accounts\/[^/]+\/addresses\/[^/]+$/, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === "DELETE") {
      sent.push({ method: "DELETE", path, body: null })
      state.addresses = state.addresses.filter((address) => !path.endsWith(`/${address.uuid}`))
      return route.fulfill({ status: 204 })
    }
    const body = request.postDataJSON() as { name: string }
    sent.push({ method: "PUT", path, body })
    if (!state.allowed) return json(route, { message: "Branding is not part of this billing account's plan.", code: "branding_not_allowed" }, 403)
    if (body.name === "taken") return json(route, { message: "This name is taken. Choose another.", code: "name_taken" }, 409)
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(body.name))
      return json(route, { message: "Use 3 to 40 letters, numbers and single hyphens, starting and ending with a letter or number.", code: "name_invalid", errors: { name: ["Use 3 to 40 letters, numbers and single hyphens, starting and ending with a letter or number."] } }, 422)
    const host = `${body.name}.${options.addressesDomain}`
    const address: MockAddress = {
      uuid: "ad000000-0000-4000-8000-000000000001", kind: "name", host, url: `https://${host}`, state: "active", main: true,
      claimed_at: new Date().toISOString(), activated_at: new Date().toISOString(), last_checked_at: null, unreachable_since: null, suspended_at: null,
      record: null, lapses_at: null,
    }
    state.addresses = [address, ...state.addresses.filter((each) => each.kind === "domain")]
    return json(route, { data: address })
  })

  // Custom domains (spec 036 US3): a claim waits for its record; a check finds it once `recordFound` is set.
  await page.route(/\/api\/v1\/billing-accounts\/[^/]+\/addresses\/domain$/, async (route) => {
    const request = route.request()
    const body = request.postDataJSON() as { host: string }
    sent.push({ method: "PUT", path: new URL(request.url()).pathname, body })
    if (!(options.customDomain ?? false)) return json(route, { message: "A custom domain is not part of this billing account's plan.", code: "custom_domain_not_allowed" }, 403)
    const host = body.host.trim().toLowerCase()
    if (host.split(".").length < 3) {
      const message = `Use a subdomain such as portal.${host}. A bare domain cannot point here with a CNAME record.`
      return json(route, { message, code: "bare_domain", errors: { host: [message] } }, 422)
    }
    if (host === "taken.example.org") return json(route, { message: "This domain is already in use.", code: "host_taken" }, 409)
    const address: MockAddress = {
      uuid: "ad000000-0000-4000-8000-000000000002", kind: "domain", host, url: `https://${host}`, state: "waiting_dns", main: false,
      claimed_at: new Date().toISOString(), activated_at: null, last_checked_at: null, unreachable_since: null, suspended_at: null,
      record: { type: "CNAME", name: host, value: `c-0123456789abcdef0123.${options.addressesDomain}` },
      lapses_at: new Date(Date.UTC(2031, 0, 15)).toISOString(),
    }
    state.addresses = [...state.addresses.filter((each) => each.kind === "name"), address]
    return json(route, { data: address })
  })
  await page.route(/\/api\/v1\/billing-accounts\/[^/]+\/addresses\/[^/]+\/check$/, async (route) => {
    const path = new URL(route.request().url()).pathname
    sent.push({ method: "POST", path, body: null })
    const address = state.addresses.find((each) => path.includes(`/${each.uuid}/`))
    if (!address) return json(route, { message: "Not Found" }, 404)
    address.last_checked_at = new Date().toISOString()
    if (state.recordFound) {
      Object.assign(address, { state: "active", main: true, activated_at: new Date().toISOString(), lapses_at: null })
      state.addresses.filter((each) => each !== address).forEach((each) => (each.main = false))
    }
    return json(route, { data: address })
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
