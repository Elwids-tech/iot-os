export type {
  components as DeviceDomainComponents,
  operations as DeviceDomainOperations,
  paths as DeviceDomainPaths,
} from "./device-domain.generated"
export { deviceDomainVocabulary } from "./device-domain-vocabulary"

export type Organization = {
  uuid: string
  name: string
  slug: string
  users_count?: number
  capabilities?: {
    manage_administration: boolean
  }
}

export type PlatformRoleSummary = {
  key: string
  display_name: string
}

export type PlatformUser = {
  id: number
  name: string
  email: string
  is_super_admin: boolean
  platform_roles: PlatformRoleSummary[]
  organizations: Organization[]
}

export type OrganizationRole = {
  id: number
  key: string
  display_name: string
  is_default: boolean
  permissions_count: number
  organization: Organization
}

export type RolePermission = {
  name: string
  group: string
  assigned: boolean
}

export type OrganizationRoleDetail = Omit<OrganizationRole, "permissions_count"> & {
  permissions_editable: boolean
  permission_update_message: string | null
  permissions: RolePermission[]
}

export type InvitationRole = {
  id: number
  display_name: string
}

export type OrganizationInvitation = {
  uuid: string
  email: string
  role_ids: number[]
  roles: InvitationRole[]
  organization: Organization
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  status: "pending" | "accepted" | "revoked" | "expired"
}

export type InvitationDetails = {
  organization: Pick<Organization, "uuid" | "name">
  email: string
  expires_at: string
  acceptance_mode: "create_account" | "sign_in"
}

export type PaginationMeta = {
  current_page: number
  from: number | null
  last_page: number
  per_page: number
  to: number | null
  total: number
}

export type PaginatedResponse<T> = {
  data: T[]
  meta: PaginationMeta
}

export type DirectoryQuery = {
  search?: string
  organization?: string
  page?: number
  perPage?: number
}

export type AuthenticatedUser = {
  id: number
  name: string
  email: string
  email_verified_at: string | null
  is_super_admin: boolean
  capabilities: {
    platform_administration: boolean
  }
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

type InvitationRegistration = {
  name: string
  password: string
  password_confirmation: string
}

const ORGANIZATION_STORAGE_KEY = "iot-os.selected-organization"

function readCookie(name: string): string | null {
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`))

  return value ? decodeURIComponent(value.split("=").slice(1).join("=")) : null
}

function directoryQuery(query: DirectoryQuery = {}): string {
  const parameters = new URLSearchParams()

  if (query.search?.trim()) {
    parameters.set("search", query.search.trim())
  }

  if (query.organization) {
    parameters.set("organization", query.organization)
  }

  if (query.page && query.page > 1) {
    parameters.set("page", query.page.toString())
  }

  if (query.perPage) {
    parameters.set("per_page", query.perPage.toString())
  }

  const value = parameters.toString()

  return value ? `?${value}` : ""
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

  async adminOrganizations(query: DirectoryQuery = {}): Promise<PaginatedResponse<Organization>> {
    return this.request<PaginatedResponse<Organization>>(
      `/api/v1/admin/organizations${directoryQuery(query)}`,
    )
  }

  async adminUsers(query: DirectoryQuery = {}): Promise<PaginatedResponse<PlatformUser>> {
    return this.request<PaginatedResponse<PlatformUser>>(
      `/api/v1/admin/users${directoryQuery(query)}`,
    )
  }

  async adminRoles(query: DirectoryQuery = {}): Promise<PaginatedResponse<OrganizationRole>> {
    return this.request<PaginatedResponse<OrganizationRole>>(
      `/api/v1/admin/roles${directoryQuery(query)}`,
    )
  }

  async adminOrganizationRoles(organizationUuid: string): Promise<OrganizationRole[]> {
    return this.request<ApiResponse<OrganizationRole[]>>(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationUuid)}/roles`,
    ).then((response) => response.data)
  }

  async adminInvitations(query: DirectoryQuery = {}): Promise<PaginatedResponse<OrganizationInvitation>> {
    return this.request<PaginatedResponse<OrganizationInvitation>>(
      `/api/v1/admin/invitations${directoryQuery(query)}`,
    )
  }

  async inviteUser(
    organizationUuid: string,
    email: string,
    roleIds: number[],
  ): Promise<OrganizationInvitation> {
    return this.request<ApiResponse<OrganizationInvitation>>(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationUuid)}/invitations`,
      {
        method: "POST",
        body: JSON.stringify({ email, role_ids: roleIds }),
      },
    ).then((response) => response.data)
  }

  async revokeAdminInvitation(invitationUuid: string): Promise<void> {
    await this.request(`/api/v1/admin/invitations/${encodeURIComponent(invitationUuid)}`, {
      method: "DELETE",
    })
  }

  async invitation(token: string): Promise<InvitationDetails> {
    return this.request<ApiResponse<InvitationDetails>>(
      `/api/v1/invitations/${encodeURIComponent(token)}`,
    ).then((response) => response.data)
  }

  async acceptInvitation(
    token: string,
    registration?: InvitationRegistration,
  ): Promise<AuthenticatedUser> {
    await this.csrf()

    return this.request<ApiResponse<AuthenticatedUser>>(
      `/api/v1/invitations/${encodeURIComponent(token)}/accept`,
      {
        method: "POST",
        body: JSON.stringify(registration ?? {}),
      },
    ).then((response) => response.data)
  }

  async adminRole(id: number): Promise<OrganizationRoleDetail> {
    return this.request<ApiResponse<OrganizationRoleDetail>>(`/api/v1/admin/roles/${id}`).then(
      (response) => response.data,
    )
  }

  async syncAdminRolePermissions(
    id: number,
    permissionNames: string[],
  ): Promise<OrganizationRoleDetail> {
    return this.request<ApiResponse<OrganizationRoleDetail>>(
      `/api/v1/admin/roles/${id}/permissions`,
      {
        method: "PUT",
        body: JSON.stringify({ permission_names: permissionNames }),
      },
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
