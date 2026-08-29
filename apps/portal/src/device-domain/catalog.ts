import type {
  DeviceProfile,
  DeviceProfileVersion,
  TransportBinding,
  TransportBindingVersion,
} from "@iot-os/api-client"
import { apiClient } from "../lib/api-client"

export type DefinitionCatalogEntry = {
  profile: DeviceProfile
  profileVersion: DeviceProfileVersion
  binding: TransportBinding
  bindingVersion: TransportBindingVersion
}

export type DefinitionCatalog = {
  entries: DefinitionCatalogEntry[]
  unboundProfiles: DeviceProfile[]
}

function newestFirst<T extends { version: number }>(versions: T[]): T[] {
  return [...versions].sort((left, right) => right.version - left.version)
}

export async function loadDefinitionCatalog(): Promise<DefinitionCatalog> {
  const [profilePage, bindingPage] = await Promise.all([
    apiClient.deviceProfiles({ perPage: 100 }),
    apiClient.transportBindings({ perPage: 100 }),
  ])

  const [profiles, bindings] = await Promise.all([
    Promise.all(profilePage.data.map((profile) => apiClient.deviceProfile(profile.uuid))),
    Promise.all(bindingPage.data.map((binding) => apiClient.transportBinding(binding.uuid))),
  ])

  const profilesByUuid = new Map(profiles.map((profile) => [profile.uuid, profile]))
  const entries = bindings.flatMap((binding) => {
    const profile = profilesByUuid.get(binding.profile_uuid)

    if (!profile) return []

    const versionsByUuid = new Map(
      (profile.versions ?? []).map((version) => [version.uuid, version]),
    )

    return newestFirst(binding.versions ?? []).flatMap((bindingVersion) => {
      const profileVersion = versionsByUuid.get(bindingVersion.profile_version_uuid)

      return profileVersion ? [{ profile, profileVersion, binding, bindingVersion }] : []
    })
  })
  const boundProfileUuids = new Set(bindings.map((binding) => binding.profile_uuid))

  return {
    entries,
    unboundProfiles: profiles.filter((profile) => !boundProfileUuids.has(profile.uuid)),
  }
}

export function publishedDefinitions(catalog: DefinitionCatalog): DefinitionCatalogEntry[] {
  return catalog.entries.filter(
    (entry) =>
      entry.profileVersion.state === "published" && entry.bindingVersion.state === "published",
  )
}
