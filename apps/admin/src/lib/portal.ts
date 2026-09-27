import { runtimeConfig } from "@iot-os/api-client"
export const portalUrl =
  runtimeConfig("VITE_PORTAL_URL", import.meta.env.VITE_PORTAL_URL) || `${window.location.protocol}//${window.location.hostname}:5173`
