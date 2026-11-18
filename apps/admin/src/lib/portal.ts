import { runtimeConfig } from "@iot-os/api-client"
export const portalUrl =
  runtimeConfig("VITE_PORTAL_URL", import.meta.env.VITE_PORTAL_URL) || `${window.location.protocol}//${window.location.hostname}:5173`

/** A person's own sign-in security (two-step sign-in, spec 034) is a portal page. */
export const securitySettingsUrl = `${portalUrl.replace(/\/$/, "")}/account/security`

/**
 * Required two-step sign-in that is not set up (spec 034): the portal's setup page, which
 * comes back here when it is done. The apps share the session, so the person returns set up.
 */
export function twoStepSetupUrl(returnTo: string) {
  return `${portalUrl.replace(/\/$/, "")}/account/security/setup?${new URLSearchParams({ return: returnTo })}`
}
