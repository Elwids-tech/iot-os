import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import type {
  DeviceProfileDocument,
  DeviceProfileResource,
  DeviceResource,
  GatewayResource,
  GatewayRouteResource,
  NativeMqttBindingDocument,
  NativeMqttBindingResource,
  Organization,
} from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { Spinner } from "@iot-os/ui/components/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"
import { AlertTriangleIcon, CheckCircle2Icon, RefreshCwIcon } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import { deviceDomainError } from "../device-domain/errors"
import { createBinding, createProfile, synchronizeBinding } from "../device-domain/model"
import { apiClient } from "../lib/api-client"

const ProfileEditor = lazy(() =>
  import("../device-domain/ProfileEditor").then((module) => ({ default: module.ProfileEditor })),
)
const BindingEditor = lazy(() =>
  import("../device-domain/BindingEditor").then((module) => ({ default: module.BindingEditor })),
)
const OnboardingFlow = lazy(() =>
  import("../device-domain/OnboardingFlow").then((module) => ({ default: module.OnboardingFlow })),
)

type Catalogs = {
  profiles: DeviceProfileResource[]
  bindings: NativeMqttBindingResource[]
  devices: DeviceResource[]
  gateways: GatewayResource[]
  routes: GatewayRouteResource[]
}

const EMPTY_CATALOGS: Catalogs = {
  profiles: [],
  bindings: [],
  devices: [],
  gateways: [],
  routes: [],
}

async function fetchCatalogs(): Promise<Catalogs> {
  const [profiles, bindings, devices, gateways, routes] = await Promise.all([
    apiClient.deviceProfiles(),
    apiClient.nativeMqttBindings(),
    apiClient.devices(),
    apiClient.gateways(),
    apiClient.gatewayRoutes(),
  ])

  return {
    profiles: profiles.data,
    bindings: bindings.data,
    devices: devices.data,
    gateways: gateways.data,
    routes: routes.data,
  }
}

function profileDocument(resource: DeviceProfileResource): DeviceProfileDocument | null {
  if (!resource.version) return null
  return { schema: resource.schema, profile: resource.profile, version: resource.version }
}

function bindingDocument(resource: NativeMqttBindingResource): NativeMqttBindingDocument | null {
  if (!resource.version) return null
  return { schema: resource.schema, binding: resource.binding, version: resource.version }
}

function upsert<T>(items: T[], next: T, matches: (item: T) => boolean): T[] {
  const index = items.findIndex(matches)
  if (index === -1) return [next, ...items]
  return items.map((item, itemIndex) => (itemIndex === index ? next : item))
}

function EditorLoading({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner /> Loading {label}…
      </CardContent>
    </Card>
  )
}

