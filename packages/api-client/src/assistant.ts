import type { DeviceProfileCapabilities } from "./index"

export type AssistantSection =
  | "identity"
  | "parameters"
  | "groups"
  | "calculations"
export type AssistantValue =
  | null
  | string
  | number
  | boolean
  | AssistantValue[]
  | { [key: string]: AssistantValue }
export type AssistantChange = {
  operation: "upsert" | "remove"
  uuid?: string | null
  values: Record<string, AssistantValue>
}
export type AssistantSource = {
  id: string
  name: string
  mime: string
  size: number
  pages: number | null
}
export type AssistantQuestion = {
  id: string
  prompt: string
  required: boolean
  options: string[]
}
export type AssistantAnswer = { id: string; answer: string }
export type AssistantSaved = {
  profile_uuid: string
  profile_name: string
  draft_revision: number
}
export type AssistantProposal = {
  id: string
  section: AssistantSection
  summary: string
  status: "pending" | "superseded" | "dismissed" | "approved" | "applied"
  draft_revision: number | null
  content_hash: string
  changes: AssistantChange[]
  before: Record<string, AssistantValue>
  evidence: {
    field: string
    origin: "user_confirmed" | "source" | "suggested" | "unresolved"
    source_id?: string
    location?: string
    note?: string
  }[]
  diagnostics: {
    code: string
    message: string
    pointer?: string
    blocking?: boolean
  }[]
  result: AssistantSaved | null
  /** Orders proposal cards between messages; cards without it go last. */
  created_at?: string
}
export type AssistantRun = {
  id: string
  request_id: string
  status:
    | "queued"
    | "running"
    | "awaiting_approval"
    | "completed"
    | "failed"
    | "cancelled"
  prompt: string
  answer: string | null
  source_ids: string[]
  usage: Record<string, number> | null
  cost_usd: number
  error_code: string | null
  error_message: string | null
  created_at: string
}
export type AssistantConversation = {
  id: string
  title: string
  profile_uuid: string | null
  profile_name: string | null
  updated_at: string
}
export type AssistantDetail = AssistantConversation & {
  runs: AssistantRun[]
  sources: AssistantSource[]
  proposals: AssistantProposal[]
  onboarding_state: {
    questions?: AssistantQuestion[]
    answers?: AssistantAnswer[]
  } | null
  cursor: number
}
export type AssistantEvent = {
  id: number
  run_id: string | null
  type: string
  payload: {
    delta?: string
    status?: AssistantRun["status"]
    proposal_id?: string
    questions?: AssistantQuestion[]
    message?: string
  }
}
/** The AI provider replies come from, so screens can say where content is sent. */
export type AssistantProviderRef = { id: string; label: string }
export type AssistantSettings = {
  enabled: boolean
  provider: AssistantProviderRef
  capabilities: DeviceProfileCapabilities
  supported_extensions: string[]
  max_file_bytes: number
  schema: Record<string, unknown>
}
export type AssistantPreviewInput = Pick<
  AssistantProposal,
  "section" | "summary" | "changes" | "evidence"
>

/** A selectable model and its price in USD per million tokens (spec 010). */
export type AssistantModelOption = {
  id: string
  label: string
  input_usd_per_million: number
  output_usd_per_million: number
}
export type AssistantKeySource = "saved" | "environment"
export type AssistantProviderOption = {
  id: string
  label: string
  default_model: string
  models: AssistantModelOption[]
  /** Where the provider's key comes from; the key itself is never returned. */
  key: { source: AssistantKeySource | null; last_four: string | null; updated_at: string | null }
}
/** The admin AI assistant page, for super administrators. */
export type AssistantAdminSettings = {
  enabled: boolean
  help_enabled: boolean
  configured: boolean
  provider: string
  model: string
  daily_budget_usd: number
  run_budget_usd: number
  sources: { provider: AssistantKeySource; daily_budget_usd: AssistantKeySource; run_budget_usd: AssistantKeySource }
  revision: number
  updated_at: string | null
  today: { spent_usd: number; reserved_usd: number }
  providers: AssistantProviderOption[]
}
export type AssistantAdminSettingsInput = {
  provider: string
  model: string
  daily_budget_usd: number | null
  run_budget_usd: number | null
  revision: number
  /** A new key for the chosen provider; omit to keep the current one. */
  api_key?: string
}
export type AssistantConnectionTest = { ok: boolean; latency_ms: number | null; error: string | null }

/** A device onboarding assistant proposal (spec 020): reuse or create an adapter, or change its draft. */
export type OnboardingProposal = {
  uuid: string
  kind: "reuse" | "create" | "change"
  name: string | null
  artifact_uuid: string | null
  code: string | null
  source: Record<string, unknown> | null
  fixtures: Record<string, unknown>[] | null
  summary: string
  evidence: { origin: string; source_id?: string; location?: string; note?: string }[]
  content_hash: string
  draft_revision: number | null
  status: "pending" | "applied" | "rejected"
  adapter_uuid: string | null
  adapter_name: string | null
  created_at: string | null
}
export type OnboardingState = {
  questions?: AssistantQuestion[]
  answers?: AssistantAnswer[]
  path?: "direct" | "gateway" | "adapter" | null
  source_type?: "platform" | "vendor" | "webhook" | "poll" | null
  next_step?: { step: "credentials" | "secret" | "test" | "deploy" | "activate" | "cursor"; message: string; adapter_uuid: string; at: string } | null
  last_fetch?: { adapter_uuid: string; status: number | null; record_count: number; next_cursor: string | null; error: string | null; at: string } | null
}
export type OnboardingConversation = {
  id: string
  title: string
  scope: "onboarding"
  adapter_uuid: string | null
  profile_uuid: string | null
  profile_name: string | null
  updated_at: string
}
export type OnboardingDetail = OnboardingConversation & {
  runs: AssistantRun[]
  sources: AssistantSource[]
  proposals: AssistantProposal[]
  adapter_proposals: OnboardingProposal[]
  onboarding_state: OnboardingState | null
  cursor: number
}
