/** Public, non-secret values injected by the web container before modules load. */
export type RuntimeConfig = Partial<Record<"VITE_API_URL" | "VITE_PORTAL_URL" | "VITE_ADMIN_URL" | "VITE_MAP_STYLE_URL", string>> & { environment?: string }
declare global { interface Window { __IOT_CONFIG__?: RuntimeConfig } }
export function runtimeConfig(key: keyof RuntimeConfig, fallback?: string): string | undefined {
  return (typeof window !== "undefined" ? window.__IOT_CONFIG__?.[key] : undefined) || fallback
}
