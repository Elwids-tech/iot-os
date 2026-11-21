import type { Page, Route } from "@playwright/test"

// The Branding panel of a billing account page (spec 036), mocked for every spec that
// opens one. Registered after a spec's own catch-all, so these routes answer first.

type Image = { url: string; width: number; height: number }

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

/** `branding` says whether the account's Branding switch is on, read at each request. */
export async function mockBranding(page: Page, branding: () => boolean = () => false) {
  const sent: { method: string; path: string; body: unknown }[] = []
  const brand = {
    product_name: null as string | null,
    short_name: null as string | null,
    support_url: null as string | null,
    logo: null as Image | null,
    logo_dark: null as Image | null,
    icon: null as Image | null,
    revision: 0,
  }
  const shown = () => ({ ...brand, in_effect: branding() && brand.product_name !== null })

  await page.route(/\/api\/v1\/admin\/billing-accounts\/[^/]+\/(branding|brand(\/images\/(logo|logo_dark|icon))?)$/, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const role = path.match(/\/images\/(logo|logo_dark|icon)$/)?.[1] as "logo" | "logo_dark" | "icon" | undefined

    if (method === "GET")
      return json(route, {
        data: {
          brand: shown(),
          addresses: [],
          allowances: { branding: branding(), custom_domain: false, hide_powered_by: false },
          addresses_available: false,
          name_suffix: null,
          limits: { image_bytes: 1048576, types: ["image/png", "image/jpeg", "image/webp"], icon_min: 512 },
        },
      })

    if (role) {
      sent.push({ method, path, body: null })
      // A file named "refused" stands for an image the API refuses.
      if (method === "POST" && (request.postData() ?? "").includes("refused"))
        return json(route, { message: "The icon must be square.", code: "image_not_square", errors: { image: ["The icon must be square."] } }, 422)
      brand[role] = method === "POST" ? { url: pixel, width: role === "icon" ? 512 : 480, height: role === "icon" ? 512 : 120 } : null
      brand.revision++
      return json(route, { data: shown() })
    }

    const body = request.postDataJSON() as { product_name: string | null; short_name: string | null; support_url: string | null; revision: number }
    sent.push({ method, path, body })
    if (body.revision !== brand.revision)
      return json(route, { message: "The brand was changed since you opened it. Reload to see the latest version.", code: "brand_changed" }, 409)
    Object.assign(brand, { product_name: body.product_name, short_name: body.short_name, support_url: body.support_url, revision: brand.revision + 1 })
    return json(route, { data: shown() })
  })

  return { sent, brand }
}
