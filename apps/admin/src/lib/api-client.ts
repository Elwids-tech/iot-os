import { runtimeConfig } from "@iot-os/api-client"
import { ApiClient } from "@iot-os/api-client"

function apiBaseUrl(): string {
  const configuredUrl = runtimeConfig("VITE_API_URL", import.meta.env.VITE_API_URL) ?? "http://127.0.0.1:8001"

  if (typeof window === "undefined") {
    return configuredUrl
  }

  const pageHostname = window.location.hostname
  const apiUrl = new URL(configuredUrl)
  const loopbackHostnames = ["localhost", "127.0.0.1"]

  if (loopbackHostnames.includes(pageHostname) && loopbackHostnames.includes(apiUrl.hostname)) {
    apiUrl.hostname = pageHostname
  }

  return apiUrl.toString()
}

export const apiClient = new ApiClient(
  apiBaseUrl(),
)
