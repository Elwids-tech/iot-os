export type Organization = {
  uuid: string
  name: string
  slug: string
}

export type AuthenticatedUser = {
  id: number
  name: string
  email: string
  email_verified_at: string | null
  organizations: Organization[]
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    super("The API request failed.")
  }
}

type ApiResponse<T> = {
  data: T
}

type LoginCredentials = {
  email: string
  password: string
}

function readCookie(name: string): string | null {
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`))

  return value ? decodeURIComponent(value.split("=").slice(1).join("=")) : null
}

export class ApiClient {
  private readonly baseUrl: string

  constructor(baseUrl = "http://localhost:8000") {
    this.baseUrl = baseUrl.replace(/\/$/, "")
  }

  async csrf(): Promise<void> {
    await fetch(`${this.baseUrl}/sanctum/csrf-cookie`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
  }

  async login(credentials: LoginCredentials): Promise<AuthenticatedUser> {
    await this.csrf()

    return this.request<ApiResponse<AuthenticatedUser>>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    }).then((response) => response.data)
  }

  async me(): Promise<AuthenticatedUser> {
    return this.request<ApiResponse<AuthenticatedUser>>("/api/v1/me").then(
      (response) => response.data,
    )
  }

  async logout(): Promise<void> {
    await this.request("/api/v1/auth/logout", { method: "POST" })
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set("Accept", "application/json")

    if (!["GET", "HEAD", "OPTIONS"].includes((init.method ?? "GET").toUpperCase())) {
      const token = readCookie("XSRF-TOKEN")

      if (token) {
        headers.set("X-XSRF-TOKEN", token)
      }
    }

    if (init.body) {
      headers.set("Content-Type", "application/json")
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers,
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      throw new ApiError(response.status, payload)
    }

    return payload as T
  }
}

export const apiClient = new ApiClient()
