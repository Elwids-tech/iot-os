/** Two-step sign-in (spec 034): the person's own sign-in security. */

/** How a pending sign-in may be finished. */
export type TwoStepMethod = "code" | "recovery_code" | "passkey"

export type TwoStepRequirement = "platform" | { organization: string; name: string }

export type SecuritySettings = {
  two_step: {
    enabled: boolean
    confirmed_at: string | null
    recovery_codes_remaining: number
    /** Whether the person must use two-step sign-in, and why. */
    required: boolean
    required_by: TwoStepRequirement[]
    /** Whether the person has a second step set up. */
    satisfied: boolean
  }
}

/** A new setup secret. Show `qr_svg` as an image, never as HTML. */
export type TwoStepSetup = {
  qr_svg: string
  /** The secret in groups of four, to type into an authenticator app. */
  setup_key: string
  otpauth_url: string
}

/** Either a six-digit code from the authenticator app, or a recovery code. */
export type TwoStepAnswer = { code: string } | { recoveryCode: string }

/** An organization's sign-in security (spec 034, FR-021). */
export type OrganizationSecurity = {
  /** Every member must use two-step sign-in. */
  two_step_required: boolean
  /** Members who have no second step set up. */
  members_without_two_step: number
  /** Whether the viewer may change it: their own second step is set up. */
  can_change: boolean
}
