import { ApiError, ConfirmationRequiredError, type ApiClient, type AuthenticatedUser } from "@iot-os/api-client"
import {
  InvalidDomainError,
  NotSupportedError,
  PasskeyExistsError,
  Passkeys,
  ServerError,
  UserCancelledError,
} from "@laravel/passkeys"

/**
 * Passkey ceremonies against the API (spec 034, research R4). `@laravel/passkeys` runs
 * the browser side and posts to our routes with the session cookie; failures become the
 * API client's errors, so a `423` opens the confirmation dialog like any other change.
 */

let configured = false
function configure() {
  if (configured) return
  // The API is on another origin than the apps, so the session cookie must go with it.
  Passkeys.configure({ fetch: { credentials: "include" } })
  configured = true
}

/** Whether this browser can use passkeys at all. */
export function passkeysSupported(): boolean {
  return Passkeys.isSupported()
}

/** The deployment cannot offer passkeys (the options route answered `404`). */
export class PasskeysUnavailableError extends Error {
  constructor() {
    super("Passkeys are not available here.")
  }
}

/** Sign in with a passkey alone. It counts as both steps and replaces a pending sign-in. */
export async function signInWithPasskey(apiClient: ApiClient, remember: boolean): Promise<AuthenticatedUser> {
  configure()
  // The answer is a POST, which needs the CSRF cookie a guest may not have yet.
  await apiClient.csrf()
  const { signIn } = apiClient.passkeyEndpoints()
  const response = await run(() => Passkeys.verify({ remember, routes: signIn }))
  return (response as unknown as { data: AuthenticatedUser }).data
}

/**
 * Show the browser's saved passkeys in the email field's suggestions (conditional UI).
 * Resolves with the person when they pick one, or null when the browser cannot or they
 * do not. Stop it with {@link cancelPasskey}.
 */
export async function offerPasskeyAutofill(apiClient: ApiClient, remember: () => boolean): Promise<AuthenticatedUser | null> {
  configure()
  if (!(await Passkeys.isAutofillSupported())) return null
  await apiClient.csrf()
  const { signIn } = apiClient.passkeyEndpoints()
  const response = await run(() => Passkeys.autofill({ remember, routes: signIn }))
  return response ? (response as unknown as { data: AuthenticatedUser }).data : null
}

/** Confirm the signed-in person with one of their passkeys instead of their password. */
export async function confirmWithPasskey(apiClient: ApiClient): Promise<void> {
  configure()
  await run(() => Passkeys.verify({ routes: apiClient.passkeyEndpoints().confirm }))
}

/** Add a passkey with a name. Needs a confirmed password or passkey (`423`). */
export async function addPasskey(apiClient: ApiClient, name: string): Promise<void> {
  configure()
  await run(() => Passkeys.register({ name, routes: apiClient.passkeyEndpoints().register }))
}

/** Stop a ceremony in progress, such as the email field's suggestions. */
export function cancelPasskey(): void {
  Passkeys.cancel()
}

async function run<T>(ceremony: () => Promise<T>): Promise<T> {
  try {
    return await ceremony()
  } catch (error) {
    if (error instanceof ServerError) {
      if (error.status === 404) throw new PasskeysUnavailableError()
      if (error.status === 423) throw new ConfirmationRequiredError(423, { message: error.message })
      throw new ApiError(error.status, { message: error.message })
    }
    throw error
  }
}

/**
 * What to tell the person, or null when there is nothing to say: they closed the
 * browser's prompt or it timed out.
 */
export function passkeyProblem(error: unknown, action: "sign_in" | "confirm" | "add"): string | null {
  if (error instanceof UserCancelledError) return null
  if (error instanceof PasskeysUnavailableError) return "Passkeys can only be used when this site is served over HTTPS."
  if (error instanceof NotSupportedError) return "This browser does not support passkeys."
  if (error instanceof PasskeyExistsError) return "This passkey is already added to your account."
  if (error instanceof InvalidDomainError) return "Passkeys do not work on this address."
  if (error instanceof ApiError) {
    if (error.status === 429) return "Too many tries. Wait a minute and try again."
    if (error.status === 419) return "This page was open too long. Reload it and try again."
    const message = (error.payload as { message?: string } | null)?.message
    if (error.status === 422 && message) return message
  }
  if (error instanceof Error && error.cause instanceof TypeError) return "You are offline. Check your connection and try again."
  return action === "add"
    ? "We could not add that passkey. Please try again."
    : action === "confirm"
      ? "We could not check that passkey. Please try again."
      : "We could not sign you in with that passkey. Please try again."
}
