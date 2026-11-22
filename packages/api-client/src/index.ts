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
  RetentionOrganization,
} from "./devices"

import type { Dashboard, DashboardInput, DashboardRevision, DashboardRevisionSummary } from "./dashboards"
import type { ActivityPage, ActivityQuery } from "./activity"
import type {
  AllowanceKind,
  BillingAccountDetail,
  BillingAccountOwner,
  BillingAccountSummary,
  BillingAccountValues,
  BillingPlan,
  BillingPlanDetail,
  BillingPlanValues,
  OrganizationRetention,
  OrganizationUsage,
  OwnedBillingAccount,
  OwnerOrganization,
  TrialFilter,
  TrialValues,
  Usage,
} from "./billing"
import type {
  BillingSettings,
  BillingSettingsValues,
  CreditNote,
  InvoiceDetail,
  InvoiceStatus,
  InvoiceSummary,
  PaymentStatus,
  PlanPriceValues,
  PriceKind,
  TaxRate,
  WaitingInvoice,
} from "./billing"
import { connection } from "./connection"
import type { OrganizationSecurity, PasskeyEndpoints, SecuritySettings, TwoStepAnswer, TwoStepMethod, TwoStepSetup } from "./security"
import type { SignUpConfig, SignUpConfirmation, SignUpInput, SignUpLinkProblem, SignUpQuery, SignUpRecord, SignUpSettings, SignUpSettingsValues, SignUpStatus } from "./sign-up"
export * from "./dashboards"
export * from "./archive"
export * from "./devices"
export * from "./deviceMoves"
export * from "./firmware"
export * from "./telemetry"
export * from "./alerts"
export * from "./connectivity"
export * from "./notifications"
export * from "./adapters"
export * from "./geospatial"
export * from "./overview"
export * from "./agents"
export * from "./support"
export * from "./billing"
export * from "./branding"
export * from "./activity"
export type * from "./security"
export type * from "./sign-up"

