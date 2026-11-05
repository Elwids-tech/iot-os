import { useState } from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Device, FirmwareArchive, Gateway, StarterManifest } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { DownloadIcon, PlusIcon, XIcon } from "lucide-react"
import { api } from "../lib/api"
import { saveArchive } from "../lib/download"
import { FirmwareTargetSelect, gatewayHealthProfile, publishedArtifact, useFirmwareTargets } from "../lib/firmware"
import { RequestError } from "../components/forms"

/** IOTOS_MAX_DEVICE_TYPES: the most device types one gateway starter holds. */
const MAX_TYPES = 8
const DEFAULT_HEALTH = "SDK default health metrics"

type Choice = { uuid: string; name: string }
type Choices = { node: Choice | null; types: Choice[] }

/**
 * Firmware for a gateway (spec 027 US4): its health profile and one published profile per
 * device type it reads, a target, then a credential-free starter, the gateway's connection
 * settings, or both in one kit. Choices are saved on the gateway for the next person.
 */
export function GatewayFirmwareDialog({
  org,
  gateway,
  devices,
  canManage,
  onClose,
}: {
  org: string
  gateway: Gateway
  /** The devices under this gateway, or undefined while they load: their profiles are suggested when nothing is saved. */
  devices: Device[] | undefined
  /** Device.manage-connections: settings, the full kit, and saving the choices. */
  canManage: boolean
  onClose: () => void
}) {
  const saved = gateway.firmware_selection ?? null
  const initial = useQuery({
    queryKey: ["gateway-firmware-choices", org, gateway.uuid],
    queryFn: () => initialChoices(org, saved, devices ?? []),
    enabled: saved !== null || devices !== undefined,
    staleTime: 0,
    gcTime: 0,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Gateway firmware</DialogTitle>
          <DialogDescription>
            A starter project for {gateway.name}: the IoT OS SDK, metric tables for the gateway's health and each device
            type it reads, and instructions that let an AI coding agent write the code for your hardware.
          </DialogDescription>
        </DialogHeader>
        {initial.data ? (
          <FirmwareChoices org={org} gateway={gateway} initial={initial.data} target={saved?.target ?? ""} canManage={canManage} onClose={onClose} />
        ) : initial.error ? (
          <RequestError error={initial.error} />
        ) : (
          <div className="flex flex-col gap-4" aria-busy="true">
            <Skeleton className="h-16" />
            <Skeleton className="h-24" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function FirmwareChoices({
  org,
  gateway,
  initial,
  target: savedTarget,
  canManage,
  onClose,
}: {
  org: string
  gateway: Gateway
  initial: Choices
  target: string
  canManage: boolean
  onClose: () => void
}) {
  const cache = useQueryClient()
  const targets = useFirmwareTargets(org, "gateway")
  const [node, setNode] = useState(initial.node)
  const [types, setTypes] = useState<(Choice | null)[]>(initial.types.length ? initial.types : [null])
  const [picked, setPicked] = useState(savedTarget)
  const [busy, setBusy] = useState<"starter" | "settings" | "kit" | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [done, setDone] = useState("")
  const [manifest, setManifest] = useState<StarterManifest | null>(null)
  // A saved target that is no longer offered is not preselected.
  const target = targets.options.some((item) => item.id === picked) ? picked : ""
  const chosen = types.filter((type): type is Choice => type !== null)
  const ready = Boolean(target) && chosen.length > 0

  async function download(kind: "starter" | "settings" | "kit") {
    if (busy) return
    setBusy(kind)
    setError(null)
    setDone("")
    try {
      if (kind === "settings") {
        // The archive stays in this function: it holds the gateway's credentials.
        saveArchive(await api.gatewayConnectionSettings(org, gateway.uuid))
        setDone("Connection settings downloaded. Keep them private.")
        return
      }
      const body = {
        target,
        node_artifact_uuid: node ? await publishedArtifact(org, node.uuid) : null,
        device_type_artifact_uuids: await Promise.all(chosen.map((type) => publishedArtifact(org, type.uuid))),
      }
      const archive: FirmwareArchive =
        kind === "starter"
          ? await api.createFirmwareStarter(org, { ...body, role: "gateway", ...(canManage ? { gateway_uuid: gateway.uuid } : {}) })
          : await api.gatewayFirmwareKit(org, gateway.uuid, body)
      saveArchive(archive)
      setManifest(archive.manifest)
      setDone(kind === "starter" ? "Starter downloaded." : "Full kit downloaded. Its config/ folder holds the credentials: keep it private.")
      // Both downloads save these choices on the gateway for the next person who opens it.
      if (canManage) await cache.invalidateQueries({ queryKey: ["gateways", org] })
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(null)
    }
  }

  const taken = (index: number) => chosen.filter((_, other) => other !== index).map((type) => type.uuid)
  return (
    <>
      <FieldGroup>
        <ProfilePicker
          org={org}
          label="Gateway health"
          value={node}
          onChange={setNode}
          defaultLabel={DEFAULT_HEALTH}
          help="The gateway's own metrics. Without a published gateway-health profile, the SDK's default health metrics are used."
        />
        <FieldSet>
          <FieldLegend variant="label">Device types</FieldLegend>
          <FieldDescription>One published profile for each kind of device the gateway reads, up to {MAX_TYPES}.</FieldDescription>
          <div className="flex flex-col gap-3">
            {types.map((type, index) => (
              <div key={index} className="flex items-end gap-2">
                <ProfilePicker
                  org={org}
                  label={`Device type ${index + 1}`}
                  value={type}
                  exclude={taken(index)}
                  onChange={(next) => setTypes((current) => current.map((item, other) => (other === index ? next : item)))}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove device type ${index + 1}`}
                  disabled={types.length === 1 && type === null}
                  onClick={() => setTypes((current) => (current.length === 1 ? [null] : current.filter((_, other) => other !== index)))}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={types.length >= MAX_TYPES}
              onClick={() => setTypes((current) => [...current, null])}
            >
              <PlusIcon data-icon="inline-start" />
              Add device type
            </Button>
          </div>
        </FieldSet>
        <Field>
          <FieldLabel htmlFor="gateway-firmware-target">Microcontroller or platform</FieldLabel>
          <FirmwareTargetSelect
            id="gateway-firmware-target"
            targets={targets.options}
            value={target}
            onChange={setPicked}
            loading={targets.isPending}
          />
        </Field>
      </FieldGroup>
      <RequestError error={error ?? targets.error} />
      {manifest && manifest.warnings.length > 0 && (
        <Alert>
          <AlertTitle>Check before building</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {manifest.warnings.map((warning) => (
                <li key={warning.code + warning.subject}>{warning.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <p className="text-meta text-muted-foreground">
        {canManage
          ? "The starter holds no credentials. Settings and the full kit hold the gateway's credentials in config/: keep them out of version control."
          : "The starter holds no credentials. Connection settings and full kits need connection-management access."}
      </p>
      {/* Downloads confirm here, not in a toast that could cover these buttons. */}
      <p role="status" className="text-meta">
        {done}
      </p>
      <DialogFooter>
        <Button variant="outline" disabled={busy !== null} onClick={onClose}>
          Close
        </Button>
        {canManage && (
          <Button variant="outline" disabled={busy !== null} onClick={() => void download("settings")}>
            {busy === "settings" ? "Preparing…" : "Download settings"}
          </Button>
        )}
        <Button variant={canManage ? "outline" : "default"} disabled={!ready || busy !== null} onClick={() => void download("starter")}>
          <DownloadIcon data-icon="inline-start" />
          {busy === "starter" ? "Preparing…" : "Download starter"}
        </Button>
        {canManage && (
          <Button disabled={!ready || busy !== null} onClick={() => void download("kit")}>
            <DownloadIcon data-icon="inline-start" />
            {busy === "kit" ? "Preparing…" : "Download full kit"}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

/** A published profile, searched on the server; with defaultLabel, nothing chosen means that default. */
function ProfilePicker({
  org,
  label,
  value,
  onChange,
  exclude = [],
  defaultLabel,
  help,
  className,
}: {
  org: string
  label: string
  value: Choice | null
  onChange: (choice: Choice | null) => void
  exclude?: string[]
  defaultLabel?: string
  help?: string
  className?: string
}) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const profiles = useQuery({
    queryKey: ["firmware-profiles", org, search, page],
    queryFn: () => api.deviceProfiles(org, { search, page, perPage: 25, status: "published" }),
    placeholderData: keepPreviousData,
  })
  const options = [
    ...(defaultLabel ? [{ value: "", label: defaultLabel }] : []),
    ...(profiles.data?.data ?? [])
      .filter((profile) => profile.revision > 0 && !exclude.includes(profile.uuid))
      .map((profile) => ({ value: profile.uuid, label: profile.name })),
  ]
  return (
    <SearchableSelect
      label={label}
      value={value?.uuid ?? ""}
      selectedLabel={value?.name ?? defaultLabel}
      options={options}
      onChange={(uuid) => onChange(uuid ? { uuid, name: options.find((option) => option.value === uuid)?.label ?? uuid } : null)}
      search={search}
      onSearchChange={(next) => {
        setSearch(next)
        setPage(1)
      }}
      loading={profiles.isPending}
      page={page}
      hasNextPage={(profiles.data?.meta.last_page ?? 1) > page}
      onPageChange={setPage}
      placeholder="Choose a published profile"
      emptyText="No published profiles match."
      help={help}
      className={className}
    />
  )
}

/** The saved choices with their names, otherwise the gateway health profile and the profiles of the gateway's devices. */
async function initialChoices(org: string, saved: Gateway["firmware_selection"], devices: Device[]): Promise<Choices> {
  const named = async (uuid: string): Promise<Choice | null> => {
    try {
      return { uuid, name: (await api.deviceProfile(org, uuid)).name }
    } catch {
      return null
    }
  }
  const suggested = [
    ...new Map(devices.flatMap((device) => (device.profile ? [[device.profile.uuid, device.profile] as const] : []))).values(),
  ]
    .slice(0, MAX_TYPES)
    .map((profile) => ({ uuid: profile.uuid, name: profile.name }))
  if (saved) {
    const types = (await Promise.all(saved.device_profile_uuids.map(named))).filter((type): type is Choice => type !== null)
    return { node: saved.node_profile_uuid ? await named(saved.node_profile_uuid) : null, types: types.length ? types : suggested }
  }
  const health = await gatewayHealthProfile(org)
  return { node: health ? { uuid: health.uuid, name: health.name } : null, types: suggested }
}
