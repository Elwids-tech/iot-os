import { runtimeConfig } from "@iot-os/api-client"

/** The admin app's address: from the deployment, or the dev admin beside this portal. */
export const adminUrl =
  runtimeConfig("VITE_ADMIN_URL", import.meta.env.VITE_ADMIN_URL) ||
  `${window.location.protocol}//${window.location.hostname}:5174`