export type Organization = {
  uuid: string
  name: string
  slug: string
  users_count?: number
  /** Admin directory only; devices block deletion (spec 006). */
  devices_count?: number
  /** Admin directory and admin writes only; members never see it (spec 023). */
  billing_account?: { uuid: string; name: string }
  /** Organization context only: the portal on the main address of its billing account, for copied links (spec 036). Null without an address. */
  portal_url?: string | null
  /** Every member must use two-step sign-in (spec 034). Older payloads omit it. */
  two_step_required?: boolean
  /** The organization's own logos (spec 036). Older payloads omit them. */
  logo?: import("./branding").BrandImage | null
  logo_dark?: import("./branding").BrandImage | null
  /** What the portal shows for it: its own logo, else its billing account's brand. Older payloads omit it. */
  brand?: import("./branding").ResolvedBrand
  capabilities?: {
    manage_administration: boolean
    /** Member, invitation and role screens. Older payloads omit it. */
    administration?: AdministrationCapabilities
    device_profiles?: DeviceProfileCapabilities
    devices?: DeviceCapabilities
    /** Dashboard permissions of their own. Older payloads omit it. */
    dashboards?: import("./dashboards").DashboardCapabilities
    /** Automation permissions (Workflow.*). Older payloads omit it. */
    automation?: import("./alerts").AutomationCapabilities
    /** Optional platform features enabled for this organization. */
    features?: { device_adapters: boolean; agent_access?: boolean }
    /** AI agent access. Older payloads omit it. */
    agents?: import("./agents").AgentCapabilities
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
  /** Whether two-step sign-in is on (spec 034). */
  two_step_enabled: boolean
  /** How many passkeys the person has (spec 034); only the users list carries it. */
  passkey_count?: number
  platform_roles: PlatformRoleSummary[]
  organizations: Organization[]
}

/** A user as the platform-team update returns them: no organizations (spec 008). */
export type PlatformTeamMember = Omit<PlatformUser, "organizations" | "two_step_enabled" | "passkey_count">

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
  /** Whether the member has a second step set up (spec 034). Older payloads omit it. */
  two_step_enabled?: boolean
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

/** One open application telemetry stream, as platform administrators see it (spec 030). */
export interface IntegrationStreamSession {
  id: number
  application: { uuid: string; name: string }
  opened_at: string
  /** Refreshed every 30 s by the relay; a stream unseen for 90 s is no longer open. */
  last_seen_at: string
  device_count: number
  /** The last reading's position relayed, or null before the first one. */
  last_position: string | null
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
  /** A super-administrator invitation has no organization and no roles (spec 007). */
  grants_super_admin: boolean
  organization: Organization | null
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  status: "pending" | "accepted" | "revoked" | "expired"
}

export type InvitationDetails = {
  grants_super_admin: boolean
  /** Null for a super-administrator invitation. */
  organization: Pick<Organization, "uuid" | "name"> | null
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
  /** Two-step sign-in is required and not set up (spec 034): open setup. Older payloads omit it. */
  two_step_setup_required?: boolean
  capabilities: {
    platform_administration: boolean
    /** Organizations, users, roles, activity and the billing pages (`PlatformAdministration.manage-organizations`). */
    manage_organizations?: boolean
    manage_retention?: boolean
    /** Reset a locked-out person's two-step sign-in (`PlatformAdministration.reset-two-step`, spec 034). */
    reset_two_step?: boolean
    manage_assistant?: boolean
    /** Super administrators work the support ticket queue (spec 015). */
    manage_tickets?: boolean
    /** Super administrators open sign-up and choose how staff hear of it (spec 035). Older payloads omit it. */
    manage_sign_up?: boolean
    /** Owns at least one billing account (spec 023). Older payloads omit it. */
    billing_accounts?: boolean
  }
  organizations: Organization[]
  /** How many browsers the person has push on in at other portal addresses (spec 036). Older payloads omit it. */
  push_devices_elsewhere?: number
  /**
   * The billing account's portal address the request came from (spec 036), or null on
   * the platform's own. On an address `organizations` lists only that account's.
   * Older payloads omit it.
   */
  address?: { kind: "name" | "domain"; host: string } | null
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

/** One kind of data in an organization deletion check. */
export type OrganizationDeletionEntry = {
  key: string
  label: string
  count: number
}

/** Whether an organization can be deleted (spec 006); only entries with rows are listed. */
export type OrganizationDeletion = {
  organization: Pick<Organization, "uuid" | "name" | "slug">
  deletable: boolean
  blockers: OrganizationDeletionEntry[]
  removes: OrganizationDeletionEntry[]
}

/** A failed request: the HTTP status, or 0 when no response arrived (offline, or the API unreachable). */
/** Why a sign-up link failed: `410`/`409` carry a code; `404` is an unknown or replaced link. */
export function signUpLinkProblem(error: unknown): SignUpLinkProblem | "unknown" | null {
  if (!(error instanceof ApiError)) return null
  if (error.status === 404) return "unknown"
  const code = (error.payload as { code?: unknown } | null)?.code
  return code === "used" || code === "expired" || code === "account_exists" ? code : null
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    super("The API request failed.")
  }
}

/**
 * The password was right and a second step is due (spec 034): finish with
 * `twoStepChallenge` within `expiresIn` seconds. No session exists yet.
 */
export class TwoStepRequiredError extends ApiError {
  constructor(
    public readonly expiresIn: number,
    public readonly methods: TwoStepMethod[],
  ) {
    super(202, { two_step_required: true, expires_in: expiresIn, methods })
  }
}

/**
 * A security change needs the password confirmed again (spec 034, `423`): confirm it with
 * `confirmPassword` and retry the change.
 */
export class ConfirmationRequiredError extends ApiError {}

/**
 * Two-step sign-in is required for the signed-in person and not set up (spec 034, `403
 * two_step_setup_required`). Every such response also fires `iot-two-step-setup-required`
 * on `window`, so the app can open setup wherever the request came from.
 */
export class TwoStepSetupRequiredError extends ApiError {}

export const TWO_STEP_SETUP_REQUIRED_EVENT = "iot-two-step-setup-required"

/**
 * Fired when a signed-in request is refused with `403 not_available_here` (spec 036): the
 * person no longer belongs to any organization of the billing account whose portal
 * address this is. The portal reads the session again and shows the sign-in page.
 */
export const NOT_AVAILABLE_HERE_EVENT = "iot-not-available-here"

/** Whether an error is the API's `not_available_here` refusal, at sign-in (403) or for an organization (404). */
export function isNotAvailableHere(error: unknown): boolean {
  return error instanceof ApiError && (error.payload as { code?: unknown } | null)?.code === "not_available_here"
}

/**
 * The address has no account but a sign-up waiting for its email to be confirmed, and the
 * password was that sign-up's (spec 035, `403 sign_up_unconfirmed`). This browser can now
 * send the link again with `resendSignUp`.
 */
export class SignUpUnconfirmedError extends ApiError {}

/** Guest paths: a 401 or 419 on them means nothing about a session to restore. */
const isGuestPath = (path: string) => path === "/api/v1/auth/login" || path === "/api/v1/me" || path.startsWith("/api/v1/sign-up")

/** A wrong code, with how many tries the pending sign-in has left (spec 034). */
export type TwoStepRefusal = { message: string; errors: Record<string, string[]>; attempts_left?: number }

type ApiResponse<T> = {
  data: T
}

type LoginCredentials = {
  email: string
  password: string
  /** Keep me signed in: this browser stays signed in for 30 days (spec 033). */
  remember?: boolean
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

/** Adds one parameter to a query string from `directoryQuery`; an empty value adds nothing. */
function withParameter(query: string, name: string, value: string | undefined): string {
  if (!value) {
    return query
  }

  const parameters = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query)
  parameters.set(name, value)

  return `?${parameters.toString()}`
}

export type * from "./assistant"
export type * from "./help"
export type IntegrationAbility = "devices:read" | "alerts:read" | "events:read" | "telemetry:read" | "locations:read" | "geofences:read" | "geofences:manage" | "geofences:activate" | "entities:read" | "telemetry:stream"
export interface IntegrationApplication {
  uuid: string; name: string; abilities: IntegrationAbility[];
  /** A grant is a device list or a scope of sites, never both (spec 030): exactly one is non-empty. */
  device_uuids: string[]; site_uuids: string[];
  revision: number; grant_revision: number; revoked_at: string | null;
  devices: {uuid: string; name: string; code: string}[];
  sites: {uuid: string; name: string}[];
  credential: { abilities: IntegrationAbility[]; expires_at: string } | null;
}
export type IntegrationGrants = Pick<IntegrationApplication, "name" | "abilities" | "device_uuids" | "site_uuids">
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
    await this.send(`${this.baseUrl}/sanctum/csrf-cookie`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
  }

  /**
   * Signs in with a password. Throws {@link TwoStepRequiredError} when the person has
   * two-step sign-in on (spec 034): the session starts at `twoStepChallenge`.
   */
  async login(credentials: LoginCredentials): Promise<AuthenticatedUser> {
    await this.csrf()

    const response = await this.request<ApiResponse<AuthenticatedUser> | { two_step_required: true; expires_in: number; methods: TwoStepMethod[] }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    })
    if ("two_step_required" in response) throw new TwoStepRequiredError(response.expires_in, response.methods)

    return response.data
  }

  /**
   * The second step of sign-in (spec 034). A wrong code rejects with an `ApiError` 422
   * whose payload is a {@link TwoStepRefusal}; `errors.pending` means start again with
   * the password. `recoveryCodesRemaining` is set when a recovery code was used.
   */
  async twoStepChallenge(answer: TwoStepAnswer): Promise<{ user: AuthenticatedUser; recoveryCodesRemaining: number | null }> {
    const response = await this.request<ApiResponse<AuthenticatedUser> & { recovery_codes_remaining?: number }>("/api/v1/auth/two-step", {
      method: "POST",
      body: JSON.stringify("code" in answer ? { code: answer.code } : { recovery_code: answer.recoveryCode }),
    })

    return { user: response.data, recoveryCodesRemaining: response.recovery_codes_remaining ?? null }
  }

  /** Confirms the password before a security change (spec 034); lasts 15 minutes. */
  async confirmPassword(password: string): Promise<void> {
    await this.request("/api/v1/auth/confirm-password", { method: "POST", body: JSON.stringify({ password }) })
  }

  security(): Promise<SecuritySettings> {
    return this.data<SecuritySettings>("/api/v1/me/security")
  }

  /** Starts (or restarts) two-step setup. Needs a confirmed password. */
  startTwoStep(): Promise<TwoStepSetup> {
    return this.request<TwoStepSetup>("/api/v1/me/two-step", { method: "POST" })
  }

  /** Turns two-step on with a code from the app; the recovery codes are shown only now. */
  confirmTwoStep(code: string): Promise<string[]> {
    return this.request<{ recovery_codes: string[] }>("/api/v1/me/two-step/confirm", { method: "POST", body: JSON.stringify({ code }) })
      .then((response) => response.recovery_codes)
  }

  /** Replaces the recovery codes; every earlier code stops working. Needs a confirmed password. */
  regenerateRecoveryCodes(): Promise<string[]> {
    return this.request<{ recovery_codes: string[] }>("/api/v1/me/two-step/recovery-codes", { method: "POST" })
      .then((response) => response.recovery_codes)
  }

  /** Turns two-step off. Needs a confirmed password. Refused (`409 two_step_required`) while it is required. */
  async disableTwoStep(): Promise<void> {
    await this.request("/api/v1/me/two-step", { method: "DELETE" })
  }

  /** Whether the organization requires two-step sign-in for every member (spec 034). Needs `Organization.update`. */
  organizationSecurity(org: string): Promise<OrganizationSecurity> {
    return this.data<OrganizationSecurity>(`/api/v1/organizations/${encodeURIComponent(org)}/security`)
  }

  /** Requires two-step sign-in for every member, or stops. Refused (`409`) until the viewer has their own set up. */
  setOrganizationTwoStep(org: string, required: boolean): Promise<OrganizationSecurity> {
    return this.data<OrganizationSecurity>(`/api/v1/organizations/${encodeURIComponent(org)}/security`, "PUT", { two_step_required: required })
  }

  /**
   * Where the passkey ceremonies run (spec 034): sign in, confirm the person instead of
   * their password, and add a passkey. Each options route answers `404` where passkeys
   * cannot be used, and adding one needs a confirmed password or passkey (`423`).
   */
  passkeyEndpoints(): PasskeyEndpoints {
    const url = (path: string) => `${this.baseUrl}/api/v1/${path}`
    return {
      signIn: { options: url("auth/passkeys/options"), submit: url("auth/passkeys") },
      confirm: { options: url("auth/confirm-passkey/options"), submit: url("auth/confirm-passkey") },
      register: { options: url("me/passkeys/options"), submit: url("me/passkeys") },
    }
  }

  /** Removes one of the person's passkeys. Needs a confirmed password or passkey. */
  async removePasskey(id: number): Promise<void> {
    await this.request(`/api/v1/me/passkeys/${encodeURIComponent(String(id))}`, { method: "DELETE" })
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

  pushSettings() {
    return this.data<import("./notifications").PushSettings>("/api/v1/notifications/push")
  }

  updatePushSettings(input: import("./notifications").PushSettingsInput) {
    return this.data<import("./notifications").PushSettings>("/api/v1/notifications/push", "PUT", input)
  }

  setPushOrganization(organizationUuid: string, enabled: boolean) {
    return this.data<import("./notifications").PushSettings>(`/api/v1/notifications/push/organizations/${organizationUuid}`, "PUT", { enabled })
  }

  registerPushDevice(input: import("./notifications").PushDeviceRegistration) {
    return this.data<import("./notifications").PushDeviceRegistered>("/api/v1/notifications/push/devices", "POST", input)
  }

  syncPushDevice(endpoint: string) {
    return this.data<import("./notifications").PushSyncResult>("/api/v1/notifications/push/devices/sync", "POST", { endpoint })
  }

  removePushDevice(deviceUuid: string) {
    return this.request<void>(`/api/v1/notifications/push/devices/${deviceUuid}`, { method: "DELETE" })
  }

  testPushDevice(deviceUuid: string) {
    return this.data<import("./notifications").PushTestResult>(`/api/v1/notifications/push/devices/${deviceUuid}/test`, "POST")
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

  /**
   * Creates the organization under `billing_account_uuid`, or with `new_billing_account`;
   * with neither, a new account named after the organization (spec 023). `plan_uuid`
   * puts a new account on a plan (spec 028).
   */
  async createAdminOrganization(values: {
    name: string
    slug: string
    billing_account_uuid?: string
    new_billing_account?: { name: string; contact_email?: string | null }
    plan_uuid?: string | null
    /** A trial for the new account instead of `plan_uuid` (spec 029 US8). */
    trial?: { plan_uuid: string; ends_at: string | null }
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

  /**
   * `plan` is a plan's uuid, or `none` for accounts on no plan. `usageAtLeast` (1 to 100,
   * the list's filter is 80) keeps accounts that have used at least that percentage of a
   * limited allowance this month.
   */
  async adminBillingAccounts(
    query: Pick<DirectoryQuery, "search" | "page" | "perPage"> & {
      plan?: string
      usageAtLeast?: number
      pastDue?: boolean
      trial?: TrialFilter
    } = {},
  ): Promise<PaginatedResponse<BillingAccountSummary>> {
    const { plan, usageAtLeast, pastDue, trial, ...directory } = query
    let path = withParameter(withParameter(directoryQuery(directory), "plan", plan), "usage_at_least", usageAtLeast?.toString())
    path = withParameter(withParameter(path, "past_due", pastDue ? "1" : undefined), "trial", trial)
    return this.request<PaginatedResponse<BillingAccountSummary>>(`/api/v1/admin/billing-accounts${path}`)
  }

  /** A billing account's usage for a UTC month (`YYYY-MM`, this month by default), with each organization's share. */
  async adminBillingAccountUsage(billingAccountUuid: string, month?: string): Promise<Usage[]> {
    return this.request<ApiResponse<Usage[]>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/usage${withParameter("", "month", month)}`,
    ).then((response) => response.data)
  }

  /** `archived: false` leaves archived plans out, `true` lists only them. */
  async adminPlans(
    query: Pick<DirectoryQuery, "search" | "page" | "perPage"> & { archived?: boolean } = {},
  ): Promise<PaginatedResponse<BillingPlan>> {
    const { archived, ...directory } = query
    return this.request<PaginatedResponse<BillingPlan>>(
      `/api/v1/admin/billing-plans${withParameter(directoryQuery(directory), "archived", archived === undefined ? undefined : archived ? "1" : "0")}`,
    )
  }

  async createPlan(values: BillingPlanValues): Promise<BillingPlanDetail> {
    return this.request<ApiResponse<BillingPlanDetail>>("/api/v1/admin/billing-plans", {
      method: "POST",
      body: JSON.stringify(values),
    }).then((response) => response.data)
  }

  async adminPlan(planUuid: string): Promise<BillingPlanDetail> {
    return this.request<ApiResponse<BillingPlanDetail>>(
      `/api/v1/admin/billing-plans/${encodeURIComponent(planUuid)}`,
    ).then((response) => response.data)
  }

  /**
   * Changing the allowances of a plan billing accounts are on answers 409 with
   * `affected_accounts` until `confirmAffected` matches it, then 409 with `retention`
   * (`RetentionNeedsConfirmation`) when it shortens retention, until `confirmRetention`.
   */
  async updatePlan(
    planUuid: string,
    values: Partial<BillingPlanValues>,
    confirmAffected?: number,
    confirmRetention?: boolean,
  ): Promise<BillingPlanDetail> {
    return this.request<ApiResponse<BillingPlanDetail>>(`/api/v1/admin/billing-plans/${encodeURIComponent(planUuid)}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...values,
        ...(confirmAffected === undefined ? {} : { confirm_affected: confirmAffected }),
        ...(confirmRetention ? { confirm_retention: true } : {}),
      }),
    }).then((response) => response.data)
  }

  async archivePlan(planUuid: string): Promise<BillingPlanDetail> {
    return this.request<ApiResponse<BillingPlanDetail>>(
      `/api/v1/admin/billing-plans/${encodeURIComponent(planUuid)}/archive`,
      { method: "POST" },
    ).then((response) => response.data)
  }

  async restorePlan(planUuid: string): Promise<BillingPlanDetail> {
    return this.request<ApiResponse<BillingPlanDetail>>(
      `/api/v1/admin/billing-plans/${encodeURIComponent(planUuid)}/restore`,
      { method: "POST" },
    ).then((response) => response.data)
  }

  /** Only a plan that was never assigned can be deleted; otherwise 409. */
  async deletePlan(planUuid: string): Promise<void> {
    await this.request(`/api/v1/admin/billing-plans/${encodeURIComponent(planUuid)}`, { method: "DELETE" })
  }

  /**
   * Puts the account on a plan from now on; `null` takes it off its plan. A change that
   * shortens retention answers 409 (`RetentionNeedsConfirmation`) until `confirmRetention`.
   */
  async setBillingAccountPlan(billingAccountUuid: string, planUuid: string | null, confirmRetention?: boolean): Promise<BillingAccountDetail> {
    return this.request<ApiResponse<BillingAccountDetail>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/plan`,
      { method: "PUT", body: JSON.stringify({ plan_uuid: planUuid, ...(confirmRetention ? { confirm_retention: true } : {}) }) },
    ).then((response) => response.data)
  }

  /**
   * Starts a trial (spec 029 US8) on the account's plan or `plan_uuid`, ending at
   * `ends_at` (an instant) or with no end date. 409 when a trial is open, or
   * (`RetentionNeedsConfirmation`) when the plan shortens retention, until `confirm_retention`.
   */
  async startTrial(billingAccountUuid: string, values: TrialValues): Promise<BillingAccountDetail> {
    return this.request<ApiResponse<BillingAccountDetail>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/trial`,
      { method: "POST", body: JSON.stringify(values) },
    ).then((response) => response.data)
  }

  /** Extends, shortens or moves the open trial to another plan; 409 without one. */
  async changeTrial(billingAccountUuid: string, values: TrialValues): Promise<BillingAccountDetail> {
    return this.request<ApiResponse<BillingAccountDetail>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/trial`,
      { method: "PATCH", body: JSON.stringify(values) },
    ).then((response) => response.data)
  }

  /** Ends the trial now: the paid plan with a saved card, else "trial ended, no payment method". */
  async endTrial(billingAccountUuid: string): Promise<BillingAccountDetail> {
    return this.request<ApiResponse<BillingAccountDetail>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/trial/end`,
      { method: "POST" },
    ).then((response) => response.data)
  }

  /** Turns a trial, or one that ended without a card, into the paid plan, charged from the next day. */
  async convertTrial(billingAccountUuid: string): Promise<BillingAccountDetail> {
    return this.request<ApiResponse<BillingAccountDetail>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/trial/convert`,
      { method: "POST" },
    ).then((response) => response.data)
  }

  /**
   * Replaces the plan's allowance for this account only; `value: null` is unlimited. A
   * shorter `retention_days` answers 409 (`RetentionNeedsConfirmation`) until
   * `confirm_retention`.
   */
  async overrideAllowance(
    billingAccountUuid: string,
    kind: AllowanceKind,
    values: { value: number | null; note: string; confirm_retention?: boolean },
  ): Promise<BillingAccountDetail> {
    return this.request<ApiResponse<BillingAccountDetail>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/allowances/${kind}`,
      { method: "PUT", body: JSON.stringify(values) },
    ).then((response) => response.data)
  }

  async removeAllowanceOverride(billingAccountUuid: string, kind: AllowanceKind, confirmRetention?: boolean): Promise<BillingAccountDetail> {
    return this.request<ApiResponse<BillingAccountDetail>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/allowances/${kind}${confirmRetention ? "?confirm_retention=1" : ""}`,
      { method: "DELETE" },
    ).then((response) => response.data)
  }

  /** Sets a plan's prices from next month; `effective_from` says from when. */
  async setPlanPrices(planUuid: string, values: PlanPriceValues): Promise<{ plan: BillingPlanDetail; effective_from: string }> {
    return this.request<ApiResponse<BillingPlanDetail> & { effective_from: string }>(
      `/api/v1/admin/billing-plans/${encodeURIComponent(planUuid)}/prices`,
      { method: "PUT", body: JSON.stringify(values) },
    ).then((response) => ({ plan: response.data, effective_from: response.effective_from }))
  }

  /** Overrides one price for this account from next month, with a note; `value: null` goes back to the plan's. */
  async overridePrice(
    billingAccountUuid: string,
    price: PriceKind,
    values: { value: number | null; note: string | null },
  ): Promise<{ account: BillingAccountDetail; effective_from: string }> {
    return this.request<ApiResponse<BillingAccountDetail> & { effective_from: string }>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/prices/${price}`,
      { method: "PUT", body: JSON.stringify(values) },
    ).then((response) => ({ account: response.data, effective_from: response.effective_from }))
  }

  async updateBillingDetails(
    billingAccountUuid: string,
    values: { billing_address: string | null; tax_number: string | null; tax_rate_uuid: string | null },
  ): Promise<BillingAccountDetail> {
    return this.request<ApiResponse<BillingAccountDetail>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/billing-details`,
      { method: "PATCH", body: JSON.stringify(values) },
    ).then((response) => response.data)
  }

  /** What the sign-up page needs: whether sign-up is open, the free beta and a form token (spec 035). */
  async signUpConfig(): Promise<SignUpConfig> {
    return this.request<SignUpConfig>("/api/v1/sign-up")
  }

  /**
   * Starts a sign-up: a waiting sign-up and an emailed link, tied to this browser. The
   * answer is the same whether or not the address has an account.
   */
  async signUp(input: SignUpInput): Promise<Extract<SignUpStatus, { state: "waiting" }>> {
    await this.csrf()

    return this.request<Extract<SignUpStatus, { state: "waiting" }>>("/api/v1/sign-up", {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  /** This browser's sign-up; once completed, this browser is signed in (`signed_in`). Rejects 404 without one. */
  async signUpStatus(): Promise<SignUpStatus> {
    return this.request<SignUpStatus>("/api/v1/sign-up/status")
  }

  /** Emails a new link; the earlier one stops working. Rejects 429 with `retry_after` when too soon. */
  async resendSignUp(): Promise<Extract<SignUpStatus, { state: "waiting" }>> {
    await this.csrf()

    return this.request<Extract<SignUpStatus, { state: "waiting" }>>("/api/v1/sign-up/resend", { method: "POST" })
  }

  /**
   * Opens a link. Rejects with 410 (`used`, `expired`), 409 (`account_exists`) or 404 (an
   * unknown or replaced link); see {@link signUpLinkProblem}.
   */
  async confirmSignUp(token: string): Promise<SignUpConfirmation> {
    await this.csrf()

    return this.request<SignUpConfirmation>("/api/v1/sign-up/confirm", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
  }

  /** Sign-up settings, for super administrators (spec 035). */
  async signUpSettings(): Promise<SignUpSettings> {
    return this.request<ApiResponse<SignUpSettings>>("/api/v1/admin/sign-up-settings").then((response) => response.data)
  }

  /** Saves the sign-up settings; a stale `revision` answers 409. */
  async updateSignUpSettings(values: SignUpSettingsValues): Promise<SignUpSettings> {
    return this.request<ApiResponse<SignUpSettings>>("/api/v1/admin/sign-up-settings", {
      method: "PUT",
      body: JSON.stringify(values),
    }).then((response) => response.data)
  }

  /** Sign-ups, newest first (spec 035). */
  async signUps(query: SignUpQuery = {}): Promise<PaginatedResponse<SignUpRecord>> {
    const parameters = new URLSearchParams()
    if (query.state) parameters.set("state", query.state)
    if (query.search?.trim()) parameters.set("search", query.search.trim())
    if (query.page && query.page > 1) parameters.set("page", String(query.page))
    if (query.perPage) parameters.set("per_page", String(query.perPage))
    const search = parameters.toString()

    return this.request<PaginatedResponse<SignUpRecord>>(`/api/v1/admin/sign-ups${search ? `?${search}` : ""}`)
  }

  async billingSettings(): Promise<BillingSettings> {
    return this.request<ApiResponse<BillingSettings>>("/api/v1/admin/billing/settings").then((response) => response.data)
  }

  /** Saves the operator's details; a stale `revision` answers 409. */
  async updateBillingSettings(values: BillingSettingsValues): Promise<BillingSettings> {
    return this.request<ApiResponse<BillingSettings>>("/api/v1/admin/billing/settings", {
      method: "PUT",
      body: JSON.stringify(values),
    }).then((response) => response.data)
  }

  /** Current rates first, then archived, by name. */
  async taxRates(): Promise<TaxRate[]> {
    return this.request<ApiResponse<TaxRate[]>>("/api/v1/admin/billing/tax-rates").then((response) => response.data)
  }

  async createTaxRate(values: { name: string; basis_points: number }): Promise<TaxRate> {
    return this.request<ApiResponse<TaxRate>>("/api/v1/admin/billing/tax-rates", {
      method: "POST",
      body: JSON.stringify(values),
    }).then((response) => response.data)
  }

  async updateTaxRate(rateUuid: string, values: { name?: string; basis_points?: number }): Promise<TaxRate> {
    return this.request<ApiResponse<TaxRate>>(`/api/v1/admin/billing/tax-rates/${encodeURIComponent(rateUuid)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }).then((response) => response.data)
  }

  /** Archived rates stay on the accounts that have them and cannot be newly chosen. */
  async archiveTaxRate(rateUuid: string): Promise<TaxRate> {
    return this.request<ApiResponse<TaxRate>>(`/api/v1/admin/billing/tax-rates/${encodeURIComponent(rateUuid)}/archive`, {
      method: "POST",
    }).then((response) => response.data)
  }

  /** Invoices, newest month first. `month` is `YYYY-MM`, `account` a billing account's uuid. */
  async adminInvoices(
    query: Pick<DirectoryQuery, "page" | "perPage"> & {
      status?: InvoiceStatus
      month?: string
      account?: string
      paymentStatus?: PaymentStatus
      /** Issued and still to be paid: pending or failed. */
      unpaid?: boolean
    } = {},
  ): Promise<PaginatedResponse<InvoiceSummary>> {
    const { status, month, account, paymentStatus, unpaid, ...directory } = query
    let path = directoryQuery(directory)
    path = withParameter(path, "status", status)
    path = withParameter(path, "month", month)
    path = withParameter(path, "account", account)
    path = withParameter(path, "payment_status", paymentStatus)
    path = withParameter(path, "unpaid", unpaid ? "1" : undefined)
    return this.request<PaginatedResponse<InvoiceSummary>>(`/api/v1/admin/billing/invoices${path}`)
  }

  /** Accounts whose invoice for an ended month waits for final usage: every such month, or one (`YYYY-MM`). */
  async waitingInvoices(month?: string): Promise<WaitingInvoice[]> {
    return this.request<ApiResponse<WaitingInvoice[]>>(
      `/api/v1/admin/billing/invoices/waiting${withParameter("", "month", month)}`,
    ).then((response) => response.data)
  }

  /** Drafts a month's invoice now (`YYYY-MM`), before usage is final; 409 when one exists. */
  async draftInvoice(billingAccountUuid: string, values: { month: string; note: string }): Promise<InvoiceDetail> {
    return this.request<ApiResponse<InvoiceDetail>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/invoices`,
      { method: "POST", body: JSON.stringify(values) },
    ).then((response) => response.data)
  }

  async adminInvoice(invoiceUuid: string): Promise<InvoiceDetail> {
    return this.request<ApiResponse<InvoiceDetail>>(`/api/v1/admin/billing/invoices/${encodeURIComponent(invoiceUuid)}`).then(
      (response) => response.data,
    )
  }

  /** Rebuilds a draft from the records, keeping adjustments; 409 once issued. */
  async recalculateInvoice(invoiceUuid: string): Promise<InvoiceDetail> {
    return this.invoiceAction(invoiceUuid, "recalculate")
  }

  /** A charge, or a credit with a negative `amount`, on a draft. */
  async addInvoiceAdjustment(invoiceUuid: string, values: { description: string; amount: number; note: string }): Promise<InvoiceDetail> {
    return this.invoiceAction(invoiceUuid, "adjustments", values)
  }

  async removeInvoiceAdjustment(invoiceUuid: string, lineId: number): Promise<InvoiceDetail> {
    return this.request<ApiResponse<InvoiceDetail>>(
      `/api/v1/admin/billing/invoices/${encodeURIComponent(invoiceUuid)}/adjustments/${lineId}`,
      { method: "DELETE" },
    ).then((response) => response.data)
  }

  /** Numbers and fixes the invoice and emails it to the billing contact and owners. */
  async issueInvoice(invoiceUuid: string): Promise<InvoiceDetail> {
    return this.invoiceAction(invoiceUuid, "issue")
  }

  /** A credit note on an issued invoice, up to the part not yet credited. */
  async issueCreditNote(invoiceUuid: string, values: { amount: number; reason: string }): Promise<CreditNote> {
    return this.request<ApiResponse<CreditNote>>(
      `/api/v1/admin/billing/invoices/${encodeURIComponent(invoiceUuid)}/credit-notes`,
      { method: "POST", body: JSON.stringify(values) },
    ).then((response) => response.data)
  }

  /** Records a payment made another way, such as a bank transfer, up to what is still owed. */
  /** A payment made another way; `note` says how (spec 029 FR-044). */
  async recordInvoicePayment(invoiceUuid: string, values: { amount: number; note: string }): Promise<InvoiceDetail> {
    return this.invoiceAction(invoiceUuid, "payments", values)
  }

  /** Asks Stripe about the invoice's pending payments; 404 while payments are off. */
  async reconcileInvoice(invoiceUuid: string): Promise<InvoiceDetail> {
    return this.invoiceAction(invoiceUuid, "reconcile")
  }

  /** Where an administrator downloads an invoice as PDF or CSV (session cookie). */
  adminInvoiceDocumentUrl(invoiceUuid: string, format: "pdf" | "csv"): string {
    return `${this.baseUrl}/api/v1/admin/billing/invoices/${encodeURIComponent(invoiceUuid)}.${format}`
  }

  adminCreditNoteDocumentUrl(creditNoteUuid: string, format: "pdf" | "csv"): string {
    return `${this.baseUrl}/api/v1/admin/billing/credit-notes/${encodeURIComponent(creditNoteUuid)}.${format}`
  }

  private async invoiceAction(invoiceUuid: string, action: string, body?: unknown): Promise<InvoiceDetail> {
    return this.request<ApiResponse<InvoiceDetail>>(
      `/api/v1/admin/billing/invoices/${encodeURIComponent(invoiceUuid)}/${action}`,
      { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    ).then((response) => response.data)
  }

  async createBillingAccount(values: BillingAccountValues): Promise<BillingAccountDetail> {
    return this.request<ApiResponse<BillingAccountDetail>>("/api/v1/admin/billing-accounts", {
      method: "POST",
      body: JSON.stringify(values),
    }).then((response) => response.data)
  }

  async adminBillingAccount(billingAccountUuid: string): Promise<BillingAccountDetail> {
    return this.request<ApiResponse<BillingAccountDetail>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}`,
    ).then((response) => response.data)
  }

  async updateBillingAccount(
    billingAccountUuid: string,
    values: Partial<BillingAccountValues>,
  ): Promise<BillingAccountDetail> {
    return this.request<ApiResponse<BillingAccountDetail>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}`,
      { method: "PATCH", body: JSON.stringify(values) },
    ).then((response) => response.data)
  }

  /** Only an account with no organizations can be deleted; otherwise 409. */
  async deleteBillingAccount(billingAccountUuid: string): Promise<void> {
    await this.request(`/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}`, {
      method: "DELETE",
    })
  }

  async addBillingAccountOwner(billingAccountUuid: string, userId: number): Promise<BillingAccountOwner[]> {
    return this.request<ApiResponse<BillingAccountOwner[]>>(
      `/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/owners/${userId}`,
      { method: "PUT" },
    ).then((response) => response.data)
  }

  async removeBillingAccountOwner(billingAccountUuid: string, userId: number): Promise<void> {
    await this.request(`/api/v1/admin/billing-accounts/${encodeURIComponent(billingAccountUuid)}/owners/${userId}`, {
      method: "DELETE",
    })
  }

  /**
   * Moves the organization from now on; nothing inside it changes, and the limit does not
   * apply. A shorter retention on the new account answers 409
   * (`RetentionNeedsConfirmation`) until `confirmRetention`.
   */
  async moveOrganizationBillingAccount(organizationUuid: string, billingAccountUuid: string, confirmRetention?: boolean): Promise<void> {
    await this.request(`/api/v1/admin/organizations/${encodeURIComponent(organizationUuid)}/billing-account`, {
      method: "PUT",
      body: JSON.stringify({ billing_account_uuid: billingAccountUuid, ...(confirmRetention ? { confirm_retention: true } : {}) }),
    })
  }

  /** The billing accounts the signed-in person owns (spec 023). */
  async ownedBillingAccounts(): Promise<OwnedBillingAccount[]> {
    return this.request<ApiResponse<OwnedBillingAccount[]>>("/api/v1/billing-accounts").then(
      (response) => response.data,
    )
  }

  // Brands and logos (spec 036). `admin` uses the platform staff routes, which skip the allowance check.
  private brandPath(billingAccountUuid: string, admin: boolean, rest: string) {
    return `/api/v1/${admin ? "admin/" : ""}billing-accounts/${encodeURIComponent(billingAccountUuid)}/${rest}`
  }
  private imageBody(file: File) {
    const body = new FormData()
    body.append("image", file)
    return body
  }

  /** A billing account's brand, addresses, switches and image limits; 404 for an account the person does not own. */
  async branding(billingAccountUuid: string, admin = false): Promise<import("./branding").Branding> {
    return this.data(this.brandPath(billingAccountUuid, admin, "branding"))
  }

  /** 403 `branding_not_allowed` for an owner whose plan has no branding; 409 `brand_changed` on a stale `revision`. */
  async updateBrand(billingAccountUuid: string, values: import("./branding").BrandValues, admin = false): Promise<import("./branding").Brand> {
    return this.data(this.brandPath(billingAccountUuid, admin, "brand"), "PUT", values)
  }

  /** PNG, JPEG or WebP up to 1 MB; a refusal is a 422 whose `code` is a `BrandImageRefusal`. */
  async setBrandImage(
    billingAccountUuid: string,
    role: import("./branding").BrandImageRole,
    file: File,
    admin = false,
  ): Promise<import("./branding").Brand> {
    return (
      await this.request<ApiResponse<import("./branding").Brand>>(this.brandPath(billingAccountUuid, admin, `brand/images/${role}`), {
        method: "POST",
        body: this.imageBody(file),
      })
    ).data
  }

  async removeBrandImage(billingAccountUuid: string, role: import("./branding").BrandImageRole, admin = false): Promise<import("./branding").Brand> {
    return this.data(this.brandPath(billingAccountUuid, admin, `brand/images/${role}`), "DELETE")
  }

  /**
   * Claims a name under the platform's domain for the billing account, or renames the
   * one it holds; the old name then redirects for 30 days. A refusal's `code` is a
   * `PortalAddressRefusal`.
   */
  async claimPortalName(billingAccountUuid: string, name: string, admin = false): Promise<import("./branding").PortalAddress> {
    return this.data(this.brandPath(billingAccountUuid, admin, "addresses/name"), "PUT", { name })
  }

  /**
   * Asks for a custom domain such as `portal.example.org`. The answer carries the CNAME
   * `record` to add; the address serves once a check finds it. A refusal's `code` is a
   * `PortalDomainRefusal`.
   */
  async claimPortalDomain(billingAccountUuid: string, host: string, admin = false): Promise<import("./branding").PortalAddress> {
    return this.data(this.brandPath(billingAccountUuid, admin, "addresses/domain"), "PUT", { host })
  }

  /** Looks a custom domain's DNS record up now. 429 `checked_recently` within a minute of the last time. */
  async checkPortalAddress(billingAccountUuid: string, addressUuid: string, admin = false): Promise<import("./branding").PortalAddress> {
    return this.data(this.brandPath(billingAccountUuid, admin, `addresses/${encodeURIComponent(addressUuid)}/check`), "POST")
  }

  /** Releases an address: it stops serving within a minute and its host is held for 30 days. 409 `suspended` for an owner. */
  async releasePortalAddress(billingAccountUuid: string, addressUuid: string, admin = false): Promise<void> {
    await this.request(this.brandPath(billingAccountUuid, admin, `addresses/${encodeURIComponent(addressUuid)}`), { method: "DELETE" })
  }

  /** Every billing account's portal addresses, for platform staff. `search` matches the host or the account's name. */
  async adminPortalAddresses(
    query: Pick<DirectoryQuery, "search" | "page" | "perPage"> & { state?: import("./branding").PortalAddress["state"] } = {},
  ): Promise<PaginatedResponse<import("./branding").PlatformPortalAddress>> {
    const { state, ...directory } = query
    return this.request(`/api/v1/admin/portal-addresses${withParameter(directoryQuery(directory), "state", state)}`)
  }

  /** Platform staff stop an address at once: it serves nothing within a minute and its owners cannot change or remove it. */
  async suspendPortalAddress(addressUuid: string): Promise<import("./branding").PlatformPortalAddress> {
    return this.data(`/api/v1/admin/portal-addresses/${encodeURIComponent(addressUuid)}/suspend`, "POST")
  }

  /** Platform staff lift a suspension. A custom domain is checked again and waits when its record is gone. */
  async restorePortalAddress(addressUuid: string): Promise<import("./branding").PlatformPortalAddress> {
    return this.data(`/api/v1/admin/portal-addresses/${encodeURIComponent(addressUuid)}/restore`, "POST")
  }

  /** An organization's own logo, needing `Organization.update`; refusals as for `setBrandImage`. */
  async setOrganizationLogo(
    organizationUuid: string,
    role: import("./branding").OrganizationLogoRole,
    file: File,
  ): Promise<import("./branding").OrganizationLogos> {
    return (
      await this.request<ApiResponse<import("./branding").OrganizationLogos>>(
        `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/${role === "logo" ? "logo" : "logo/dark"}`,
        { method: "POST", body: this.imageBody(file) },
      )
    ).data
  }

  async removeOrganizationLogo(
    organizationUuid: string,
    role: import("./branding").OrganizationLogoRole,
  ): Promise<import("./branding").OrganizationLogos> {
    return this.data(`/api/v1/organizations/${encodeURIComponent(organizationUuid)}/${role === "logo" ? "logo" : "logo/dark"}`, "DELETE")
  }

  /** An owned account's usage for a UTC month (`YYYY-MM`, this month by default); 404 for anyone else's. */
  async ownedBillingAccountUsage(billingAccountUuid: string, month?: string): Promise<Usage[]> {
    return this.request<ApiResponse<Usage[]>>(
      `/api/v1/billing-accounts/${encodeURIComponent(billingAccountUuid)}/usage${withParameter("", "month", month)}`,
    ).then((response) => response.data)
  }

  /**
   * This month's usage as a manager of the organization sees it, and its telemetry
   * retention; needs `Device.manage` (403 otherwise).
   */
  async organizationUsage(organizationUuid: string): Promise<{ usage: OrganizationUsage[]; retention: OrganizationRetention }> {
    return this.request<ApiResponse<OrganizationUsage[]> & { retention: OrganizationRetention }>(
      `/api/v1/organizations/${encodeURIComponent(organizationUuid)}/usage`,
    ).then((response) => ({ usage: response.data, retention: response.retention }))
  }

  /**
   * Creates an organization under an owned account and makes the owner its Organization
   * Admin. Without `slug`, the server picks a free one. 422 on `billing_account` at the limit.
   */
  async createOwnedOrganization(
    billingAccountUuid: string,
    values: { name: string; slug?: string },
  ): Promise<OwnerOrganization> {
    return this.request<ApiResponse<OwnerOrganization>>(
      `/api/v1/billing-accounts/${encodeURIComponent(billingAccountUuid)}/organizations`,
      { method: "POST", body: JSON.stringify(values) },
    ).then((response) => response.data)
  }

  /** An owned account's issued invoices and credit notes; drafts are never listed. */
  async ownedInvoices(billingAccountUuid: string): Promise<{ invoices: InvoiceSummary[]; credit_notes: CreditNote[] }> {
    return this.request<ApiResponse<{ invoices: InvoiceSummary[]; credit_notes: CreditNote[] }>>(
      `/api/v1/billing-accounts/${encodeURIComponent(billingAccountUuid)}/invoices`,
    ).then((response) => response.data)
  }

  /** One issued invoice; a draft or another account's answers 404. */
  async ownedInvoice(billingAccountUuid: string, invoiceUuid: string): Promise<InvoiceDetail> {
    return this.request<ApiResponse<InvoiceDetail>>(
      `/api/v1/billing-accounts/${encodeURIComponent(billingAccountUuid)}/invoices/${encodeURIComponent(invoiceUuid)}`,
    ).then((response) => response.data)
  }

  /** Stripe's page to save a card for this account; open `url` in the browser. 404 while payments are off. */
  async paymentMethodCheckout(billingAccountUuid: string): Promise<{ url: string }> {
    return this.request<ApiResponse<{ url: string }>>(
      `/api/v1/billing-accounts/${encodeURIComponent(billingAccountUuid)}/payment-method/checkout`,
      { method: "POST" },
    ).then((response) => response.data)
  }

  async removePaymentMethod(billingAccountUuid: string): Promise<void> {
    await this.request(`/api/v1/billing-accounts/${encodeURIComponent(billingAccountUuid)}/payment-method`, {
      method: "DELETE",
    })
  }

  /** Stripe's page to pay what is still owed on an issued invoice; 409 when nothing is. */
  async invoiceCheckout(billingAccountUuid: string, invoiceUuid: string): Promise<{ url: string }> {
    return this.request<ApiResponse<{ url: string }>>(
      `/api/v1/billing-accounts/${encodeURIComponent(billingAccountUuid)}/invoices/${encodeURIComponent(invoiceUuid)}/checkout`,
      { method: "POST" },
    ).then((response) => response.data)
  }

  /** Back from Stripe's page: the API asks Stripe how the session's payment stands and records it. */
  async invoiceCheckoutReturned(billingAccountUuid: string, invoiceUuid: string, session: string): Promise<void> {
    await this.request(
      `/api/v1/billing-accounts/${encodeURIComponent(billingAccountUuid)}/invoices/${encodeURIComponent(invoiceUuid)}/checkout/returned`,
      { method: "POST", body: JSON.stringify({ session }) },
    )
  }

  /** Where an owner downloads an issued invoice as PDF or CSV (session cookie). */
  ownedInvoiceDocumentUrl(billingAccountUuid: string, invoiceUuid: string, format: "pdf" | "csv"): string {
    return `${this.baseUrl}/api/v1/billing-accounts/${encodeURIComponent(billingAccountUuid)}/invoices/${encodeURIComponent(invoiceUuid)}.${format}`
  }

  ownedCreditNoteDocumentUrl(billingAccountUuid: string, creditNoteUuid: string, format: "pdf" | "csv"): string {
    return `${this.baseUrl}/api/v1/billing-accounts/${encodeURIComponent(billingAccountUuid)}/credit-notes/${encodeURIComponent(creditNoteUuid)}.${format}`
  }

  async adminOrganizationDeletion(organizationUuid: string): Promise<OrganizationDeletion> {
    return this.request<ApiResponse<OrganizationDeletion>>(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationUuid)}/deletion`,
    ).then((response) => response.data)
  }

  /**
   * Deletes the organization permanently; `slug` repeats its slug as confirmation.
   * A 409 carries `blockers` (OrganizationDeletionEntry[]) when it still holds data that blocks it.
   */
  async deleteAdminOrganization(organizationUuid: string, slug: string): Promise<void> {
    await this.request(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationUuid)}?${new URLSearchParams({ slug })}`,
      { method: "DELETE" },
    )
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

  /** What people did across the platform, newest first (spec 024); platform administrators who manage organizations. */
  async adminActivity(query: ActivityQuery = {}): Promise<ActivityPage> {
    const parameters = new URLSearchParams()
    if (query.userId) parameters.set("user_id", query.userId.toString())
    if (query.organization) parameters.set("organization", query.organization)
    if (query.cursor) parameters.set("cursor", query.cursor)
    const search = parameters.toString()

    return this.request<ActivityPage>(`/api/v1/admin/activity${search ? `?${search}` : ""}`)
  }

  async adminUsers(
    query: DirectoryQuery = {},
  ): Promise<PaginatedResponse<PlatformUser>> {
    return this.request<PaginatedResponse<PlatformUser>>(
      `/api/v1/admin/users${directoryQuery(query)}`,
    )
  }

  /**
   * Resets a locked-out person's two-step sign-in (spec 034, FR-024): their authenticator,
   * recovery codes and passkeys are removed and every sign-in of theirs ends. `reason`
   * is required, up to 500 characters.
   */
  async resetTwoStep(userId: number, reason: string): Promise<void> {
    await this.request(`/api/v1/admin/users/${userId}/two-step/reset`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    })
  }

  async adminRoles(
    query: DirectoryQuery = {},
  ): Promise<PaginatedResponse<OrganizationRole>> {
    return this.request<PaginatedResponse<OrganizationRole>>(
      `/api/v1/admin/roles${directoryQuery(query)}`,
    )
  }

  /** The organization's open application telemetry streams (spec 030), oldest first. */
  async adminOrganizationIntegrationStreams(organizationUuid: string): Promise<IntegrationStreamSession[]> {
    return this.request<ApiResponse<IntegrationStreamSession[]>>(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationUuid)}/integration-streams`,
    ).then((response) => response.data)
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

  async inviteSuperAdministrator(email: string): Promise<OrganizationInvitation> {
    return this.request<ApiResponse<OrganizationInvitation>>(
      "/api/v1/admin/super-administrators/invitations",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
    ).then((response) => response.data)
  }

  async grantSuperAdministrator(userId: number): Promise<PlatformUser> {
    return this.request<ApiResponse<PlatformUser>>(
      `/api/v1/admin/super-administrators/${userId}`,
      { method: "PUT" },
    ).then((response) => response.data)
  }

  async revokeSuperAdministrator(userId: number): Promise<void> {
    await this.request(`/api/v1/admin/super-administrators/${userId}`, {
      method: "DELETE",
    })
  }

  async grantPlatformAdministrator(userId: number): Promise<PlatformTeamMember> {
    return this.updatePlatformTeamMember(userId, true)
  }

  async revokePlatformAdministrator(userId: number): Promise<PlatformTeamMember> {
    return this.updatePlatformTeamMember(userId, false)
  }

  private async updatePlatformTeamMember(
    userId: number,
    isPlatformAdministrator: boolean,
  ): Promise<PlatformTeamMember> {
    return this.request<ApiResponse<PlatformTeamMember>>(
      `/api/v1/admin/platform-team/${userId}`,
      {
        method: "PUT",
        body: JSON.stringify({ is_platform_administrator: isPlatformAdministrator }),
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
      /** One lifecycle, or "current" for every lifecycle but archived. */
      lifecycle?: string
      /** The list's status: online, offline, offline_alert (an open offline alert), unseen, unknown, unconfigured, updating, failed, deactivated or archived. */
      status?: string[]
      /** Devices whose applied (or last applied) configuration uses this profile. */
      profile_uuid?: string
      site_uuid?: string
      /** Devices configured from a source behind this gateway. */
      gateway_uuid?: string
      tag?: string
      /** name, code, last_seen or created; a leading "-" sorts descending. */
      sort?: string
      page?: number
      per_page?: number
    } = {},
  ) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => search.append(`${key}[]`, item))
      else if (value !== undefined && value !== "") search.append(key, String(value))
    }
    return this.request<{
      data: Device[]
      /** `sort` echoes the applied sort; APIs without server sorting leave it out. */
      meta: { current_page: number; last_page: number; total: number; sort?: string }
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
  firmwareTargets(org: string, signal?: AbortSignal) {
    return this.data<import("./firmware").FirmwareTarget[]>(`/api/v1/organizations/${encodeURIComponent(org)}/firmware/targets`, "GET", undefined, signal)
  }
  createFirmwareStarter(org: string, body: import("./firmware").FirmwareStarterInput) {
    return this.data<import("./firmware").FirmwareArchive>(`/api/v1/organizations/${encodeURIComponent(org)}/firmware/starters`, "POST", body)
  }
  deviceConnectionSettings(org: string, id: string) {
    return this.data<import("./firmware").FirmwareArchive>(this.devicePath(org, id) + "/connection-settings", "POST")
  }
  deviceFirmwareKit(org: string, id: string, target: string) {
    return this.data<import("./firmware").FirmwareArchive>(this.devicePath(org, id) + "/firmware-kit", "POST", { target })
  }
  gatewayConnectionSettings(org: string, id: string) {
    return this.data<import("./firmware").FirmwareArchive>(`/api/v1/organizations/${encodeURIComponent(org)}/gateways/${encodeURIComponent(id)}/connection-settings`, "POST")
  }
  gatewayFirmwareKit(org: string, id: string, body: Omit<import("./firmware").FirmwareStarterInput, "role" | "gateway_uuid"> | Record<string, never> = {}) {
    return this.data<import("./firmware").FirmwareArchive>(`/api/v1/organizations/${encodeURIComponent(org)}/gateways/${encodeURIComponent(id)}/firmware-kit`, "POST", body)
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
  /** The organization's AI agent access setting and connector address. */
  agentAccess(org: string) {
    return this.data<import("./agents").AgentAccessSettings>(`/api/v1/organizations/${encodeURIComponent(org)}/agent-access`)
  }
  setAgentAccess(org: string, enabled: boolean) {
    return this.data<import("./agents").AgentAccessSettings>(`/api/v1/organizations/${encodeURIComponent(org)}/agent-access`, "PUT", { enabled })
  }
  /** The agent connection waiting for the signed-in person's decision (404 when none). */
  currentAgentAuthorization() {
    return this.data<import("./agents").AgentAuthorization>("/api/v1/agent-authorizations/current")
  }
  approveAgentAuthorization(values: { auth_token: string; organization_uuid: string; access_level: import("./agents").AgentAccessLevel }) {
    return this.data<import("./agents").AgentAuthorizationDecision>("/api/v1/agent-authorizations/approve", "POST", values)
  }
  /** The signed-in person's agent connections in every organization. */
  myAgentConnections() {
    return this.data<import("./agents").AgentConnection[]>("/api/v1/me/agent-connections")
  }
  disconnectMyAgent(connection: string) {
    return this.request<null>(`/api/v1/me/agent-connections/${encodeURIComponent(connection)}`, { method: "DELETE" })
  }
  /** Every member's agent connections to the organization (administrators). */
  organizationAgentConnections(org: string) {
    return this.data<import("./agents").AgentConnection[]>(`/api/v1/organizations/${encodeURIComponent(org)}/agent-connections`)
  }
  disconnectAgent(org: string, connection: string) {
    return this.request<null>(`/api/v1/organizations/${encodeURIComponent(org)}/agent-connections/${encodeURIComponent(connection)}`, { method: "DELETE" })
  }
  agentActivity(org: string, connection: string, page = 1) {
    return this.request<import("./agents").AgentActivityPage>(`/api/v1/organizations/${encodeURIComponent(org)}/agent-connections/${encodeURIComponent(connection)}/activity?page=${page}`)
  }
  denyAgentAuthorization(authToken: string) {
    return this.data<import("./agents").AgentAuthorizationDecision>("/api/v1/agent-authorizations/deny", "POST", { auth_token: authToken })
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
  /** Organizations of the billing account the person may move this organization's devices into (spec 031). */
  deviceMoveTargets(org: string) {
    return this.request<import("./deviceMoves").DeviceMoveTargets>(`/api/v1/organizations/${encodeURIComponent(org)}/device-move-targets`)
  }
  /** What moving devices would do; it changes nothing. */
  previewDeviceMove(org: string, values: import("./deviceMoves").DeviceMoveInput) {
    return this.request<import("./deviceMoves").DeviceMoveReview>(`/api/v1/organizations/${encodeURIComponent(org)}/device-moves/preview`, { method: "POST", body: JSON.stringify(values) })
  }
  /** Confirms a reviewed move. A stale review fails with 409 and the fresh review in its body. */
  createDeviceMove(org: string, values: import("./deviceMoves").DeviceMoveConfirmation) {
    return this.data<import("./deviceMoves").DeviceMove>(`/api/v1/organizations/${encodeURIComponent(org)}/device-moves`, "POST", values)
  }
  deviceMove(org: string, move: string, signal?: AbortSignal) {
    return this.data<import("./deviceMoves").DeviceMove>(`/api/v1/organizations/${encodeURIComponent(org)}/device-moves/${encodeURIComponent(move)}`, "GET", undefined, signal)
  }
  /** Stops sharing a moved device's readings from before the move; only on the device the move left here. */
  stopSharingDeviceHistory(org: string, device: string) {
    return this.data<import("./deviceMoves").DeviceLink>(this.devicePath(org, device) + "/link/history", "POST", { enabled: false })
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

  /** Current dashboards; `archived` lists archived ones alone or with the others. */
  dashboards(org: string, archived?: import("./archive").ArchiveFilter) {
    return this.data<Dashboard[]>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards${archived ? `?archived=${archived}` : ""}`)
  }

  /** Hides the dashboard from lists and makes it read-only; its owner or Dashboard.manage. */
  archiveDashboard(org: string, dashboard: string) {
    return this.data<import("./archive").ArchiveState>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards/${encodeURIComponent(dashboard)}/archive`, "POST")
  }

  /** Brings an archived dashboard back as it was; the same people who archive it. */
  restoreDashboard(org: string, dashboard: string) {
    return this.data<import("./archive").ArchiveState>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards/${encodeURIComponent(dashboard)}/restore`, "POST")
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

  /** Who can open the dashboard; needs the share ability. */
  dashboardAccess(org: string, dashboard: string) {
    return this.data<import("./dashboards").DashboardAccessSettings>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards/${encodeURIComponent(dashboard)}/access`)
  }

  /** Replaces the dashboard's access and every share in one step. */
  updateDashboardAccess(org: string, dashboard: string, values: import("./dashboards").DashboardAccessInput) {
    return this.data<import("./dashboards").DashboardAccessSettings>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboards/${encodeURIComponent(dashboard)}/access`, "PUT", values)
  }

  /** Roles and members matching a search, for sharing dashboards. */
  dashboardShareTargets(org: string, search = "") {
    return this.data<{ roles: import("./dashboards").DashboardShareTarget[]; users: import("./dashboards").DashboardShareTarget[] }>(`/api/v1/organizations/${encodeURIComponent(org)}/dashboard-share-targets?${new URLSearchParams({ search })}`)
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
      /** Defaults to the device's reporting time zone. */
      timezone?: string
    },
    signal?: AbortSignal,
  ) {
    const search = new URLSearchParams(
      Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
    )
    return this.data<CounterIncrease>(
      this.devicePath(org, id) + "/measurements/increase?" + search,
      "GET", undefined, signal,
    )
  }
  /** The device's offline-alert settings and what the runtime knows about its connectivity (spec 018). */
  deviceConnectivity(org: string, id: string, signal?: AbortSignal) {
    return this.data<import("./connectivity").DeviceConnectivity>(this.devicePath(org, id) + "/connectivity", "GET", undefined, signal)
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
  /** Creates and publishes the gateway health profile, or returns the organization's existing one. */
  createGatewayHealthProfile(org: string) {
    return this.data<import("./devices").GatewayHealthProfile>(
      `/api/v1/organizations/${encodeURIComponent(org)}/device-profiles/gateway-health`,
      "POST",
      {},
    )
  }
  createBulkOnboarding(org: string, gateway: string, values: import("./devices").BulkOnboardingInput) {
    return this.data<import("./devices").BulkOnboardingRun>(
      `/api/v1/organizations/${encodeURIComponent(org)}/gateways/${encodeURIComponent(gateway)}/bulk-onboardings`,
      "POST",
      values,
    )
  }
  bulkOnboarding(org: string, run: string, cursor?: string | null) {
    return this.data<import("./devices").BulkOnboardingRun>(
      `/api/v1/organizations/${encodeURIComponent(org)}/bulk-onboardings/${encodeURIComponent(run)}` +
        (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    )
  }
  retryBulkOnboarding(org: string, run: string) {
    return this.data<import("./devices").BulkOnboardingRun>(
      `/api/v1/organizations/${encodeURIComponent(org)}/bulk-onboardings/${encodeURIComponent(run)}/retry`,
      "POST",
      {},
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
  /** Organizations for Settings → Retention, by name or slug (needs only `manage-retention`). */
  retentionOrganizations(query: DirectoryQuery = {}): Promise<PaginatedResponse<RetentionOrganization>> {
    return this.request<PaginatedResponse<RetentionOrganization>>(
      `/api/v1/admin/settings/telemetry-retention/organizations${directoryQuery(query)}`,
    )
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

  assistantAdminSettings() {
    return this.data<import("./assistant").AssistantAdminSettings>("/api/v1/admin/assistant-settings")
  }
  updateAssistantAdminSettings(values: import("./assistant").AssistantAdminSettingsInput) {
    return this.data<import("./assistant").AssistantAdminSettings>("/api/v1/admin/assistant-settings", "PUT", values)
  }
  removeAssistantProviderKey(provider: string) {
    return this.data<import("./assistant").AssistantAdminSettings>(
      `/api/v1/admin/assistant-settings/keys/${encodeURIComponent(provider)}`,
      "DELETE",
    )
  }
  testAssistantConnection(values: { provider: string; model: string; api_key?: string }) {
    return this.data<import("./assistant").AssistantConnectionTest>("/api/v1/admin/assistant-settings/test", "POST", values)
  }

  private adapterPath(org: string, id?: string, suffix = "") {
    return `/api/v1/organizations/${encodeURIComponent(org)}/device-adapters${id ? "/" + encodeURIComponent(id) : ""}${suffix}`
  }
  deviceAdapters(org: string) { return this.request<import("./adapters").AdapterDirectory>(this.adapterPath(org)) }
  adapterProfiles(org: string) { return this.data<import("./adapters").AdapterProfile[]>(`/api/v1/organizations/${encodeURIComponent(org)}/device-adapter-profiles`) }
  deviceAdapter(org: string, id: string) { return this.data<import("./adapters").DeviceAdapter>(this.adapterPath(org,id)) }
  createDeviceAdapter(org: string, input: import("./adapters").AdapterDraft & {request_uuid: string}) { return this.data<import("./adapters").DeviceAdapter>(this.adapterPath(org), "POST", input) }
  saveDeviceAdapter(org: string, id: string, input: import("./adapters").AdapterDraft & {draft_revision: number}) { return this.data<import("./adapters").DeviceAdapter>(this.adapterPath(org,id), "PUT", input) }
  /** Deletes an adapter nothing uses; 409 names what still uses it. */
  deleteDeviceAdapter(org: string, id: string) { return this.request<null>(this.adapterPath(org,id), { method: "DELETE" }) }
  testDeviceAdapter(org: string, id: string, draft_revision: number) { return this.data<import("./adapters").AdapterTest>(this.adapterPath(org,id,"/test"), "POST", {draft_revision}) }
  testAdapterConnection(org: string, id: string) { return this.data<{connected: boolean; broker_url?: string}>(this.adapterPath(org,id,"/connection-test"), "POST", {}) }
  deployDeviceAdapter(org: string, id: string, input: {draft_revision: number; action: "deploy" | "pause" | "rollback"; revision_uuid?: string; request_uuid: string; cursor_start_at?: string}) { return this.data<{uuid: string; status: string}>(this.adapterPath(org,id,"/deploy"), "POST", input) }
  adapterCandidates(org: string, id: string) { return this.data<import("./adapters").AdapterCandidate[]>(this.adapterPath(org,id,"/candidates")) }
  /** The readings activating this source can keep: what it last reported, inside retention. Empty when there is nothing to keep. */
  adapterLastReport(org: string,id: string,candidate: string) { return this.data<import("./adapters").AdapterLastReport>(this.adapterPath(org,id,`/candidates/${encodeURIComponent(candidate)}/last-report`)) }
  activateAdapterCandidate(org: string,id: string,candidate: string,input: {name: string;device_uuid?: string;keep_last_readings?: boolean}) { return this.data<{installation_uuid: string;device: Device}>(this.adapterPath(org,id,`/candidates/${encodeURIComponent(candidate)}/activate`), "POST", input) }
  adapterCredentials(org: string,id: string) { return this.data<import("./adapters").AdapterCredential[]>(this.adapterPath(org,id,"/credentials")) }
  createAdapterCredential(org: string,id: string,name: string) { return this.data<import("./adapters").AdapterKit>(this.adapterPath(org,id,"/credentials"), "POST", {name}) }
  adapterConnectionKit(org: string,id: string,credential: string,action: "kit" | "rotate" = "kit") { return this.data<import("./adapters").AdapterKit>(this.adapterPath(org,id,`/credentials/${encodeURIComponent(credential)}/${action}`), "POST", {}) }
  revokeAdapterCredential(org: string,id: string,credential: string) { return this.data<{revoked: boolean}>(this.adapterPath(org,id,`/credentials/${encodeURIComponent(credential)}/revoke`), "POST", {}) }
  adapterWebhook(org: string, id: string) { return this.data<import("./adapters").WebhookDetail>(this.adapterPath(org,id,"/webhook")) }
  createWebhookSecret(org: string, id: string, input: {label: string; value?: string}) { return this.data<import("./adapters").CreatedWebhookSecret>(this.adapterPath(org,id,"/webhook/secrets"), "POST", input) }
  revokeWebhookSecret(org: string, id: string, secret: string) { return this.data<{revoked: boolean}>(this.adapterPath(org,id,`/webhook/secrets/${encodeURIComponent(secret)}/revoke`), "POST", {}) }
  adapterDeliveries(org: string, id: string, kind?: import("./adapters").AdapterDelivery["kind"]) { return this.data<import("./adapters").AdapterDelivery[]>(this.adapterPath(org,id,`/deliveries${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`)) }
  fetchNow(org: string, id: string, draft_revision: number) { return this.data<import("./adapters").FetchResult>(this.adapterPath(org,id,"/fetch-now"), "POST", {draft_revision}) }
  adapterPollRuns(org: string, id: string) { return this.request<{data: import("./adapters").PollRun[]; polling: import("./adapters").AdapterPolling | null}>(this.adapterPath(org,id,"/poll-runs")) }
  resetAdapterCursor(org: string, id: string, input: {request_uuid: string; start_at: string}) { return this.data<import("./adapters").AdapterOperation>(this.adapterPath(org,id,"/cursor"), "POST", input) }
  resumeAdapterPolling(org: string, id: string, input: {request_uuid: string}) { return this.data<import("./adapters").AdapterOperation>(this.adapterPath(org,id,"/resume"), "POST", input) }
  adapterProposals(org: string,id: string) { return this.data<import("./adapters").AdapterProposal[]>(this.adapterPath(org,id,"/proposals")) }
  decideAdapterProposal(org: string,id: string,proposal: string,action: "apply" | "reject",content_hash: string) { return this.data<import("./adapters").DeviceAdapter | {status: string}>(this.adapterPath(org,id,`/proposals/${encodeURIComponent(proposal)}/decision`), "POST", {action,content_hash}) }
  // The device onboarding assistant (spec 020) replaced the adapter assistant.
  onboardingAssistantSettings(org: string) { return this.data<{enabled: boolean; provider: import("./assistant").AssistantProviderRef; supported_extensions: string[]; max_file_bytes: number}>(this.assistantPath(org,undefined,"/settings?scope=onboarding")) }
  onboardingConversations(org: string, adapter_uuid?: string) { return this.data<import("./assistant").OnboardingConversation[]>(this.assistantPath(org,undefined,`/conversations?scope=onboarding${adapter_uuid ? `&adapter_uuid=${encodeURIComponent(adapter_uuid)}` : ""}`)) }
  createOnboardingConversation(org: string, adapter_uuid?: string) { return this.data<import("./assistant").OnboardingConversation>(this.assistantPath(org,undefined,"/conversations"),"POST",{scope:"onboarding",...(adapter_uuid ? {adapter_uuid} : {})}) }
  decideOnboardingProposal(org: string, conversation: string, proposal: string, input: {action: "apply" | "reject"; content_hash: string; request_id: string}) { return this.data<{status: "applied" | "rejected"; adapter: import("./adapters").DeviceAdapter | null; run: import("./assistant").AssistantRun | null; notice: string | null}>(this.assistantPath(org,conversation,`/adapter-proposals/${encodeURIComponent(proposal)}/decision`),"POST",input) }

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
    return this.data<{ enabled: boolean; provider: import("./assistant").AssistantProviderRef }>(this.assistantPath(org, undefined, "/settings?scope=automation"))
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

  /** `query` is the alerts filters as a query string; repeat `kind[]` for several kinds. */
  alerts(org: string, query: string, signal?: AbortSignal) {
    return this.request<import("./alerts").AlertPage<import("./alerts").Alert>>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts?${query}`, { signal })
  }
  alert(org: string, id: string) {
    return this.data<import("./alerts").Alert>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(id)}`)
  }
  acknowledgeAlert(org: string, id: string) {
    return this.data<import("./alerts").Alert>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(id)}/acknowledge`, "POST", {})
  }
  /** `query` takes the alerts filters; `group=source` is added. */
  alertSources(org: string, query: string, signal?: AbortSignal) {
    const params = new URLSearchParams(query)
    params.set("group", "source")
    return this.request<import("./alerts").AlertPage<import("./alerts").AlertSource>>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts?${params}`, { signal })
  }
  /** Already acknowledged alerts are skipped; resolves to the number newly acknowledged. */
  acknowledgeAlerts(org: string, input: import("./alerts").AlertAcknowledgement) {
    return this.data<{ acknowledged: number }>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/acknowledge`, "POST", input)
  }
  /** `null` unassigns. The user must be an organization member (integer user id). */
  assignAlert(org: string, id: string, userId: number | null) {
    return this.data<import("./alerts").Alert>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(id)}/assignee`, "PUT", { user_id: userId })
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

  /** Geofence workflows by default; `kind: "all"` adds DAG automations. */
  dashboardWorkflows(org: string, search: string, page: number, kind: "geofence" | "all" = "geofence") {
    return this.request<{data: {uuid: string; name: string}[]; meta: {current_page: number; last_page: number; total: number}}>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows?${new URLSearchParams({search,page:String(page),kind})}`)
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
  saveLocationBinding(org: string, device: string, input: import("./geospatial").LocationBindingInput) {
    return this.data<import("./geospatial").LocationBinding>(`/api/v1/organizations/${encodeURIComponent(org)}/location-bindings/${encodeURIComponent(device)}`, "PUT", input)
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
  /** Geofence workflows and DAG automations, for Settings → Notifications. */
  notificationWorkflows(org: string, page: number) {
    return this.request<import("./alerts").AlertPage<import("./alerts").WorkflowListItem>>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows?kind=all&page=${page}`)
  }
  automation<T>(org: string, path: string, method = "GET", input?: unknown) {
    return this.request<T>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows${path}`, { method, ...(input === undefined ? {} : { body: JSON.stringify(input) }) })
  }
  workflow(org: string, id: string) {
    return this.data<import("./alerts").AutomationWorkflow>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows/${encodeURIComponent(id)}`)
  }
  /** Turns the automation off (a disable deployment when it runs) and hides it; Workflow.manage and Workflow.activate. */
  archiveWorkflow(org: string, id: string) {
    return this.data<import("./archive").ArchiveState>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows/${encodeURIComponent(id)}/archive`, "POST")
  }
  /** Brings an archived automation back; it stays off until activated. Workflow.manage. */
  restoreWorkflow(org: string, id: string) {
    return this.data<import("./archive").ArchiveState>(`/api/v1/organizations/${encodeURIComponent(org)}/workflows/${encodeURIComponent(id)}/restore`, "POST")
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
  /** Your alert notifications in this organization, newest first, 20 per page (spec 022). */
  alertNotifications(org: string, page: number, signal?: AbortSignal) {
    return this.request<import("./alerts").AlertNotificationPage>(`/api/v1/organizations/${encodeURIComponent(org)}/alert-notifications?page=${page}`, { signal })
  }
  alertNotificationSummary(org: string, signal?: AbortSignal) {
    return this.data<import("./alerts").AlertNotificationSummary>(`/api/v1/organizations/${encodeURIComponent(org)}/alert-notifications/summary`, "GET", undefined, signal)
  }
  /** Resolves to the summary after marking. */
  markAlertNotificationsRead(org: string, input: import("./alerts").AlertNotificationReadInput) {
    return this.data<import("./alerts").AlertNotificationSummary>(`/api/v1/organizations/${encodeURIComponent(org)}/alert-notifications/read`, "POST", input)
  }
  retryAlertDelivery(org: string, alert: string, delivery: string, generation: number) {
    return this.data<{ status: string }>(`/api/v1/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(alert)}/deliveries/${encodeURIComponent(delivery)}/retry`, "POST", { retry_generation: generation })
  }

  // Support tickets (spec 015): people on a ticket use the organization routes.
  private ticketPath(org: string, ticket = "", rest = "") {
    return `/api/v1/organizations/${encodeURIComponent(org)}/tickets${ticket ? "/" + encodeURIComponent(ticket) : ""}${rest}`
  }
  private adminTicketPath(ticket = "", rest = "") {
    return `/api/v1/admin/tickets${ticket ? "/" + encodeURIComponent(ticket) : ""}${rest}`
  }
  private ticketForm(values: Record<string, unknown>, files: File[]) {
    const body = new FormData()
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null) continue
      if (typeof value === "object") {
        for (const [field, inner] of Object.entries(value as Record<string, unknown>)) {
          if (inner !== undefined && inner !== null) body.append(`${key}[${field}]`, String(inner))
        }
      } else {
        body.append(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value))
      }
    }
    files.forEach((file) => body.append("files[]", file, file.name))
    return body
  }
  tickets(org: string, query: URLSearchParams | string = "", signal?: AbortSignal) {
    return this.request<import("./support").TicketPage<import("./support").TicketSummary>>(`${this.ticketPath(org)}?${query}`, { signal })
  }
  ticketSummary(org: string, signal?: AbortSignal) {
    return this.data<{ unread: number }>(this.ticketPath(org, "", "/summary"), "GET", undefined, signal)
  }
  ticket(org: string, ticket: string, signal?: AbortSignal) {
    return this.data<import("./support").Ticket>(this.ticketPath(org, ticket), "GET", undefined, signal)
  }
  async fileTicket(org: string, values: import("./support").TicketFiling, files: File[]) {
    return (await this.request<ApiResponse<import("./support").Ticket>>(this.ticketPath(org), { method: "POST", body: this.ticketForm(values, files) })).data
  }
  updateTicket(org: string, ticket: string, values: { title?: string; status?: "resolved" }) {
    return this.data<import("./support").Ticket>(this.ticketPath(org, ticket), "PATCH", values)
  }
  async replyToTicket(org: string, ticket: string, values: { client_id: string; body: string }, files: File[]) {
    return (await this.request<ApiResponse<import("./support").Ticket>>(this.ticketPath(org, ticket, "/messages"), { method: "POST", body: this.ticketForm(values, files) })).data
  }
  markTicketRead(org: string, ticket: string, sequence?: number) {
    return this.request<null>(this.ticketPath(org, ticket, "/read"), { method: "POST", body: JSON.stringify(sequence === undefined ? {} : { sequence }) })
  }
  ticketPeople(org: string, ticket: string, search: string) {
    return this.data<import("./support").TicketCandidate[]>(this.ticketPath(org, ticket, `/people?${new URLSearchParams({ search })}`))
  }
  addTicketParticipant(org: string, ticket: string, userId: number) {
    return this.data<import("./support").Ticket>(this.ticketPath(org, ticket, `/participants/${userId}`), "PUT", {})
  }
  removeTicketParticipant(org: string, ticket: string, userId: number) {
    return this.request<null>(this.ticketPath(org, ticket, `/participants/${userId}`), { method: "DELETE" })
  }
  ticketAttachmentUrl(org: string, ticket: string, attachment: string) {
    return `${this.baseUrl}${this.ticketPath(org, ticket, `/attachments/${encodeURIComponent(attachment)}`)}`
  }
  // The team's queue in admin.
  adminTickets(query: URLSearchParams | string = "", signal?: AbortSignal) {
    return this.request<import("./support").TicketPage<import("./support").AdminTicketSummary>>(`${this.adminTicketPath()}?${query}`, { signal })
  }
  adminTicketSummary(signal?: AbortSignal) {
    return this.data<{ awaiting: number }>(this.adminTicketPath("summary"), "GET", undefined, signal)
  }
  adminTicketAssignees() {
    return this.data<import("./support").TicketCandidate[]>(this.adminTicketPath("assignees"))
  }
  adminTicket(ticket: string, signal?: AbortSignal) {
    return this.data<import("./support").AdminTicket>(this.adminTicketPath(ticket), "GET", undefined, signal)
  }
  updateAdminTicket(ticket: string, changes: import("./support").AdminTicketChanges) {
    return this.data<import("./support").AdminTicket>(this.adminTicketPath(ticket), "PATCH", changes)
  }
  async adminTicketMessage(
    ticket: string,
    values: { client_id: string; body: string; internal: boolean; status?: import("./support").TicketStatus; revision?: number },
    files: File[],
  ) {
    return (await this.request<ApiResponse<import("./support").AdminTicket>>(this.adminTicketPath(ticket, "/messages"), { method: "POST", body: this.ticketForm(values, files) })).data
  }
  markAdminTicketRead(ticket: string, sequence?: number) {
    return this.request<null>(this.adminTicketPath(ticket, "/read"), { method: "POST", body: JSON.stringify(sequence === undefined ? {} : { sequence }) })
  }
  adminTicketPeople(ticket: string, search: string) {
    return this.data<import("./support").TicketCandidate[]>(this.adminTicketPath(ticket, `/people?${new URLSearchParams({ search })}`))
  }
  addAdminTicketParticipant(ticket: string, userId: number) {
    return this.data<import("./support").AdminTicket>(this.adminTicketPath(ticket, `/participants/${userId}`), "PUT", {})
  }
  removeAdminTicketParticipant(ticket: string, userId: number) {
    return this.data<import("./support").AdminTicket>(this.adminTicketPath(ticket, `/participants/${userId}`), "DELETE")
  }
  deleteAdminTicket(ticket: string) {
    return this.request<null>(this.adminTicketPath(ticket), { method: "DELETE" })
  }
  adminTicketAttachmentUrl(ticket: string, attachment: string) {
    return `${this.baseUrl}${this.adminTicketPath(ticket, `/attachments/${encodeURIComponent(attachment)}`)}`
  }

  /**
   * Fetches and tells the connection store (spec 033, R8): any response is a success. fetch
   * rejects with a TypeError when no response arrived at all, which becomes ApiError(0);
   * an abort stays the caller's AbortError. `offline` in its payload says the page was
   * already offline when it sent the request, so the request never reached the server;
   * otherwise the response may have been lost after the server acted on it.
   */
  private async send(url: string, init: RequestInit): Promise<Response> {
    const offline = connection.getSnapshot().state === "offline"
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      connection.reportNetworkFailure()
      throw new ApiError(0, { message: "Unable to reach the server. Check your connection and try again.", offline })
    }
    connection.reportSuccess()
    return response
  }

  /**
   * A kept sign-in whose session lapsed (spec 033, FR-011a): the API checks the CSRF
   * token before the kept sign-in can resume, so the first change after hours idle gets
   * 419. A read resumes the session and renews the token cookie. False when nobody is
   * signed in here any more.
   */
  private async resume(): Promise<boolean> {
    try {
      return (await this.send(`${this.baseUrl}/api/v1/me`, { credentials: "include", headers: { Accept: "application/json" } })).ok
    } catch {
      return false
    }
  }

  private async request<T>(path: string, init: RequestInit = {}, resumed = false): Promise<T> {
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

    const response = await this.send(`${this.baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers,
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      // The refused request never ran, so it is sent once more with the renewed token.
      if (response.status === 419 && !resumed && !isGuestPath(path) && (await this.resume()))
        return this.request<T>(path, init, true)
      if ((response.status === 401 || response.status === 419) && !isGuestPath(path) && typeof window !== "undefined")
        window.dispatchEvent(new Event("iot-session-expired"))
      if (response.status === 423) throw new ConfirmationRequiredError(response.status, payload)
      if (response.status === 403 && (payload as { code?: unknown } | null)?.code === "two_step_setup_required") {
        if (typeof window !== "undefined") window.dispatchEvent(new Event(TWO_STEP_SETUP_REQUIRED_EVENT))
        throw new TwoStepSetupRequiredError(response.status, payload)
      }
      if (response.status === 403 && (payload as { code?: unknown } | null)?.code === "not_available_here" && !isGuestPath(path) && !path.startsWith("/api/v1/auth/") && typeof window !== "undefined")
        window.dispatchEvent(new Event(NOT_AVAILABLE_HERE_EVENT))
      if (response.status === 403 && (payload as { code?: unknown } | null)?.code === "sign_up_unconfirmed")
        throw new SignUpUnconfirmedError(response.status, payload)
      throw new ApiError(response.status, payload)
    }

    return payload as T
  }
}

export const apiClient = new ApiClient()

export type { DeviceOnboarding, OnboardingInput, DeviceConnectionKit } from './onboarding'

export { PLATFORM_NAME, productName, runtimeAddress, runtimeApiUrl, runtimeBrand, runtimeConfig, type RuntimeAddress, type RuntimeBrand, type RuntimeConfig } from "./runtime-config"
export * from "./connection"
