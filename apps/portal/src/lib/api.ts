import { runtimeApiUrl } from "@iot-os/api-client"
import { ApiClient } from "@iot-os/api-client"
const configured = new URL(
  // On a billing account's address the deployment names the API, or it is this origin (spec 036).
  runtimeApiUrl(import.meta.env.VITE_API_URL) ?? "http://127.0.0.1:8001",
)
if (
  ["localhost", "127.0.0.1"].includes(configured.hostname) &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname)
)
  configured.hostname = window.location.hostname
/** The API's origin, for links that leave the portal for the API (agent sign-in). */
export const apiBaseUrl = configured.toString()
export const api = new ApiClient(configured.toString())
