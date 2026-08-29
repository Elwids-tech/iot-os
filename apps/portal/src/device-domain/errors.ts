import { ApiError } from "@iot-os/api-client"

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstMessage(payload: unknown): string | null {
  const root = record(payload)
  if (!root) return null

  if (typeof root.message === "string" && root.message.trim()) return root.message

  const errors = record(root.errors)
  if (errors) {
    for (const value of Object.values(errors)) {
      if (Array.isArray(value) && typeof value[0] === "string") return value[0]
      if (typeof value === "string") return value
    }
  }

  const data = record(root.data)
  const diagnostics = Array.isArray(data?.diagnostics) ? data.diagnostics : []
  const diagnostic = record(diagnostics[0])
  return typeof diagnostic?.message === "string" ? diagnostic.message : null
}

export function deviceDomainError(reason: unknown, action: string): string {
  if (reason instanceof ApiError) {
    if (reason.status === 412) {
      return `${action} was not applied because this resource changed in another session. Reload the catalogs and review the latest revision.`
    }
    if (reason.status === 403) return `You do not have permission to ${action.toLowerCase()}.`
    if (reason.status === 404) return `${action} could not find one of the selected tenant resources.`
    if (reason.status === 409) {
      return firstMessage(reason.payload) ?? `${action} conflicts with the current lifecycle state.`
    }
    if (reason.status === 422) {
      return firstMessage(reason.payload) ?? `${action} failed contract validation.`
    }

    return firstMessage(reason.payload) ?? `${action} failed with API status ${reason.status}.`
  }

  return reason instanceof Error ? reason.message : `${action} failed unexpectedly.`
}
