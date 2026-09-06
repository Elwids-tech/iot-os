import {
  createContext,
  useContext,
  useState,
  useRef,
  type ReactNode,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
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
  if (organization.error)
    return (
      <RequestError error={organization.error}>
        <Button variant="outline" onClick={() => organization.refetch()}>
          Retry organization access
        </Button>
      </RequestError>
    )
  if (
    organization.isPending ||
    (organization.capabilities.view && query.isPending)
  )
    return (
      <div className="flex flex-col gap-4" aria-label="Loading profile">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  if (!organization.capabilities.view)
    return (
      <RequestError
        error={
          new Error(
            "You do not have permission to view device profiles in this organization.",
          )
        }
      />
    )
  if (!query.data)
    return (
      <div className="flex flex-col gap-4">
        <RequestError error={query.error} />
        <Button onClick={() => query.refetch()} variant="outline">
          Retry
        </Button>
      </div>
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
