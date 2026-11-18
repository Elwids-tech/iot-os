/** Self sign-up (spec 035, specs/035-self-sign-up/contracts/sign-up-api.md). */

/** What the sign-up page needs before showing the form. */
export type SignUpConfig = {
  open: boolean
  /** The deployment is a free beta: say nothing is charged (FR-031). */
  free_beta: boolean
  /** Present only while sign-up is open; sent back with the form. */
  form_token: string | null
  password_min: number
}

export type SignUpInput = {
  name: string
  email: string
  password: string
  password_confirmation: string
  organization_name: string
  form_token: string | null
  /** The hidden field people never fill. */
  website: string
}

/** The browser's sign-up, as the waiting page polls it. */
export type SignUpStatus =
  | { state: "waiting"; email: string; resend_after: number }
  | { state: "completed"; signed_in: boolean; organization_uuid: string; email: string }
  | { state: "refused"; reason: string; email: string }

/** A link opened: completed, and whether this browser is now signed in. */
export type SignUpConfirmation = { state: "completed"; signed_in: boolean; organization_uuid: string; email: string }

/** Why a link cannot complete a sign-up (`410` or `409`). */
export type SignUpLinkProblem = "used" | "expired" | "account_exists"

export type SignUpSettings = {
  open: boolean
  free_beta: boolean
  notify_push: boolean
  notify_email: boolean
  daily_limit: number
  revision: number
  updated_at: string | null
  updated_by: { user_id: number; name: string } | null
  /** False without the deployment's push key. */
  push_available: boolean
  /** False when mail only goes to the log. */
  mail_available: boolean
  /** The signed-in super administrator's own push devices. */
  my_push_devices: number
  today: { started: number; limit: number }
}

export type SignUpSettingsValues = Pick<SignUpSettings, "open" | "free_beta" | "notify_push" | "notify_email" | "daily_limit" | "revision">

export type SignUpState = "waiting" | "expired" | "completed" | "refused"

export type SignUpRecord = {
  uuid: string
  name: string
  email: string
  organization_name: string
  state: SignUpState
  refusal_reason: "honeypot" | "too_fast" | "form_expired" | "paused" | "account_exists" | null
  sends: number
  created_at: string
  completed_at: string | null
  organization: { uuid: string; name: string } | null
  user_id: number | null
  ip_address: string | null
}

export type SignUpQuery = { state?: SignUpState; search?: string; page?: number; perPage?: number }
