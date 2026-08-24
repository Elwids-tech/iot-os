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
  is_super_admin: boolean
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

const ORGANIZATION_STORAGE_KEY = "iot-os.selected-organization"

function readCookie(name: string): string | null {
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`))

  return value ? decodeURIComponent(value.split("=").slice(1).join("=")) : null
}

export class ApiClient {
  private readonly baseUrl: string
  private selectedOrganizationUuid: string | null

  constructor(baseUrl = "http://localhost:8000") {
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.selectedOrganizationUuid =
      typeof window === "undefined" ? null : window.localStorage.getItem(ORGANIZATION_STORAGE_KEY)
  }

  getSelectedOrganizationUuid(): string | null {
    return this.selectedOrganizationUuid
  }

  setSelectedOrganizationUuid(uuid: string | null): void {
    this.selectedOrganizationUuid = uuid

    if (typeof window === "undefined") {
      return
    }

    if (uuid) {
      window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, uuid)
    } else {
      window.localStorage.removeItem(ORGANIZATION_STORAGE_KEY)
    }
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

  async organizationContext(uuid: string): Promise<Organization> {
    return this.request<ApiResponse<Organization>>(
      `/api/v1/organizations/${encodeURIComponent(uuid)}/context`,
    ).then((response) => response.data)
  }

  async logout(): Promise<void> {
    await this.request("/api/v1/auth/logout", { method: "POST" })
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set("Accept", "application/json")

    if (this.selectedOrganizationUuid) {
      headers.set("X-Organization-UUID", this.selectedOrganizationUuid)
    }

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
