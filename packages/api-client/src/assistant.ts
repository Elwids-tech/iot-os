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
export type AssistantSettings = {
  enabled: boolean
  capabilities: DeviceProfileCapabilities
  supported_extensions: string[]
  max_file_bytes: number
  schema: Record<string, unknown>
}
export type AssistantPreviewInput = Pick<
  AssistantProposal,
  "section" | "summary" | "changes" | "evidence"
>
