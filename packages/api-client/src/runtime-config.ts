/** Public, non-secret values injected by the web container before modules load. */
type RuntimeUrls = Partial<Record<"VITE_API_URL" | "VITE_PORTAL_URL" | "VITE_ADMIN_URL" | "VITE_MAP_STYLE_URL", string>>
/** The brand of the portal address the page was opened on (spec 036, contracts/portal-bootstrap.md). */
export type RuntimeBrand = {
  product_name: string
  short_name: string
  support_url: string | null
  logo: string | null
  logo_dark: string | null
  icon: string | null
  touch_icon: string | null
  /** The platform's name for the **Powered by** line, or null when the account's plan hides it. */
  powered_by: string | null
}
/** The portal address the page was opened on. Absent on the platform's own address. */
export type RuntimeAddress =
  | { kind: "name" | "domain"; host: string; state: "active" | "unreachable" }
  | { state: "not_in_use" }
  | { state: "moved"; to: string }
export type RuntimeConfig = RuntimeUrls & { environment?: string; address?: RuntimeAddress; brand?: RuntimeBrand | null; sign_up?: boolean }
declare global { interface Window { __IOT_CONFIG__?: RuntimeConfig } }
const config = (): RuntimeConfig | undefined => (typeof window !== "undefined" ? window.__IOT_CONFIG__ : undefined)
export function runtimeConfig(key: keyof RuntimeUrls | "environment", fallback?: string): string | undefined {
  return config()?.[key] || fallback
}
/** The billing account's address this page runs on, or null on the platform's own. */
export function runtimeAddress(): Extract<RuntimeAddress, { host: string }> | null {
  const address = config()?.address
  return address && "host" in address ? address : null
}
/** The brand to show before anyone signs in, or null for the platform's own name. */
export function runtimeBrand(): RuntimeBrand | null {
  return (runtimeAddress() && config()?.brand) || null
}
/**
 * The API's origin. On an address an empty `VITE_API_URL` means the page's own origin
 * (a custom domain serves the API itself); elsewhere it means "use the build's value".
 */
export function runtimeApiUrl(fallback?: string): string | undefined {
  const configured = config()?.VITE_API_URL
  if (!configured && runtimeAddress() && typeof window !== "undefined") return window.location.origin
  return configured || fallback
}
