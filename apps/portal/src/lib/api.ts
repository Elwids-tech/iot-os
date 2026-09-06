import { ApiClient } from "@iot-os/api-client"
const configured = new URL(
  import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8001",
)
if (
  ["localhost", "127.0.0.1"].includes(configured.hostname) &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname)
)
  configured.hostname = window.location.hostname
export const api = new ApiClient(configured.toString())