export function DeviceDomainPage() {
  const organization = useOutletContext<Organization>()
  const [catalogs, setCatalogs] = useState<Catalogs>(EMPTY_CATALOGS)
  const [loading, setLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [profileDraft, setProfileDraft] = useState<DeviceProfileDocument>(() => createProfile())
  const [selectedProfileUuid, setSelectedProfileUuid] = useState<string | null>(null)
  const [profileEtag, setProfileEtag] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)

  const [bindingDraft, setBindingDraft] = useState<NativeMqttBindingDocument | null>(null)
  const [selectedBindingUuid, setSelectedBindingUuid] = useState<string | null>(null)
  const [bindingEtag, setBindingEtag] = useState<string | null>(null)
  const [bindingError, setBindingError] = useState<string | null>(null)
  const [savingBinding, setSavingBinding] = useState(false)

  const selectedProfile =
    catalogs.profiles.find((profile) => profile.profile.uuid === selectedProfileUuid) ?? null
  const selectedBinding =
    catalogs.bindings.find((binding) => binding.binding.uuid === selectedBindingUuid) ?? null

  const refreshCatalogs = useCallback(async () => {
    const next = await fetchCatalogs()
    setCatalogs(next)
    setCatalogError(null)
    return next
  }, [organization.uuid])

  const refreshFlowCatalogs = useCallback(async () => {
    await refreshCatalogs()
  }, [refreshCatalogs])

  useEffect(() => {
    let active = true
    setLoading(true)
    setCatalogError(null)
    setCatalogs(EMPTY_CATALOGS)
    setMessage(null)
    setProfileDraft(createProfile())
    setSelectedProfileUuid(null)
    setProfileEtag(null)
    setProfileError(null)
    setBindingDraft(null)
    setSelectedBindingUuid(null)
    setBindingEtag(null)
    setBindingError(null)

    fetchCatalogs()
      .then((next) => {
        if (active) setCatalogs(next)
      })
      .catch((reason) => {
        if (active) setCatalogError(deviceDomainError(reason, "Load Device Domain catalogs"))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [organization.uuid])

  async function reloadFromServer() {
    setLoading(true)
    setMessage(null)
    try {
      const next = await refreshCatalogs()
      if (selectedProfileUuid) {
        const resource = next.profiles.find((item) => item.profile.uuid === selectedProfileUuid)
        const document = resource ? profileDocument(resource) : null
        if (resource && document) {
          setProfileDraft(document)
          setProfileEtag(resource.meta.etag)
          setProfileError(null)
        }
      }
      if (selectedBindingUuid) {
        const resource = next.bindings.find((item) => item.binding.uuid === selectedBindingUuid)
        const document = resource ? bindingDocument(resource) : null
        if (resource && document) {
          setBindingDraft(document)
          setBindingEtag(resource.meta.etag)
          setBindingError(null)
        }
      }
      setMessage("Catalogs reloaded from the tenant API.")
    } catch (reason) {
      setCatalogError(deviceDomainError(reason, "Reload Device Domain catalogs"))
    } finally {
      setLoading(false)
    }
  }

  function newProfile() {
    setProfileDraft(createProfile())
    setSelectedProfileUuid(null)
    setProfileEtag(null)
    setProfileError(null)
    setMessage(null)
  }

  function selectProfile(uuid: string) {
    const resource = catalogs.profiles.find((item) => item.profile.uuid === uuid)
    const document = resource ? profileDocument(resource) : null
    if (!resource || !document) return
    setSelectedProfileUuid(uuid)
    setProfileDraft(document)
    setProfileEtag(resource.meta.etag)
    setProfileError(null)
    setMessage(null)
  }

  async function saveProfile(draft: DeviceProfileDocument) {
    setSavingProfile(true)
    setProfileError(null)
    setMessage(null)
    try {
      const replacing = selectedProfileUuid === draft.profile.uuid && profileEtag
      const resource = replacing
        ? await apiClient.replaceDeviceProfile(draft.profile.uuid, draft, profileEtag)
        : await apiClient.createDeviceProfile(draft)
      setCatalogs((current) => ({
        ...current,
        profiles: upsert(current.profiles, resource, (item) => item.profile.uuid === resource.profile.uuid),
      }))
      const document = profileDocument(resource)
      if (document) setProfileDraft(document)
      setSelectedProfileUuid(resource.profile.uuid)
      setProfileEtag(resource.meta.etag)
      setMessage(`${resource.profile.name} saved as a ${resource.meta.state ?? "draft"} Profile.`)
    } catch (reason) {
      setProfileError(deviceDomainError(reason, "Save Device Profile"))
    } finally {
      setSavingProfile(false)
    }
  }

  async function deleteProfile() {
    if (!selectedProfileUuid || !profileEtag) return
    setSavingProfile(true)
    setProfileError(null)
    try {
      await apiClient.deleteDeviceProfile(selectedProfileUuid, profileEtag)
      setCatalogs((current) => ({
        ...current,
        profiles: current.profiles.filter((item) => item.profile.uuid !== selectedProfileUuid),
      }))
      newProfile()
      setMessage("The unreferenced Profile draft was deleted.")
    } catch (reason) {
      setProfileError(deviceDomainError(reason, "Delete Device Profile"))
    } finally {
      setSavingProfile(false)
    }
  }

  function newBinding(profile: DeviceProfileDocument) {
    setBindingDraft(synchronizeBinding(createBinding(profile), profile))
    setSelectedBindingUuid(null)
    setBindingEtag(null)
    setBindingError(null)
    setMessage(null)
  }

  function selectBinding(uuid: string) {
    const resource = catalogs.bindings.find((item) => item.binding.uuid === uuid)
    const document = resource ? bindingDocument(resource) : null
    if (!resource || !document) return
    setSelectedBindingUuid(uuid)
    setBindingDraft(document)
    setBindingEtag(resource.meta.etag)
    setBindingError(null)
    setMessage(null)
  }

  async function saveBinding(draft: NativeMqttBindingDocument) {
    setSavingBinding(true)
    setBindingError(null)
    setMessage(null)
    try {
      const replacing = selectedBindingUuid === draft.binding.uuid && bindingEtag
      const resource = replacing
        ? await apiClient.replaceNativeMqttBinding(draft.binding.uuid, draft, bindingEtag)
        : await apiClient.createNativeMqttBinding(draft)
      setCatalogs((current) => ({
        ...current,
        bindings: upsert(current.bindings, resource, (item) => item.binding.uuid === resource.binding.uuid),
      }))
      const document = bindingDocument(resource)
      if (document) setBindingDraft(document)
      setSelectedBindingUuid(resource.binding.uuid)
      setBindingEtag(resource.meta.etag)
      setMessage(`${resource.binding.name} saved as a ${resource.meta.state ?? "draft"} Binding.`)
    } catch (reason) {
      setBindingError(deviceDomainError(reason, "Save Native MQTT Binding"))
    } finally {
      setSavingBinding(false)
    }
  }

  async function deleteBinding() {
    if (!selectedBindingUuid || !bindingEtag) return
    setSavingBinding(true)
    setBindingError(null)
    try {
      await apiClient.deleteNativeMqttBinding(selectedBindingUuid, bindingEtag)
      setCatalogs((current) => ({
        ...current,
        bindings: current.bindings.filter((item) => item.binding.uuid !== selectedBindingUuid),
      }))
      setBindingDraft(null)
      setSelectedBindingUuid(null)
      setBindingEtag(null)
      setMessage("The unreferenced Binding draft was deleted.")
    } catch (reason) {
      setBindingError(deviceDomainError(reason, "Delete Native MQTT Binding"))
    } finally {
      setSavingBinding(false)
    }
  }

  const hasLoadedCatalogs = catalogs !== EMPTY_CATALOGS

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted-foreground">{organization.name}</p>
            <h1 className="text-3xl font-semibold tracking-tight">Device Domain</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Define stable logical Device semantics, map compact Gateway MQTT payloads, validate real fixtures, and explicitly publish and register immutable assignments.
            </p>
          </div>
          <Button type="button" variant="outline" disabled={loading} onClick={() => void reloadFromServer()}>
            {loading ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
            Reload catalogs
          </Button>
        </div>

        {catalogError ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Device Domain is unavailable</AlertTitle>
            <AlertDescription>{catalogError}</AlertDescription>
          </Alert>
        ) : null}
        {message ? (
          <Alert>
            <CheckCircle2Icon />
            <AlertTitle>Change saved</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        {loading && !hasLoadedCatalogs ? (
          <Card>
            <CardHeader>
              <CardTitle>Loading Device Domain</CardTitle>
              <CardDescription>Fetching Profile, Binding, Gateway, Route, and Device catalogs in parallel.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Loading tenant resources…
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="profiles" className="flex flex-col gap-6">
            <TabsList className="h-auto w-full justify-start overflow-x-auto">
              <TabsTrigger value="profiles">Profiles <Badge variant="outline">{catalogs.profiles.length}</Badge></TabsTrigger>
              <TabsTrigger value="bindings">MQTT Bindings <Badge variant="outline">{catalogs.bindings.length}</Badge></TabsTrigger>
              <TabsTrigger value="onboarding">Onboarding <Badge variant="outline">{catalogs.devices.length}</Badge></TabsTrigger>
            </TabsList>
            <TabsContent value="profiles">
              <Suspense fallback={<EditorLoading label="Profile editor" />}>
                <ProfileEditor
                  profiles={catalogs.profiles}
                  draft={profileDraft}
                  selectedUuid={selectedProfileUuid}
                  selectedResource={selectedProfile}
                  error={profileError}
                  saving={savingProfile}
                  onDraftChange={setProfileDraft}
                  onSelect={selectProfile}
                  onNew={newProfile}
                  onSave={saveProfile}
                  onDelete={deleteProfile}
                />
              </Suspense>
            </TabsContent>
            <TabsContent value="bindings">
              <Suspense fallback={<EditorLoading label="MQTT Binding editor" />}>
                <BindingEditor
                  profiles={catalogs.profiles}
                  bindings={catalogs.bindings}
                  draft={bindingDraft}
                  selectedUuid={selectedBindingUuid}
                  selectedResource={selectedBinding}
                  error={bindingError}
                  saving={savingBinding}
                  onDraftChange={setBindingDraft}
                  onSelect={selectBinding}
                  onNew={newBinding}
                  onSave={saveBinding}
                  onDelete={deleteBinding}
                />
              </Suspense>
            </TabsContent>
            <TabsContent value="onboarding">
              <Suspense fallback={<EditorLoading label="Device onboarding" />}>
                <OnboardingFlow
                  organizationUuid={organization.uuid}
                  profiles={catalogs.profiles}
                  bindings={catalogs.bindings}
                  gateways={catalogs.gateways}
                  devices={catalogs.devices}
                  routes={catalogs.routes}
                  onRefresh={refreshFlowCatalogs}
                />
              </Suspense>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </main>
  )
}
