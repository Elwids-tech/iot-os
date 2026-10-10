import type {
  Device,
  DeviceDetail,
  DeviceDraft,
  DeviceInput,
  DeviceValidation,
  DeviceCommand,
  DeviceCapabilities,
  DiscoveryCandidate,
  Gateway,
  SparkplugConnection,
  Measurement,
  HistorySeries,
  HistoryRecordsPage,
  StateHistory,
  CounterBucket,
  CounterIncrease,
  UnitCatalogue,
  Site,
  SiteInput,
  RetentionSetting,
} from "./devices"

import type { Dashboard, DashboardInput, DashboardRevision, DashboardRevisionSummary } from "./dashboards"
export * from "./dashboards"
export * from "./devices"
export * from "./telemetry"
export * from "./alerts"
export * from "./notifications"
export * from "./adapters"
export * from "./geospatial"
export * from "./overview"

export type Organization = {
  uuid: string
  name: string
  slug: string
  users_count?: number
  capabilities?: {
    manage_administration: boolean
    /** Member, invitation and role screens. Older payloads omit it. */
    administration?: AdministrationCapabilities
    device_profiles?: DeviceProfileCapabilities
    devices?: DeviceCapabilities
    /** Optional platform features enabled for this organization. */
    features?: { device_adapters: boolean }
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

export type OrganizationRoleDetail = Omit<
  OrganizationRole,
  "permissions_count"
> & {
  permissions_editable: boolean
  permission_update_message: string | null
  permissions: RolePermission[]
}

export type InvitationRole = {
  id: number
  display_name: string
}

export type AdministrationCapabilities = {
  members_view: boolean
  invite: boolean
  members_update: boolean
  members_remove: boolean
  roles_view: boolean
  roles_create: boolean
  roles_update: boolean
  roles_delete: boolean
}

export type OrganizationMember = {
  id: number
  name: string
  email: string
  is_current_user?: boolean
  /** Whether the acting user could change or remove this member without escalating. */
  manageable?: boolean
  roles: Pick<OrganizationRole, "id" | "key" | "display_name" | "is_default">[]
}

export type TenantPermission = {
  name: string
  group: string
  /** Whether the acting user may grant it: inside the ceiling and held by them. */
  grantable?: boolean
}

/** An organization role as the organization's own administrators see it. */
export type TenantRole = {
  id: number
  key: string
  display_name: string
  is_default: boolean
  is_administrator: boolean
  members_count?: number
  /** Every permission in the role is one the acting user can grant. */
  assignable?: boolean
  /** The acting user could edit or delete it. Organization Admin never is. */
  manageable?: boolean
  permissions: Omit<TenantPermission, "grantable">[]
}

export type TenantRoleValues = {
  display_name: string
  permission_names: string[]
}

export type TenantInvitation = Omit<OrganizationInvitation, "organization"> & {
  invited_by: { id: number; name: string } | null
  /** Whether the acting user could resend or revoke it. */
  manageable?: boolean
}

export type MemberQuery = {
  page?: number
  search?: string
  perPage?: number
}

/** The tenant permissions an organization's roles may hold. */
export type OrganizationPermissionCeiling = {
  organization: Pick<Organization, "uuid" | "name" | "slug">
  restricted: boolean
  permission_names: string[]
  catalogue: Omit<TenantPermission, "grantable">[]
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
    manage_retention?: boolean
  }
  organizations: Organization[]
}

export type JsonObject = { [key: string]: JsonValue }
export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonObject
  | JsonValue[]

export type IngressConversion = {
  source_unit: string | null
  multiplier: number
  offset: number
}

export type DeviceProfileParameter = {
  ingress_conversion?: IngressConversion | null
  uuid: string
  key: string
  label: string
  kind: "state" | "measurement" | "counter" | "event" | "derived"
  data_type:
    | "boolean"
    | "integer"
    | "number"
    | "enum"
    | "string"
    | "timestamp"
    | "bytes"
  format: string | null
  unit: string | null
  reports_state: boolean
  accepts_command: boolean
  validation: JsonObject | null
  display: JsonObject | null
  reporting: JsonObject | null
  counter: JsonObject | null
}

export type DeviceProfileCalculation = {
  engine: "json_logic"
  expression: JsonObject
  failure_policy: "mark_invalid"
  inputs: Array<{ alias: string; parameter_uuid: string }>
  target_parameter_uuid: string
  trigger: "on_input_change"
}

export type DeviceProfileAlarmTemplate = {
  uuid: string
  code: string
  name: string
  type: string
  severity: string
  enabled_by_default: boolean
  condition: JsonObject
  parameters: Array<{ parameter_uuid: string; role: string }>
}

export type CompiledDeviceProfileDefinition = {
  schema_version: "device-profile.v1" | "device-profile.v2"
  profile: {
    uuid: string
    code: string
    name: string
    category: string | null
    revision: number
  }
  parameters: DeviceProfileParameter[]
  calculations: DeviceProfileCalculation[]
  alarm_templates: DeviceProfileAlarmTemplate[]
}

export type DeviceProfile = {
  parameters_count?: number
  /** List only; omitted when the user lacks Device.view. */
  devices_count?: number
  uuid: string
  code: string
  name: string
  description: string | null
  category: string | null
  status: "draft" | "published" | "archived"
  revision: number
  draft_revision: number
  definition_hash: string | null
  published_at: string | null
  extensions: JsonObject | null
  updated_at: string
}

export type DeviceProfileArtifact = {
  uuid: string
  profile_uuid: string
  revision: number
  definition_hash: string
  definition: CompiledDeviceProfileDefinition
  status: "active" | "retired"
  compiled_at: string
}

export type DeviceProfileDiagnostic = {
  code: string
  message: string
  pointer: string
}

export type DeviceProfileValidationResult = {
  draft_revision: number
  valid: boolean
  diagnostics: DeviceProfileDiagnostic[]
}

export type DeviceProfileCapabilities = Record<
  | "view_any"
  | "view"
  | "create"
  | "update"
  | "delete_draft"
  | "validate"
  | "publish",
  boolean
>
export type ProfileGroup = {
  uuid: string
  code: string
  label: string
  description: string | null
  sort_order: number
}
export type AuthoringCalculation = Omit<
  DeviceProfileCalculation,
  "target_parameter_uuid"
> & { uuid?: string }
export type AuthoringParameter = Omit<
  DeviceProfileParameter,
  "validation" | "display" | "reporting" | "counter"
> & {
  description: string | null
  parameter_group_uuid: string | null
  sort_order: number
  validation_logic: JsonObject | null
  display_config: JsonObject | null
  reporting_config: JsonObject | null
  counter_config: JsonObject | null
  /** Quantity from the unit catalogue, or null for custom and unitless parameters. */
  unit_quantity?: string | null
  /** In a published artifact: key, kind, data type and unit are fixed. */
  published?: boolean
  calculation?: AuthoringCalculation | null
}
export type AuthoringAlarm = Omit<
  DeviceProfileAlarmTemplate,
  "condition" | "parameters"
> & {
  condition_config: JsonObject
  parameter_references: Array<{ parameter_uuid: string; role: string }>
}
export type DeviceProfileDetail = DeviceProfile & {
  parameter_groups: ProfileGroup[]
  parameters: AuthoringParameter[]
  alarm_templates: AuthoringAlarm[]
  active_artifact: DeviceProfileArtifact | null
}
export type DraftInput = { draft_revision: number }
export type ProfileInput = Pick<DeviceProfile, "name" | "code"> &
  Partial<Pick<DeviceProfile, "description" | "category" | "extensions">>
export type ParameterInput = Omit<AuthoringParameter, "uuid" | "calculation"> &
  DraftInput
export type GroupInput = Omit<ProfileGroup, "uuid" | "sort_order"> &
  DraftInput & { sort_order?: number }
export type CalculationOutput = Pick<
  AuthoringParameter,
  "key" | "label" | "data_type" | "unit" | "parameter_group_uuid"
>
export type CalculationInput = Omit<AuthoringCalculation, "uuid"> &
  DraftInput & { output?: CalculationOutput }
export type AlarmInput = Omit<AuthoringAlarm, "uuid"> & DraftInput
export type ProfileDirectoryQuery = DirectoryQuery & {
  status?: string
  category?: string
}
export type CompiledDraft = {
  definition: CompiledDeviceProfileDefinition
  definition_hash: string
  revision: number
  draft_revision: number
}
export type ArtifactSummary = Omit<
  DeviceProfileArtifact,
  "definition" | "profile_uuid"
>
export type PreviewInput = DraftInput &
  (
    | {
        kind: "validation" | "conversion"
        parameter: Pick<
          AuthoringParameter,
          "data_type" | "format" | "validation_logic"
        > &
          Partial<
            Pick<
              AuthoringParameter,
              | "kind"
              | "reports_state"
              | "accepts_command"
              | "counter_config"
              | "ingress_conversion"
            >
          >
        value: JsonValue
        previous_value?: JsonValue
      }
    | {
        kind: "calculation"
        output_data_type?: DeviceProfileParameter["data_type"]
        expression: JsonObject
        inputs: AuthoringCalculation["inputs"]
        samples: JsonObject
      }
  )
export type PreviewResult = DeviceProfileValidationResult & {
  result: JsonValue
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

export type * from "./assistant"
export type * from "./help"
export type IntegrationAbility = "devices:read" | "alerts:read" | "events:read" | "telemetry:read" | "locations:read" | "geofences:read" | "geofences:manage" | "geofences:activate"
export interface IntegrationApplication {
  uuid: string; name: string; abilities: IntegrationAbility[]; device_uuids: string[];
  revision: number; grant_revision: number; revoked_at: string | null;
  devices: {uuid: string; name: string; code: string}[];
  credential: { abilities: IntegrationAbility[]; expires_at: string } | null;
}
export type IntegrationGrants = Pick<IntegrationApplication, "name" | "abilities" | "device_uuids">
export interface IntegrationWebhook {
  uuid: string; url: string; revision: number; enabled: boolean; diagnostic: string | null; grant_revision: number;
}
export interface IntegrationDelivery {
  uuid: string; status: string; attempts: number; retry_revision: number; diagnostic: string | null;
  next_attempt_at: string | null; expires_at: string; delivered_at: string | null;
  history: {attempt: number; http_status: number | null; outcome: string; created_at: string}[];
}
export class ApiClient {
  private readonly baseUrl: string
  private selectedOrganizationUuid: string | null

  constructor(baseUrl = "http://localhost:8000") {
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.selectedOrganizationUuid =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(ORGANIZATION_STORAGE_KEY)
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

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    await this.csrf()
    return this.request("/api/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    })
  }

  async resetPassword(input: {
    email: string
    token: string
    password: string
    password_confirmation: string
  }): Promise<{ message: string }> {
    await this.csrf()
    return this.request("/api/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  runtimeStatus(org: string) {
    return this.data<import("./overview").RuntimeStatus>(`/api/v1/organizations/${encodeURIComponent(org)}/runtime-status`)
  }
  overview(org: string) {
    return this.data<import("./overview").OrganizationOverview>(`/api/v1/organizations/${encodeURIComponent(org)}/overview`)
  }
  async me(): Promise<AuthenticatedUser> {
    return this.request<ApiResponse<AuthenticatedUser>>("/api/v1/me").then(
      (response) => response.data,
    )
  }

  notificationPreferences() {
    return this.data<import("./notifications").NotificationPreferences>("/api/v1/notifications/preferences")
  }

  updateNotificationPreferences(input: import("./notifications").NotificationPreferences) {
    return this.data<import("./notifications").NotificationPreferences>("/api/v1/notifications/preferences", "PUT", input)
  }

  notificationEvents(query = "") {
    return this.request<import("./notifications").NotificationEventsPage>(`/api/v1/notifications/events?${query}`)
  }

  async organizationContext(uuid: string): Promise<Organization> {
    return this.request<ApiResponse<Organization>>(
      `/api/v1/organizations/${encodeURIComponent(uuid)}/context`,
    ).then((response) => response.data)
  }

  async deviceProfiles(
    organizationUuid: string,
    query: ProfileDirectoryQuery = {},
  ): Promise<PaginatedResponse<DeviceProfile>> {
    return this.request<PaginatedResponse<DeviceProfile>>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/device-profiles${this.profileDirectoryQuery(query)}`,
    )
  }

  async createDeviceProfile(
    organizationUuid: string,
    attributes: Pick<DeviceProfile, "code" | "name"> &
      Partial<Pick<DeviceProfile, "description" | "category" | "extensions">>,
  ): Promise<DeviceProfile> {
    return this.request<ApiResponse<DeviceProfile>>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/device-profiles`,
      { method: "POST", body: JSON.stringify(attributes) },
    ).then((response) => response.data)
  }

  private profileDirectoryQuery(query: ProfileDirectoryQuery): string {
    const parameters = new URLSearchParams(
      directoryQuery(query).replace(/^\\?/, ""),
    )
    if (query.status) parameters.set("status", query.status)
    if (query.category) parameters.set("category", query.category)
    return parameters.size ? "?" + parameters.toString() : ""
  }

  private profilePath(organizationUuid: string, profileUuid: string): string {
    return `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/device-profiles/${encodeURIComponent(profileUuid)}`
  }

  private async profileOperation<T>(
    organizationUuid: string,
    profileUuid: string,
    suffix: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const response = await this.request<ApiResponse<T> | null>(
      this.profilePath(organizationUuid, profileUuid) + suffix,
      {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    )
    return response?.data as T
  }

  deviceProfile(org: string, profile: string): Promise<DeviceProfileDetail> {
    return this.profileOperation(org, profile, "")
  }
  updateDeviceProfile(
    org: string,
    profile: string,
    input: Partial<ProfileInput> & DraftInput,
  ): Promise<DeviceProfileDetail> {
    return this.profileOperation(org, profile, "", "PATCH", input)
  }
  deleteDeviceProfile(
    org: string,
    profile: string,
    revision: number,
  ): Promise<void> {
    return this.profileOperation(org, profile, "", "DELETE", {
      draft_revision: revision,
    })
  }
  saveProfileParameter(
    org: string,
    profile: string,
    uuid: string | null,
    input: ParameterInput,
  ): Promise<AuthoringParameter> {
    return this.profileOperation(
      org,
      profile,
      "/parameters" + (uuid ? "/" + encodeURIComponent(uuid) : ""),
      uuid ? "PATCH" : "POST",
      input,
    )
  }
  deleteProfileParameter(
    org: string,
    profile: string,
    uuid: string,
    revision: number,
  ): Promise<void> {
    return this.profileOperation(
      org,
      profile,
      "/parameters/" + encodeURIComponent(uuid),
      "DELETE",
      { draft_revision: revision },
    )
  }
  reorderProfileParameters(
    org: string,
    profile: string,
    uuids: string[],
    revision: number,
  ): Promise<void> {
    return this.profileOperation(org, profile, "/parameter-order", "PUT", {
      parameter_uuids: uuids,
      draft_revision: revision,
    })
  }
  saveProfileGroup(
    org: string,
    profile: string,
    uuid: string | null,
    input: GroupInput,
  ): Promise<ProfileGroup> {
    return this.profileOperation(
      org,
      profile,
      "/parameter-groups" + (uuid ? "/" + encodeURIComponent(uuid) : ""),
      uuid ? "PATCH" : "POST",
      input,
    )
  }
  deleteProfileGroup(
    org: string,
    profile: string,
    uuid: string,
    revision: number,
  ): Promise<void> {
    return this.profileOperation(
      org,
      profile,
      "/parameter-groups/" + encodeURIComponent(uuid),
      "DELETE",
      { draft_revision: revision },
    )
  }
  reorderProfileGroups(
    org: string,
    profile: string,
    uuids: string[],
    revision: number,
  ): Promise<void> {
    return this.profileOperation(org, profile, "/group-order", "PUT", {
      group_uuids: uuids,
      draft_revision: revision,
    })
  }
  createProfileCalculation(
    org: string,
    profile: string,
    input: CalculationInput,
  ): Promise<AuthoringParameter> {
    return this.profileOperation(org, profile, "/calculations", "POST", input)
  }
  saveProfileCalculation(
    org: string,
    profile: string,
    uuid: string,
    input: CalculationInput,
  ): Promise<AuthoringParameter> {
    return this.profileOperation(
      org,
      profile,
      "/parameters/" + encodeURIComponent(uuid) + "/calculation",
      "PUT",
      input,
    )
  }
  deleteProfileCalculation(
    org: string,
    profile: string,
    uuid: string,
    revision: number,
  ): Promise<void> {
    return this.profileOperation(
      org,
      profile,
      "/parameters/" + encodeURIComponent(uuid) + "/calculation",
      "DELETE",
      { draft_revision: revision },
    )
  }
  saveProfileAlarm(
    org: string,
    profile: string,
    uuid: string | null,
    input: AlarmInput,
  ): Promise<AuthoringAlarm> {
    return this.profileOperation(
      org,
      profile,
      "/alarm-templates" + (uuid ? "/" + encodeURIComponent(uuid) : ""),
      uuid ? "PATCH" : "POST",
      input,
    )
  }
  deleteProfileAlarm(
    org: string,
    profile: string,
    uuid: string,
    revision: number,
  ): Promise<void> {
    return this.profileOperation(
      org,
      profile,
      "/alarm-templates/" + encodeURIComponent(uuid),
      "DELETE",
      { draft_revision: revision },
    )
  }
  validateDeviceProfile(
    org: string,
    profile: string,
    revision?: number,
  ): Promise<DeviceProfileValidationResult> {
    return this.profileOperation(
      org,
      profile,
      "/validate",
      "POST",
      revision ? { draft_revision: revision } : {},
    )
  }
  compileDeviceProfile(
    org: string,
    profile: string,
    revision?: number,
  ): Promise<CompiledDraft> {
    return this.profileOperation(
      org,
      profile,
      "/compile",
      "POST",
      revision ? { draft_revision: revision } : {},
    )
  }
  previewDeviceProfile(
    org: string,
    profile: string,
    input: PreviewInput,
  ): Promise<PreviewResult> {
    return this.profileOperation(org, profile, "/preview", "POST", input)
  }
  profileArtifacts(
    org: string,
    profile: string,
    page = 1,
  ): Promise<PaginatedResponse<ArtifactSummary>> {
    return this.request(
      this.profilePath(org, profile) + "/artifacts?page=" + page,
    )
  }
  profileArtifact(
    org: string,
    profile: string,
    revision: number,
  ): Promise<DeviceProfileArtifact> {
    return this.profileOperation(org, profile, "/artifacts/" + revision)
  }

  async publishDeviceProfile(
    organizationUuid: string,
    profileUuid: string,
    draftRevision: number,
  ): Promise<DeviceProfileArtifact> {
    return this.request<ApiResponse<DeviceProfileArtifact>>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/device-profiles/${encodeURIComponent(profileUuid)}/publish`,
      {
        method: "POST",
        body: JSON.stringify({ draft_revision: draftRevision }),
      },
    ).then((response) => response.data)
  }

  async adminOrganizations(
    query: DirectoryQuery = {},
  ): Promise<PaginatedResponse<Organization>> {
    return this.request<PaginatedResponse<Organization>>(
      `/api/v1/admin/organizations${directoryQuery(query)}`,
    )
  }

  async createAdminOrganization(values: {
    name: string
    slug: string
  }): Promise<Organization> {
    return this.request<ApiResponse<Organization>>("/api/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify(values),
    }).then((response) => response.data)
  }

  async updateAdminOrganization(
    organizationUuid: string,
    values: { name: string; slug: string },
  ): Promise<Organization> {
    return this.request<ApiResponse<Organization>>(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationUuid)}`,
      { method: "PATCH", body: JSON.stringify(values) },
    ).then((response) => response.data)
  }

  async organizationMembers(
    organizationUuid: string,
    query: number | MemberQuery = 1,
  ): Promise<PaginatedResponse<OrganizationMember>> {
    const { page = 1, search, perPage = 100 } = typeof query === "number" ? { page: query } : query
    const params = new URLSearchParams({ per_page: String(perPage), page: String(page) })
    if (search?.trim()) params.set("search", search.trim())

    return this.request<PaginatedResponse<OrganizationMember>>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/members?${params}`,
    )
  }

  async organizationRoles(organizationUuid: string): Promise<TenantRole[]> {
    return this.request<ApiResponse<TenantRole[]>>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/roles`,
    ).then((response) => response.data)
  }

  /** The organization's permission ceiling, flagged with what the acting user can grant. */
  async organizationRolePermissions(organizationUuid: string): Promise<TenantPermission[]> {
    return this.request<ApiResponse<TenantPermission[]>>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/role-permissions`,
    ).then((response) => response.data)
  }

  async createOrganizationRole(organizationUuid: string, values: TenantRoleValues): Promise<TenantRole> {
    return this.request<ApiResponse<TenantRole>>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/roles`,
      { method: "POST", body: JSON.stringify(values) },
    ).then((response) => response.data)
  }

  async updateOrganizationRole(organizationUuid: string, roleId: number, values: TenantRoleValues): Promise<TenantRole> {
    return this.request<ApiResponse<TenantRole>>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/roles/${roleId}`,
      { method: "PATCH", body: JSON.stringify(values) },
    ).then((response) => response.data)
  }

  async deleteOrganizationRole(organizationUuid: string, roleId: number): Promise<void> {
    await this.request(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/roles/${roleId}`,
      { method: "DELETE" },
    )
  }

  async organizationInvitations(
    organizationUuid: string,
    query: { status?: "pending" | "expired"; page?: number } = {},
  ): Promise<PaginatedResponse<TenantInvitation>> {
    const params = new URLSearchParams({ status: query.status ?? "pending", page: String(query.page ?? 1), per_page: "100" })

    return this.request<PaginatedResponse<TenantInvitation>>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/invitations?${params}`,
    )
  }

  async inviteOrganizationMember(organizationUuid: string, email: string, roleIds: number[]): Promise<TenantInvitation> {
    return this.request<ApiResponse<TenantInvitation>>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/invitations`,
      { method: "POST", body: JSON.stringify({ email, role_ids: roleIds }) },
    ).then((response) => response.data)
  }

  /** Sends a fresh link; the previous one stops working. */
  async resendOrganizationInvitation(organizationUuid: string, invitationUuid: string): Promise<TenantInvitation> {
    return this.request<ApiResponse<TenantInvitation>>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/invitations/${encodeURIComponent(invitationUuid)}/resend`,
      { method: "POST" },
    ).then((response) => response.data)
  }

  async revokeOrganizationInvitation(organizationUuid: string, invitationUuid: string): Promise<void> {
    await this.request(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/invitations/${encodeURIComponent(invitationUuid)}`,
      { method: "DELETE" },
    )
  }

  async adminOrganizationPermissions(organizationUuid: string): Promise<OrganizationPermissionCeiling> {
    return this.request<ApiResponse<OrganizationPermissionCeiling>>(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationUuid)}/permissions`,
    ).then((response) => response.data)
  }

  /** Narrowing removes the dropped permissions from every role in the organization. */
  async updateAdminOrganizationPermissions(
    organizationUuid: string,
    values: { restricted: boolean; permission_names: string[] },
  ): Promise<OrganizationPermissionCeiling> {
    return this.request<ApiResponse<OrganizationPermissionCeiling>>(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationUuid)}/permissions`,
      { method: "PUT", body: JSON.stringify(values) },
    ).then((response) => response.data)
  }

  async syncOrganizationMemberRoles(
    organizationUuid: string,
    userId: number,
    roleIds: number[],
  ): Promise<OrganizationMember> {
    return this.request<ApiResponse<OrganizationMember>>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/members/${userId}`,
      { method: "PUT", body: JSON.stringify({ role_ids: roleIds }) },
    ).then((response) => response.data)
  }

  async removeOrganizationMember(organizationUuid: string, userId: number): Promise<void> {
    await this.request(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/members/${userId}`,
      { method: "DELETE" },
    )
  }

  async adminUsers(
    query: DirectoryQuery = {},
  ): Promise<PaginatedResponse<PlatformUser>> {
    return this.request<PaginatedResponse<PlatformUser>>(
      `/api/v1/admin/users${directoryQuery(query)}`,
    )
  }

  async adminRoles(
    query: DirectoryQuery = {},
  ): Promise<PaginatedResponse<OrganizationRole>> {
    return this.request<PaginatedResponse<OrganizationRole>>(
      `/api/v1/admin/roles${directoryQuery(query)}`,
    )
  }

  async adminOrganizationRoles(
    organizationUuid: string,
  ): Promise<OrganizationRole[]> {
    return this.request<ApiResponse<OrganizationRole[]>>(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationUuid)}/roles`,
    ).then((response) => response.data)
  }

  async adminInvitations(
    query: DirectoryQuery = {},
  ): Promise<PaginatedResponse<OrganizationInvitation>> {
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
    await this.request(
      `/api/v1/admin/invitations/${encodeURIComponent(invitationUuid)}`,
      {
        method: "DELETE",
      },
    )
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
    return this.request<ApiResponse<OrganizationRoleDetail>>(
      `/api/v1/admin/roles/${id}`,
    ).then((response) => response.data)
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

  /** Base URL of the machine API that application tokens call. */
  integrationApiUrl() { return `${this.baseUrl}/api/integration/v1` }
  private applicationPath(org: string, id = "") {
    return `/api/v1/organizations/${encodeURIComponent(org)}/applications${id ? "/" + encodeURIComponent(id) : ""}`
  }
  integrationApplications(org: string) { return this.data<IntegrationApplication[]>(this.applicationPath(org)) }
  createIntegrationApplication(org: string, input: IntegrationGrants) {
    return this.data<IntegrationApplication>(this.applicationPath(org), "POST", input)
  }
  updateIntegrationApplication(org: string, id: string, input: IntegrationGrants & { revision: number }) {
    return this.data<IntegrationApplication>(this.applicationPath(org, id), "PUT", input)
  }
  issueIntegrationToken(org: string, id: string, input: { revision: number; abilities: IntegrationAbility[]; expires_in_days: number }) {
    return this.data<{application: IntegrationApplication; token: string; expires_at: string}>(this.applicationPath(org,id) + "/token", "POST", input)
  }
  revokeIntegrationApplication(org: string, id: string, revision: number) {
    return this.data<IntegrationApplication>(this.applicationPath(org,id) + "/revoke", "POST", {revision})
  }
  integrationWebhook(org: string, id: string) { return this.data<IntegrationWebhook | null>(this.applicationPath(org,id) + "/webhook") }
  configureIntegrationWebhook(org: string, id: string, input: {revision: number; url: string}) {
    return this.data<IntegrationWebhook & {signing_secret: string}>(this.applicationPath(org,id) + "/webhook", "PUT", input)
  }
  disableIntegrationWebhook(org: string, id: string, revision: number) {
    return this.data<IntegrationWebhook>(this.applicationPath(org,id) + "/webhook/disable", "POST", {revision})
  }
  integrationDeliveries(org: string, id: string, page = 1) {
    return this.request<{data: IntegrationDelivery[]; meta: {current_page: number; last_page: number; total: number}}>(this.applicationPath(org,id) + "/webhook/deliveries?page=" + page)
  }
  retryIntegrationDelivery(org: string, id: string, delivery: string, revision: number) {
    return this.data<{status: string}>(this.applicationPath(org,id) + "/webhook/deliveries/" + encodeURIComponent(delivery) + "/retry", "POST", {retry_revision: revision})
  }
  async devices(
    org: string,
    query: {
      search?: string
      lifecycle?: string
      /** Devices whose applied (or last applied) configuration uses this profile. */
      profile_uuid?: string
      site_uuid?: string
      tag?: string
      page?: number
      per_page?: number
    } = {},
  ) {
    const search = new URLSearchParams(
      Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => [key, String(value)]),
    )
    return this.request<{
      data: Device[]
      meta: { current_page: number; last_page: number; total: number }
    }>(`/api/v1/organizations/${encodeURIComponent(org)}/devices?${search}`)
  }
  /** Canonical units grouped by quantity; custom units remain allowed. */
  units() {
    return this.data<UnitCatalogue>("/api/v1/units")
  }
  telemetryCaptures(org: string) {
    return this.data<import("./telemetry").TelemetryCapture[]>(`/api/v1/organizations/${encodeURIComponent(org)}/telemetry-captures`)
  }
  startTelemetryCapture(org: string, input: { gateway_uuid: string; device_uuid?: string; duration_seconds: number }) {
    return this.data<import("./telemetry").TelemetryCapture>(`/api/v1/organizations/${encodeURIComponent(org)}/telemetry-captures`, "POST", input)
  }
  telemetryCapture(org: string, id: string) {
    return this.data<import("./telemetry").TelemetryCapture>(`/api/v1/organizations/${encodeURIComponent(org)}/telemetry-captures/${encodeURIComponent(id)}`)
  }
  changeTelemetryCapture(org: string, id: string, action: "stop" | "delete" | "suspend" | "resume", confirm?: boolean) {
    return this.request<{ok: boolean}>(`/api/v1/organizations/${encodeURIComponent(org)}/telemetry-captures/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({action, ...(confirm ? {confirm} : {})}) })
  }
  diagnoseTelemetry(org: string, id: string, question: string, sample_ids: string[]) {
    return this.data<import("./telemetry").TelemetryDiagnosis>(`/api/v1/organizations/${encodeURIComponent(org)}/telemetry-captures/${encodeURIComponent(id)}/diagnose`, "POST", {question, sample_ids})
  }
  private devicePath(org: string, id = "") {
    return `/api/v1/organizations/${encodeURIComponent(org)}/devices${id ? "/" + encodeURIComponent(id) : ""}`
  }
  private async data<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    return (
      await this.request<ApiResponse<T>>(path, {
        method,
        signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    ).data
  }
  device(org: string, id: string, signal?: AbortSignal) {
    return this.data<DeviceDetail>(this.devicePath(org, id), "GET", undefined, signal)
  }
  createDevice(org: string, values: DeviceInput) {
    return this.data<DeviceDetail>(this.devicePath(org), "POST", values)
  }
  startDeviceOnboarding(org: string, values: import('./onboarding').OnboardingInput) {
    return this.data<import('./onboarding').DeviceOnboarding>(`/api/v1/organizations/${encodeURIComponent(org)}/device-onboardings`, 'POST', values)
  }
  deviceOnboarding(org: string, id: string) {
    return this.data<import('./onboarding').DeviceOnboarding | null>(this.devicePath(org, id) + '/onboarding')
  }
  provisionDeviceOnboarding(org: string, id: string) {
    return this.data<import('./onboarding').DeviceOnboarding>(this.devicePath(org, id) + '/onboarding/provision', 'POST')
  }
  deviceConnectionKit(org: string, id: string) {
    return this.data<import('./onboarding').DeviceConnectionKit>(this.devicePath(org, id) + '/connection-kit', 'POST')
  }
  deviceConnectionKitArchiveUrl(org: string, id: string) {
    return this.baseUrl + this.devicePath(org, id) + '/connection-kit/archive'
  }
  sites(org: string) {
    return this.request<{ data: Site[]; organization_timezone: string | null }>(
      `/api/v1/organizations/${encodeURIComponent(org)}/sites`,
    )
  }
  createSite(org: string, values: SiteInput) {
    return this.data<Site>(`/api/v1/organizations/${encodeURIComponent(org)}/sites`, "POST", values)
  }
  updateSite(org: string, site: string, values: Partial<SiteInput>) {
    return this.data<Site>(`/api/v1/organizations/${encodeURIComponent(org)}/sites/${encodeURIComponent(site)}`, "PATCH", values)
  }
  deleteSite(org: string, site: string) {
    return this.request<null>(`/api/v1/organizations/${encodeURIComponent(org)}/sites/${encodeURIComponent(site)}`, { method: "DELETE" })
  }
  /** The organization's zone applies to devices without a site; null means UTC. */
  setOrganizationTimezone(org: string, timezone: string | null) {
    return this.data<{ timezone: string | null }>(`/api/v1/organizations/${encodeURIComponent(org)}/settings/timezone`, "PUT", { timezone })
  }
  updateDevice(
    org: string,
    id: string,
    values: DeviceInput & { draft_revision: number },
  ) {
    return this.data<DeviceDetail>(this.devicePath(org, id), "PATCH", values)
  }
  saveDeviceConfiguration(
    org: string,
    id: string,
    values: DeviceDraft & { draft_revision: number },
  ) {
    return this.data<DeviceDetail>(
      this.devicePath(org, id) + "/configuration",
      "PUT",
      values,
    )
  }
  validateDevice(org: string, id: string, revision: number) {
    return this.data<DeviceValidation>(
      this.devicePath(org, id) + "/validate",
      "POST",
      { draft_revision: revision },
    )
  }
  deviceLifecycle(
    org: string,
    id: string,
    input: import("./devices").DeviceLifecycleRequest,
  ) {
    return this.request<import("./devices").DeviceOperationResponse>(
      this.devicePath(org, id) + "/lifecycle",
      { method: "POST", body: JSON.stringify(input) },
    )
  }
  deviceOperation(org: string, id: string, operation: string) {
    return this.request<import("./devices").DeviceOperationResponse>(
      this.devicePath(org, id) + "/operations/" + encodeURIComponent(operation),
    )
  }
  deviceAction(
    org: string,
    id: string,
    action: "activate" | "deactivate" | "archive",
    revision: number,
    rollback?: string,
  ) {
    return this.data<DeviceDetail>(
      this.devicePath(org, id) + "/" + action,
      "POST",
      { draft_revision: revision, rollback_configuration_uuid: rollback },
    )
  }
  deviceLatest(org: string, id: string, signal?: AbortSignal) {
    return this.request<{
      data: Measurement[]
      presence: string
      configuration_uuid?: string
    }>(this.devicePath(org, id) + "/measurements/latest", { signal })
  }

  dashboards(org: string) {
    return this.data<Dashboard[]>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards`)
  }

  dashboard(org: string, dashboard: string) {
    return this.data<Dashboard>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards/${encodeURIComponent(dashboard)}`)
  }

  createDashboard(org: string, values: DashboardInput) {
    return this.data<Dashboard>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards`, "POST", values)
  }

  updateDashboard(org: string, dashboard: string, values: DashboardInput & { revision: number }) {
    return this.data<Dashboard>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards/${encodeURIComponent(dashboard)}`, "PUT", values)
  }

  deleteDashboard(org: string, dashboard: string) {
    return this.request<null>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards/${encodeURIComponent(dashboard)}`, { method: "DELETE" })
  }

  starDashboard(org: string, dashboard: string, starred: boolean) {
    return this.data<Dashboard>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards/${encodeURIComponent(dashboard)}/star`, "PUT", { starred })
  }

  duplicateDashboard(org: string, dashboard: string, name: string) {
    return this.data<Dashboard>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards/${encodeURIComponent(dashboard)}/duplicate`, "POST", { name })
  }

  dashboardRevisions(org: string, dashboard: string) {
    return this.data<DashboardRevisionSummary[]>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards/${encodeURIComponent(dashboard)}/revisions`)
  }

  dashboardRevision(org: string, dashboard: string, revision: number) {
    return this.data<DashboardRevision>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards/${encodeURIComponent(dashboard)}/revisions/${revision}`)
  }

  /** Writes a stored snapshot as a new revision; 409 when `current` is stale. */
  restoreDashboardRevision(org: string, dashboard: string, revision: number, current: number) {
    return this.data<Dashboard>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards/${encodeURIComponent(dashboard)}/revisions/${revision}/restore`, "POST", { revision: current })
  }
  deviceHistory(
    org: string,
    id: string,
    query: {
      parameter_uuid: string
      from: string
      to: string
      max_points?: number
    },
    signal?: AbortSignal,
  ) {
    const search = new URLSearchParams(
      Object.entries(query).map(([key, value]) => [key, String(value)]),
    )
    return this.data<HistorySeries[]>(
      this.devicePath(org, id) + "/measurements/history?" + search,
      "GET", undefined, signal,
    )
  }
  deviceHistoryRecords(
    org: string,
    id: string,
    query: {
      parameter_uuid: string
      from: string
      to: string
      limit?: number
      page_size?: number
      cursor?: string
    },
    signal?: AbortSignal,
  ) {
    const search = new URLSearchParams(
      Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => [key, String(value)]),
    )
    return this.request<HistoryRecordsPage>(
      this.devicePath(org, id) + "/measurements/records?" + search,
      { signal },
    )
  }
  deviceStateHistory(
    org: string,
    id: string,
    query: {
      parameter_uuid: string
      from: string
      to: string
      max_points?: number
    },
    signal?: AbortSignal,
  ) {
    const search = new URLSearchParams(
      Object.entries(query).map(([key, value]) => [key, String(value)]),
    )
    return this.data<StateHistory>(
      this.devicePath(org, id) + "/measurements/state-history?" + search,
      "GET", undefined, signal,
    )
  }
  deviceCounterIncrease(
    org: string,
    id: string,
    query: {
      parameter_uuid: string
      from: string
      to: string
      bucket: CounterBucket
      timezone: string
    },
    signal?: AbortSignal,
  ) {
    const search = new URLSearchParams(query)
    return this.data<CounterIncrease>(
      this.devicePath(org, id) + "/measurements/increase?" + search,
      "GET", undefined, signal,
    )
  }
  deviceCommands(org: string, id: string, signal?: AbortSignal) {
    return this.data<DeviceCommand[]>(this.devicePath(org, id) + "/commands", "GET", undefined, signal)
  }
  prepareDeviceCommand(
    org: string,
    id: string,
    values: {
      configuration_uuid: string
      parameter_uuid: string
      value: unknown
      idempotency_key: string
    },
  ) {
    return this.data<DeviceCommand>(
      this.devicePath(org, id) + "/commands",
      "POST",
      values,
    )
  }
  sendDeviceCommand(
    org: string,
    id: string,
    values: {
      configuration_uuid: string
      parameter_uuid: string
      value: unknown
      idempotency_key: string
    },
  ) {
    return this.data<DeviceCommand>(
      this.devicePath(org, id) + "/commands/send",
      "POST",
      values,
    )
  }
  confirmDeviceCommand(org: string, id: string, command: string) {
    return this.data<DeviceCommand>(
      this.devicePath(org, id) +
        `/commands/${encodeURIComponent(command)}/confirm`,
      "POST",
      { confirmed: true },
    )
  }
  cancelDeviceCommand(org: string, id: string, command: string) {
    return this.data<DeviceCommand>(
      this.devicePath(org, id) +
        `/commands/${encodeURIComponent(command)}/cancel`,
      "POST",
      {},
    )
  }
  private sourceDirectory<T>(
    org: string,
    resource: string,
    query: import("./devices").DeviceDirectoryQuery = {},
  ) {
    const search = new URLSearchParams(
      Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => [key, String(value)]),
    )
    return this.request<{
      data: T[]
      meta: import("./devices").DeviceDirectoryMeta
    }>(`/api/v1/organizations/${encodeURIComponent(org)}/${resource}?${search}`)
  }
  connectionsPage(
    org: string,
    query: import("./devices").DeviceDirectoryQuery = {},
  ) {
    return this.sourceDirectory<SparkplugConnection>(
      org,
      "sparkplug-connections",
      query,
    )
  }
  gatewaysPage(
    org: string,
    query: import("./devices").DeviceDirectoryQuery = {},
  ) {
    return this.sourceDirectory<Gateway>(org, "gateways", query)
  }
  discoveryPage(
    org: string,
    query: import("./devices").DeviceDirectoryQuery = {},
  ) {
    return this.sourceDirectory<DiscoveryCandidate>(
      org,
      "discovery-candidates",
      query,
    )
  }
  discoveryCandidate(org: string, uuid: string) {
    return this.data<DiscoveryCandidate>(
      `/api/v1/organizations/${encodeURIComponent(org)}/discovery-candidates/${encodeURIComponent(uuid)}`,
    )
  }
  deviceMappingSuggestions(org: string, id: string, artifact: string) {
    return this.data<
      Array<{
        binding_uuid: string
        name: string
        mappings: import("./devices").DeviceMapping[]
      }>
    >(
      this.devicePath(org, id) +
        "/mapping-suggestions?artifact_uuid=" +
        encodeURIComponent(artifact),
    )
  }
  async connections(
    org: string,
    query: import("./devices").DeviceDirectoryQuery = {},
  ) {
    return (await this.connectionsPage(org, query)).data
  }
  createConnection(org: string, values: { name: string; group_id: string }) {
    return this.data<SparkplugConnection>(
      `/api/v1/organizations/${encodeURIComponent(org)}/sparkplug-connections`,
      "POST",
      values,
    )
  }
  provisionConnection(org: string, id: string) {
    return this.data<SparkplugConnection>(
      `/api/v1/organizations/${encodeURIComponent(org)}/sparkplug-connections/${encodeURIComponent(id)}/provision`,
      "POST",
      {},
    )
  }
  provisionGateway(org: string, id: string) {
    return this.data<Gateway>(
      `/api/v1/organizations/${encodeURIComponent(org)}/gateways/${encodeURIComponent(id)}/provision`,
      "POST",
      {},
    )
  }
  async gateways(
    org: string,
    query: import("./devices").DeviceDirectoryQuery = {},
  ) {
    return (await this.gatewaysPage(org, query)).data
  }
  createGateway(
    org: string,
    values: { connection_uuid: string; name: string; edge_node_id: string },
  ) {
    return this.data<Gateway>(
      `/api/v1/organizations/${encodeURIComponent(org)}/gateways`,
      "POST",
      values,
    )
  }
  async discoveryCandidates(
    org: string,
    query: import("./devices").DeviceDirectoryQuery = {},
  ) {
    return (await this.discoveryPage(org, query)).data
  }
  reviewCandidate(
    org: string,
    id: string,
    status: "pending" | "rejected",
    birth_revision: number,
  ) {
    return this.data<DiscoveryCandidate>(
      `/api/v1/organizations/${encodeURIComponent(org)}/discovery-candidates/${encodeURIComponent(id)}`,
      "PATCH",
      { status, birth_revision },
    )
  }
  private retentionPath(org?: string) {
    return (
      "/api/v1/admin/" +
      (org ? `organizations/${encodeURIComponent(org)}/` : "") +
      "settings/telemetry-retention"
    )
  }
  retention(org?: string) {
    return this.data<RetentionSetting>(this.retentionPath(org))
  }
  updateRetention(
    values: {
      days: number | null
      revision: number
      confirmed_reduction?: boolean
    },
    org?: string,
  ) {
    return this.data<RetentionSetting>(this.retentionPath(org), "PUT", values)
  }

  private adapterPath(org: string, id?: string, suffix = "") {
    return `/api/v1/organizations/${encodeURIComponent(org)}/device-adapters${id ? "/" + encodeURIComponent(id) : ""}${suffix}`
  }
  deviceAdapters(org: string) { return this.request<import("./adapters").AdapterDirectory>(this.adapterPath(org)) }
  adapterProfiles(org: string) { return this.data<import("./adapters").AdapterProfile[]>(`/api/v1/organizations/${encodeURIComponent(org)}/device-adapter-profiles`) }
  deviceAdapter(org: string, id: string) { return this.data<import("./adapters").DeviceAdapter>(this.adapterPath(org,id)) }
  createDeviceAdapter(org: string, input: import("./adapters").AdapterDraft & {request_uuid: string}) { return this.data<import("./adapters").DeviceAdapter>(this.adapterPath(org), "POST", input) }
  saveDeviceAdapter(org: string, id: string, input: import("./adapters").AdapterDraft & {draft_revision: number}) { return this.data<import("./adapters").DeviceAdapter>(this.adapterPath(org,id), "PUT", input) }
  testDeviceAdapter(org: string, id: string, draft_revision: number) { return this.data<import("./adapters").AdapterTest>(this.adapterPath(org,id,"/test"), "POST", {draft_revision}) }
  testAdapterConnection(org: string, id: string) { return this.data<{connected: boolean; broker_url?: string}>(this.adapterPath(org,id,"/connection-test"), "POST", {}) }
  deployDeviceAdapter(org: string, id: string, input: {draft_revision: number; action: "deploy" | "pause" | "rollback"; revision_uuid?: string; request_uuid: string}) { return this.data<{uuid: string; status: string}>(this.adapterPath(org,id,"/deploy"), "POST", input) }
  adapterCandidates(org: string, id: string) { return this.data<import("./adapters").AdapterCandidate[]>(this.adapterPath(org,id,"/candidates")) }
  activateAdapterCandidate(org: string,id: string,candidate: string,input: {name: string;device_uuid?: string}) { return this.data<{installation_uuid: string;device: Device}>(this.adapterPath(org,id,`/candidates/${encodeURIComponent(candidate)}/activate`), "POST", input) }
  adapterCredentials(org: string,id: string) { return this.data<import("./adapters").AdapterCredential[]>(this.adapterPath(org,id,"/credentials")) }
  createAdapterCredential(org: string,id: string,name: string) { return this.data<import("./adapters").AdapterKit>(this.adapterPath(org,id,"/credentials"), "POST", {name}) }
  adapterConnectionKit(org: string,id: string,credential: string,action: "kit" | "rotate" = "kit") { return this.data<import("./adapters").AdapterKit>(this.adapterPath(org,id,`/credentials/${encodeURIComponent(credential)}/${action}`), "POST", {}) }
  revokeAdapterCredential(org: string,id: string,credential: string) { return this.data<{revoked: boolean}>(this.adapterPath(org,id,`/credentials/${encodeURIComponent(credential)}/revoke`), "POST", {}) }
  adapterProposals(org: string,id: string) { return this.data<import("./adapters").AdapterProposal[]>(this.adapterPath(org,id,"/proposals")) }
  decideAdapterProposal(org: string,id: string,proposal: string,action: "apply" | "reject",content_hash: string) { return this.data<import("./adapters").DeviceAdapter | {status: string}>(this.adapterPath(org,id,`/proposals/${encodeURIComponent(proposal)}/decision`), "POST", {action,content_hash}) }
  adapterAssistantSettings(org: string) { return this.data<{enabled: boolean}>(this.assistantPath(org,undefined,"/settings?scope=adapter")) }
  adapterAssistantConversations(org: string, adapter_uuid: string) { return this.data<{id: string; adapter_uuid: string}[]>(this.assistantPath(org,undefined,`/conversations?scope=adapter&adapter_uuid=${encodeURIComponent(adapter_uuid)}`)) }
  createAdapterConversation(org: string,adapter_uuid: string) { return this.data<{id: string}>(this.assistantPath(org,undefined,"/conversations"),"POST",{scope:"adapter",adapter_uuid}) }

  private assistantPath(org: string, conversation?: string, suffix = "") {
    return `/api/v1/organizations/${encodeURIComponent(org)}/assistant${conversation ? `/conversations/${encodeURIComponent(conversation)}` : ""}${suffix}`
  }
  helpPage(org: string, context: string) {
    return this.data<import("./help").HelpPage>(`/api/v1/organizations/${encodeURIComponent(org)}/help/page?context=${encodeURIComponent(context)}`)
  }
  helpArticles(org: string, query = "") {
    return this.data<import("./help").HelpArticleSummary[]>(`/api/v1/organizations/${encodeURIComponent(org)}/help/articles?query=${encodeURIComponent(query)}`)
  }
  helpArticle(org: string, slug: string) {
    return this.data<import("./help").HelpArticle>(`/api/v1/organizations/${encodeURIComponent(org)}/help/articles/${encodeURIComponent(slug)}`)
  }
  helpSettings(org: string) {
    return this.data<{ enabled: boolean }>(this.assistantPath(org, undefined, "/settings?scope=help"))
  }
  helpConversations(org: string) {
    return this.data<import("./help").HelpConversation[]>(this.assistantPath(org, undefined, "/conversations?scope=help"))
  }
  createHelpConversation(org: string) {
    return this.data<import("./help").HelpConversation>(this.assistantPath(org, undefined, "/conversations"), "POST", { scope: "help" })
  }
  helpConversation(org: string, id: string) {
    return this.data<import("./help").HelpDetail>(this.assistantPath(org, id))
  }
  helpMessage(org: string, id: string, input: { request_id: string; text: string; page_context: string }) {
    return this.data<import("./help").HelpRun>(this.assistantPath(org, id, "/messages"), "POST", input)
  }
  assistantSettings(org: string) {
    return this.data<import("./assistant").AssistantSettings>(
      this.assistantPath(org, undefined, "/settings"),
    )
  }
  workflowAssistantSettings(org: string) {
    return this.data<{ enabled: boolean }>(this.assistantPath(org, undefined, "/settings?scope=automation"))
  }
  createWorkflowAssistantConversation(org: string, workflow_uuid?: string) {
    return this.data<{ id: string }>(this.assistantPath(org, undefined, "/conversations"), "POST", { scope: "automation", workflow_uuid })
  }
  workflowAssistantDetail<T>(org: string, id: string) {
    return this.data<T>(this.assistantPath(org, id))
  }
  workflowAssistantConversations(org: string) {
    return this.data<{ id: string; title: string; workflow_uuid: string | null }[]>(this.assistantPath(org, undefined, "/conversations?scope=automation"))
  }
  workflowAssistantMessage(org: string, id: string, input: {
    request_id: string; text: string; execution_id?: string;
    target: { name: string; workflow: unknown; draft_revision?: number };
  }) {
    return this.data<import("./assistant").AssistantRun>(this.assistantPath(org, id, "/messages"), "POST", input)
  }
  assistantConversations(org: string) {
    return this.data<import("./assistant").AssistantConversation[]>(
      this.assistantPath(org, undefined, "/conversations"),
    )
  }
  createAssistantConversation(org: string, profile_uuid?: string) {
    return this.data<import("./assistant").AssistantConversation>(
      this.assistantPath(org, undefined, "/conversations"),
      "POST",
      { profile_uuid },
    )
  }
  assistantConversation(org: string, id: string) {
    return this.data<import("./assistant").AssistantDetail>(
      this.assistantPath(org, id),
    )
  }
  deleteAssistantConversation(org: string, id: string) {
    return this.request<null>(this.assistantPath(org, id), {
      method: "DELETE",
    })
  }
  assistantEvents(org: string, id: string, after: number) {
    return this.data<{
      events: import("./assistant").AssistantEvent[]
      active: boolean
    }>(this.assistantPath(org, id, `/events?after=${after}`))
  }
  assistantMessage(
    org: string,
    id: string,
    input: {
      request_id: string
      text: string
      source_ids?: string[]
      answers?: import("./assistant").AssistantAnswer[]
    },
  ) {
    return this.data<import("./assistant").AssistantRun>(
      this.assistantPath(org, id, "/messages"),
      "POST",
      input,
    )
  }
  assistantPreview(
    org: string,
    id: string,
    input: import("./assistant").AssistantPreviewInput,
  ) {
    return this.data<import("./assistant").AssistantProposal>(
      this.assistantPath(org, id, "/proposals"),
      "POST",
      input,
    )
  }
  assistantDecision(
    org: string,
    id: string,
    proposal: string,
    input: {
      decision: "approve" | "reject"
      content_hash: string
      request_id: string
    },
  ) {
    return this.data<{
      result: import("./assistant").AssistantSaved | null
      run: import("./assistant").AssistantRun | null
      notice: string | null
    }>(
      this.assistantPath(
        org,
        id,
        `/proposals/${encodeURIComponent(proposal)}/decision`,
      ),
      "POST",
      input,
    )
  }
  assistantCancel(org: string, id: string, run: string) {
    return this.data<import("./assistant").AssistantRun>(
      this.assistantPath(org, id, `/runs/${encodeURIComponent(run)}/cancel`),
      "POST",
      {},
    )
  }
  async assistantUpload(org: string, id: string, file: File) {
    const body = new FormData()
    body.append("file", file)
    return (
      await this.request<ApiResponse<import("./assistant").AssistantSource>>(
        this.assistantPath(org, id, "/sources"),
        { method: "POST", body },
      )
    ).data
  }
  assistantSourceUrl(org: string, id: string, source: string) {
    return `${this.baseUrl}${this.assistantPath(org, id, `/sources/${encodeURIComponent(source)}`)}`
  }

  alerts(org: string, query: string, signal?: AbortSignal) {
    return this.request<import("./alerts").AlertPage<import("./alerts").WorkflowAlert>>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts?${query}`, { signal })
  }
  alert(org: string, id: string) {
    return this.data<import("./alerts").WorkflowAlert>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(id)}`)
  }
  acknowledgeAlert(org: string, id: string) {
    return this.data<import("./alerts").WorkflowAlert>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(id)}/acknowledge`, "POST", {})
  }
  /** `query` takes the alerts filters; `group=source` is added. */
  alertSources(org: string, query: string, signal?: AbortSignal) {
    const params = new URLSearchParams(query)
    params.set("group", "source")
    return this.request<import("./alerts").AlertPage<import("./alerts").WorkflowAlertSource>>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts?${params}`, { signal })
  }
  /** Already acknowledged alerts are skipped; resolves to the number newly acknowledged. */
  acknowledgeAlerts(org: string, input: import("./alerts").AlertAcknowledgement) {
    return this.data<{ acknowledged: number }>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/acknowledge`, "POST", input)
  }
  /** `null` unassigns. The user must be an organization member (integer user id). */
  assignAlert(org: string, id: string, userId: number | null) {
    return this.data<import("./alerts").WorkflowAlert>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(id)}/assignee`, "PUT", { user_id: userId })
  }
  alertComments(org: string, id: string, page: number) {
    return this.request<import("./alerts").AlertPage<import("./alerts").AlertComment>>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(id)}/comments?page=${page}`)
  }
  addAlertComment(org: string, id: string, comment: { uuid: string; body: string }) {
    return this.data<{ uuid: string; body: string }>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(id)}/comments`, "POST", comment)
  }
  alertDeliveries(org: string, id: string) {
    return this.request<{ data: import("./alerts").AlertDelivery[] }>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(id)}/deliveries`)
  }

  dashboardWorkflows(org: string, search: string, page: number) {
    return this.request<{data: {uuid: string; name: string}[]; meta: {current_page: number; last_page: number; total: number}}>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows?${new URLSearchParams({search,page:String(page)})}`)
  }
  workflowLocationOverview(org: string, id: string, signal?: AbortSignal) {
    return this.data<import("./dashboards").WorkflowLocationOverview>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows/${encodeURIComponent(id)}/location-overview`, "GET", undefined, signal)
  }
  workflowAlertOverview(org: string, id: string, signal?: AbortSignal) {
    return this.data<import("./dashboards").WorkflowAlertOverview>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows/${encodeURIComponent(id)}/alert-overview`, "GET", undefined, signal)
  }
  locationBindings(org: string) {
    return this.request<{ data: import("./geospatial").LocationBinding[] }>(`/api/v1/organizations/${encodeURIComponent(org)}/location-bindings`)
  }
  locationMap(org: string, input: { device_uuids: string[]; trail_window: import("./geospatial").TrailWindow; include_trails: boolean; geofence_uuid?: string | null }, signal?: AbortSignal) {
    return this.data<import("./geospatial").LocationMapSnapshot>(`/api/v1/organizations/${encodeURIComponent(org)}/location-map/query`, "POST", input, signal)
  }
  geofences(org: string, search = "", page = 1) {
    const query = new URLSearchParams({ page: String(page) })
    if (search.trim()) query.set("search", search.trim())
    return this.request<{ data: import("./geospatial").Geofence[]; meta: { current_page: number; last_page: number; total: number } }>(`/api/v1/organizations/${encodeURIComponent(org)}/geofences?${query}`)
  }
  geofence(org: string, id: string) {
    return this.data<import("./geospatial").Geofence>(`/api/v1/organizations/${encodeURIComponent(org)}/geofences/${encodeURIComponent(id)}`)
  }
  createGeofence(org: string, input: import("./geospatial").GeofenceInput) {
    return this.request<{ data: import("./geospatial").Geofence; activation: import("./geospatial").GeofenceActivationBatch }>(`/api/v1/organizations/${encodeURIComponent(org)}/geofences`, { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } })
  }
  updateGeofence(org: string, id: string, input: import("./geospatial").GeofenceInput) {
    return this.request<{ data: import("./geospatial").Geofence; activation: import("./geospatial").GeofenceActivationBatch }>(`/api/v1/organizations/${encodeURIComponent(org)}/geofences/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } })
  }
  geofenceActivation(org: string, fence: string, batch: string) {
    return this.data<import("./geospatial").GeofenceActivationBatch>(`/api/v1/organizations/${encodeURIComponent(org)}/geofences/${encodeURIComponent(fence)}/activations/${encodeURIComponent(batch)}`)
  }
  geofenceEvents(org: string, fence: string, page = 1) {
    return this.request<{ data: import("./geospatial").GeofenceEvent[]; meta: { current_page: number; last_page: number; total: number } }>(`/api/v1/organizations/${encodeURIComponent(org)}/geofences/${encodeURIComponent(fence)}/events?page=${page}`)
  }
  retryGeofenceActivation(org: string, fence: string, batch: string, item: number) {
    return this.data<import("./geospatial").GeofenceActivationBatch>(`/api/v1/organizations/${encodeURIComponent(org)}/geofences/${encodeURIComponent(fence)}/activations/${encodeURIComponent(batch)}/items/${item}/retry`, "POST", {})
  }
  notificationWorkflows(org: string, page: number) {
    return this.request<import("./alerts").AlertPage<import("./alerts").AutomationWorkflow>>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows?page=${page}`)
  }
  automation<T>(org: string, path: string, method = "GET", input?: unknown) {
    return this.request<T>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows${path}`, { method, ...(input === undefined ? {} : { body: JSON.stringify(input) }) })
  }
  workflow(org: string, id: string) {
    return this.data<import("./alerts").AutomationWorkflow>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows/${encodeURIComponent(id)}`)
  }
  /** Activate or disable; 202 is a request, poll workflowDeployment until the operation settles. */
  deployWorkflow(org: string, id: string, input: import("./alerts").WorkflowDeploymentInput) {
    return this.request<{ data: import("./alerts").AutomationWorkflow; deployment: import("./alerts").WorkflowDeployment }>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows/${encodeURIComponent(id)}/deployments`, { method: "POST", body: JSON.stringify(input) })
  }
  workflowDeployment(org: string, id: string, operation: string) {
    return this.request<{ data: import("./alerts").AutomationWorkflow; deployment: import("./alerts").WorkflowDeployment }>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows/${encodeURIComponent(id)}/deployments/${encodeURIComponent(operation)}`)
  }
  workflowNotifications(org: string, workflow: string) {
    return this.data<import("./alerts").NotificationSettings>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows/${encodeURIComponent(workflow)}/notifications`)
  }
  saveWorkflowNotifications(org: string, workflow: string, settings: import("./alerts").NotificationSettings) {
    return this.data<import("./alerts").NotificationSettings>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows/${encodeURIComponent(workflow)}/notifications`, "PUT", settings)
  }
  notificationRecipients(org: string, workflow: string, search: string, page: number) {
    return this.request<{ data: import("./alerts").NotificationRecipient[]; meta: { current_page: number; last_page: number } }>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows/${encodeURIComponent(workflow)}/notification-recipients?${new URLSearchParams({ search, page: String(page) })}`)
  }
  retryAlertDelivery(org: string, alert: string, delivery: string, generation: number) {
    return this.data<{ status: string }>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(alert)}/deliveries/${encodeURIComponent(delivery)}/retry`, "POST", { retry_generation: generation })
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set("Accept", "application/json")

    if (this.selectedOrganizationUuid) {
      headers.set("X-Organization-UUID", this.selectedOrganizationUuid)
    }

    if (
      !["GET", "HEAD", "OPTIONS"].includes((init.method ?? "GET").toUpperCase())
    ) {
      const token = readCookie("XSRF-TOKEN")

      if (token) {
        headers.set("X-XSRF-TOKEN", token)
      }
    }

    if (init.body && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json")
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers,
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      if (
        (response.status === 401 || response.status === 419) &&
        path !== "/api/v1/auth/login" &&
        path !== "/api/v1/me" &&
        typeof window !== "undefined"
      )
        window.dispatchEvent(new Event("iot-session-expired"))
      throw new ApiError(response.status, payload)
    }

    return payload as T
  }
}

export const apiClient = new ApiClient()

export type { DeviceOnboarding, OnboardingInput, DeviceConnectionKit } from './onboarding'

export { runtimeConfig, type RuntimeConfig } from "./runtime-config"
