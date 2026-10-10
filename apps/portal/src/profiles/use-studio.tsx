import {
  createContext,
  useContext,
  useState,
  useRef,
  type ReactNode,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { toast } from "sonner"
import type {
  DeviceProfileCapabilities,
  DeviceProfileDetail,
} from "@iot-os/api-client"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { Button } from "@iot-os/ui/components/button"
import { Skeleton } from "@iot-os/ui/components/skeleton"
export const noCapabilities: DeviceProfileCapabilities = {
  view_any: false,
  view: false,
  create: false,
  update: false,
  delete_draft: false,
  validate: false,
  publish: false,
}
export function useOrganization() {
  const { organizationUuid = "" } = useParams()
  const query = useQuery({
    queryKey: ["organization", organizationUuid],
    queryFn: () => api.organizationContext(organizationUuid),
    enabled: Boolean(organizationUuid),
  })
  return {
    ...query,
    organizationUuid,
    capabilities: query.data?.capabilities?.device_profiles ?? noCapabilities,
  }
}
type StudioContextValue = {
  org: string
  profile: DeviceProfileDetail
  capabilities: DeviceProfileCapabilities
  busy: boolean
  blocked: boolean
  perform: (operation: () => Promise<unknown>) => Promise<void>
  reload: () => Promise<DeviceProfileDetail>
}
const StudioContext = createContext<StudioContextValue | null>(null)
export function StudioProvider({ children }: { children: ReactNode }) {
  const { profileUuid = "" } = useParams()
  const organization = useOrganization()
  const cache = useQueryClient()
  const key = ["profile", organization.organizationUuid, profileUuid]
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api.deviceProfile(organization.organizationUuid, profileUuid),
    enabled: organization.capabilities.view,
  })
  const [busy, setBusy] = useState(false)
  const mutationInFlight = useRef(false)
  const [refreshError, setRefreshError] = useState<unknown>(null)
  async function reload() {
    const profile = await cache.fetchQuery({
      queryKey: key,
      queryFn: () =>
        api.deviceProfile(organization.organizationUuid, profileUuid),
      staleTime: 0,
    })
    setRefreshError(null)
    return profile
  }
  async function perform(operation: () => Promise<unknown>) {
    if (mutationInFlight.current || refreshError)
      throw new Error("Refresh this draft before making another change.")
    mutationInFlight.current = true
    setBusy(true)
    try {
      await operation()
      try {
        await reload()
      } catch (error) {
        setRefreshError(error)
      }
      await cache.invalidateQueries({
        queryKey: ["profiles", organization.organizationUuid],
      })
      await cache.invalidateQueries({
        queryKey: ["artifacts", organization.organizationUuid, profileUuid],
      })
      toast.success("Saved to your organization")
    } finally {
      mutationInFlight.current = false
      setBusy(false)
    }
  }
  const unavailable = (body: ReactNode) => (
    <>
      <PageHeader
        title="Device profile"
        back={{
          to: "/organizations/" + organization.organizationUuid + "/device-profiles",
          label: "Device profiles",
        }}
      />
      <div className="flex flex-col gap-4 p-4 md:p-6">{body}</div>
    </>
  )
  if (organization.error)
    return unavailable(
      <RequestError error={organization.error}>
        <Button variant="outline" onClick={() => organization.refetch()}>
          Retry organization access
        </Button>
      </RequestError>,
    )
  if (
    organization.isPending ||
    (organization.capabilities.view && query.isPending)
  )
    return unavailable(
      <div className="flex flex-col gap-4" aria-label="Loading profile">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-80 w-full" />
      </div>,
    )
  if (!organization.capabilities.view)
    return unavailable(
      <RequestError
        error={
          new Error(
            "You do not have permission to view device profiles in this organization.",
          )
        }
      />,
    )
  if (!query.data)
    return unavailable(
      <RequestError error={query.error}>
        <Button onClick={() => query.refetch()} variant="outline">
          Retry
        </Button>
      </RequestError>,
    )
  return (
    <StudioContext.Provider
      value={{
        org: organization.organizationUuid,
        profile: query.data,
        capabilities: organization.capabilities,
        busy,
        blocked: Boolean(refreshError),
        perform,
        reload,
      }}
    >
      {Boolean(refreshError) && (
        <div className="p-4 md:px-6">
          <RequestError
            error={
              new Error(
                "Your change was saved, but the updated draft could not be loaded. Refresh before editing again.",
              )
            }
          >
            <Button
              variant="outline"
              onClick={() => reload().catch(setRefreshError)}
            >
              Refresh saved draft
            </Button>
          </RequestError>
        </div>
      )}
      {children}
    </StudioContext.Provider>
  )
}
export function useStudio() {
  const studio = useContext(StudioContext)
  if (!studio) throw new Error("Studio provider is required.")
  return studio
}
/**
 * Validation and compiled draft for the current saved draft revision. Kept in the query
 * cache per draft revision, so switching tabs keeps it and any save makes it outdated.
 */
export function useProfileValidation() {
  const { org, profile } = useStudio()
  const cache = useQueryClient()
  const key = [
    "profile-validation",
    org,
    profile.uuid,
    profile.draft_revision,
  ]
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const validation = await api.validateDeviceProfile(
        org,
        profile.uuid,
        profile.draft_revision,
      )
      return {
        validation,
        compiled: validation.valid
          ? await api.compileDeviceProfile(
              org,
              profile.uuid,
              profile.draft_revision,
            )
          : null,
      }
    },
    enabled: false,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  })
  return {
    ...query,
    ready: Boolean(
      query.data?.compiled && profile.status === "draft",
    ),
    validate: () => query.refetch(),
    clear: () => cache.removeQueries({ queryKey: key }),
  }
}
/** Why Publish is unavailable, or null when it can run. */
export function publishBlocker(
  studio: ReturnType<typeof useStudio>,
  check: ReturnType<typeof useProfileValidation>,
) {
  const { profile } = studio
  if (!studio.capabilities.publish) return "Your role can't publish profiles"
  if (profile.status === "archived") return "Archived profiles can't be published"
  if (profile.status === "published")
    return "No changes since version " + profile.revision
  if (studio.busy || check.isFetching) return "Wait for the current action"
  if (studio.blocked) return "Refresh the saved draft first"
  if (!check.data) return "Validate the saved draft first"
  if (!check.ready)
    return (
      "Resolve " +
      check.data.validation.diagnostics.length +
      " issue" +
      (check.data.validation.diagnostics.length === 1 ? "" : "s") +
      " and validate again"
    )
  return null
}
