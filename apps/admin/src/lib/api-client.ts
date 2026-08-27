import { ApiClient } from "@iot-os/api-client"

export const apiClient = new ApiClient(
  import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8001",
)
