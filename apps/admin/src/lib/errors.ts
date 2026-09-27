import { ApiError } from "@iot-os/api-client"

/** Laravel 422 field errors keyed by field, or null for any other failure. */
export function validationErrors(error: unknown): Record<string, string[]> | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null
  return (error.payload as { errors?: Record<string, string[]> } | null)?.errors ?? {}
}

/** Messages for a field, including array item keys such as `role_ids.0`. */
export function fieldMessages(errors: Record<string, string[]> | null, field: string): string[] | undefined {
  if (!errors) return undefined
  const messages = Object.entries(errors)
    .filter(([key]) => key === field || key.startsWith(`${field}.`))
    .flatMap(([, value]) => value)
  return messages.length ? messages : undefined
}

/** The API's message for a failed request, or a generic retry hint. */
export function errorMessage(error: unknown): string {
  const message =
    error instanceof ApiError ? (error.payload as { message?: string } | null)?.message : undefined
  return message || "The request failed. Try again."
}
