import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import type { DiscoveryCandidate } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { FieldGroup } from "@iot-os/ui/components/field"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { RegisterDevice } from "./DeviceDirectory"
import { devicePath } from "./shared"

/** A source is a Device ID on a gateway; empty means the gateway's own measurements. */
export const sourceLabel = (c: DiscoveryCandidate) =>
  c.source_device_id || `Measurements from ${c.gateway.name}`

/** Attach a discovered source to a registered device without configuration, or register a new one. */
export function OnboardSource({
  org,
  source,
  onClose,
}: {
  org: string
  source: DiscoveryCandidate
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [existing, setExisting] = useState(""),
    [create, setCreate] = useState(false)
  const devices = useQuery({
    queryKey: ["devices-attach", org, search, page],
    queryFn: () => api.devices(org, { search, page }),
  })
  if (create)
    return <RegisterDevice org={org} candidate={source.uuid} onClose={onClose} />
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Onboard {sourceLabel(source)}</DialogTitle>
          <DialogDescription>
            Attach it to a registered device that has no configuration yet, or
            register a new device.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <SearchableSelect
            search={search}
            onSearchChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            loading={devices.isLoading}
            page={page}
            hasNextPage={Boolean(
              devices.data && page < devices.data.meta.last_page,
            )}
            onPageChange={setPage}
            label="Existing device"
            value={existing}
            onChange={setExisting}
            options={[
              { value: "", label: "Choose a registered device" },
              ...(devices.data?.data ?? [])
                .filter(
                  (d) =>
                    !d.applied_configuration_uuid && d.lifecycle !== "archived",
                )
                .map((d) => ({ value: d.uuid, label: d.name })),
            ]}
          />
          <RequestError error={devices.error} />
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCreate(true)}>
            Register new device
          </Button>
          <Button
            disabled={!existing}
            onClick={() =>
              navigate(
                devicePath(org, existing) +
                  "/configuration?candidate=" +
                  encodeURIComponent(source.uuid),
              )
            }
          >
            Configure selected device
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
