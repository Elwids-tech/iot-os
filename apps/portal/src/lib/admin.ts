import { runtimeAddress, runtimeConfig } from "@iot-os/api-client"

/** The admin app's address: from the deployment, or the dev admin beside this portal. */
/**
 * The admin app's address: from the deployment, or the dev admin beside this portal.
 * Empty on a billing account's address (spec 036): the admin app stays on the platform's
 * domain and is never named or linked there, not even from the build's own value.
 */
export const adminUrl = runtimeAddress()
  ? ""
  : runtimeConfig("VITE_ADMIN_URL", import.meta.env.VITE_ADMIN_URL) ||
    `${window.location.protocol}//${window.location.hostname}:5174`
