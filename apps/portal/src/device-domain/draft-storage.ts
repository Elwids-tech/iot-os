import type { DefinitionFormState } from "./definition-template"

const DEFINITION_DRAFT_VERSION = 1
const DEVICE_DRAFT_VERSION = 1

export type StoredDefinitionDraft = {
  form: DefinitionFormState
  bindingVersionUuid?: string
  etag?: string
}

export type StoredDeviceDraft = {
  name: string
  externalId: string
  description: string
  bindingVersionUuid: string
  deviceUuid?: string
}

function definitionKey(organizationUuid: string): string {
  return `iot-os.definition-authoring:v${DEFINITION_DRAFT_VERSION}:${organizationUuid}`
}

function deviceKey(organizationUuid: string): string {
  return `iot-os.device-onboarding:v${DEVICE_DRAFT_VERSION}:${organizationUuid}`
}

function read<T>(key: string, version: number): T | null {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null")

    if (!stored || typeof stored !== "object" || !("version" in stored)) return null
    if (stored.version !== version || !("value" in stored)) return null

    return stored.value as T
  } catch {
    return null
  }
}

function write<T>(key: string, version: number, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ version, value }))
  } catch {
    // Draft persistence is a convenience; authoring remains usable when storage is unavailable.
  }
}

export function loadDefinitionDraft(organizationUuid: string): StoredDefinitionDraft | null {
  return read(definitionKey(organizationUuid), DEFINITION_DRAFT_VERSION)
}

export function saveDefinitionDraft(
  organizationUuid: string,
  draft: StoredDefinitionDraft,
): void {
  write(definitionKey(organizationUuid), DEFINITION_DRAFT_VERSION, draft)
}

export function clearDefinitionDraft(organizationUuid: string): void {
  try {
    window.localStorage.removeItem(definitionKey(organizationUuid))
  } catch {
    // Nothing else is required when local storage is unavailable.
  }
}

export function loadDeviceDraft(organizationUuid: string): StoredDeviceDraft | null {
  return read(deviceKey(organizationUuid), DEVICE_DRAFT_VERSION)
}

export function saveDeviceDraft(organizationUuid: string, draft: StoredDeviceDraft): void {
  write(deviceKey(organizationUuid), DEVICE_DRAFT_VERSION, draft)
}

export function clearDeviceDraft(organizationUuid: string): void {
  try {
    window.localStorage.removeItem(deviceKey(organizationUuid))
  } catch {
    // Nothing else is required when local storage is unavailable.
  }
}
