import { runtimeAddress, runtimeConfig } from "@iot-os/api-client"

/** The admin app's address: from the deployment, or the dev admin beside this portal. */
/** The portal's own address on the platform's domain: where staff reach the admin app from. */
const platformAdmin = () => runtimeConfig("VITE_ADMIN_URL", import.meta.env.VITE_ADMIN_URL)

/**
 * The admin app's address: from the deployment, or the dev admin beside this portal. A
 * billing account's address is never given one (spec 036), so the build's value is
 * used there, and never a guess from the address's own host.
 */
export const adminUrl =
  platformAdmin() ||
  (runtimeAddress() ? "" : `${window.location.protocol}//${window.location.hostname}:5174`)
