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
  passkeys: {
    /** Whether passkeys can be used on this deployment (both front ends on HTTPS, or localhost). */
    available: boolean
    unavailable_reason: PasskeyUnavailableReason | null
    items: Passkey[]
  }
}

/** Why the deployment cannot offer passkeys; the browser's own support is checked by the client. */
export type PasskeyUnavailableReason = "not_https"

/** One of the person's passkeys. Its credential never leaves the API. */
export type Passkey = {
  id: number
  name: string
  created_at: string | null
  last_used_at: string | null
}

/**
 * Absolute URLs of the WebAuthn ceremonies (spec 034). The browser client
 * (`@laravel/passkeys`) fetches the options and posts the answer itself.
 */
export type PasskeyEndpoints = Record<"signIn" | "confirm" | "register", { options: string; submit: string }>

/** A new setup secret. Show `qr_svg` as an image, never as HTML. */
export type TwoStepSetup = {
  qr_svg: string
  /** The secret in groups of four, to type into an authenticator app. */
  setup_key: string
  otpauth_url: string
}

/** Either a six-digit code from the authenticator app, or a recovery code. */
export type TwoStepAnswer = { code: string } | { recoveryCode: string }
