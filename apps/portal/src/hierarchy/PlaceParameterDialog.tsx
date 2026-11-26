import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { DeviceDetail } from "@iot-os/api-client"
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
import { api } from "../lib/api"
import { RequestError, TextField, fieldError } from "../components/forms"
import { EntityPicker } from "./EntityPicker"
import { useEntityTypes } from "./shared"

/**
 * Places one parameter apart from its device (spec 009 FR-010), e.g. channel 3's energy on
 * the floor it meters, under a leaf name; or sends it back to the device's place.
 */
export function PlaceParameterDialog({
  org,
  device,
  parameter,
  onClose,
}: {
  org: string
  device: DeviceDetail
  parameter: { uuid: string; key: string; label: string }
  onClose: () => void
}) {
  const client = useQueryClient()
  const types = useEntityTypes(org)
  const holdsDevices = new Set((types.data?.data ?? []).filter((type) => type.accepts_devices).map((type) => type.key))
  const current = device.parameter_placements?.find((placement) => placement.parameter_uuid === parameter.uuid)
  const [entity, setEntity] = useState("")
  const [leaf, setLeaf] = useState(current?.leaf_name ?? parameter.key)
  const done = async (message: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["device", org, device.uuid] }),
      client.invalidateQueries({ queryKey: ["entity", org] }),
    ])
    toast.success(message)
    onClose()
  }
  const place = useMutation({
    mutationFn: () => api.placeParameter(org, device.uuid, parameter.uuid, entity, leaf.trim() || undefined),
    onSuccess: (placed) => done(`${parameter.label} is now at ${placed.path}`),
  })
  const unplace = useMutation({
    mutationFn: () => api.unplaceParameter(org, device.uuid, parameter.uuid),
    onSuccess: () => done(`${parameter.label} is back with ${device.name}`),
  })
  const busy = place.isPending || unplace.isPending
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Place {parameter.label}</DialogTitle>
          <DialogDescription>
            {current
              ? `It is at ${current.path}, apart from ${device.name}.`
              : device.entity
                ? `It is at ${device.entity.path}/${parameter.key} with ${device.name}. Place it somewhere else, such as the area it measures.`
                : `${device.name} is not placed yet. A parameter can still have a place of its own.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (entity) place.mutate()
          }}
        >
          <FieldGroup>
            <EntityPicker
              org={org}
              label="Place"
              value={entity}
              onChange={(uuid) => setEntity(uuid)}
              accept={(candidate) => !types.data || holdsDevices.has(candidate.type.key)}
              placeholder="Choose where it belongs"
              error={fieldError(place.error, "entity_uuid")}
            />
            <TextField
              label="Leaf name"
              value={leaf}
              onChange={(event) => setLeaf(event.target.value)}
              help={fieldError(place.error, "leaf_name") ? undefined : "The last part of its path. Each name is used once at a place."}
              error={fieldError(place.error, "leaf_name")}
              className="font-mono"
            />
          </FieldGroup>
          <RequestError error={place.error ?? unplace.error} />
          <DialogFooter>
            {current && (
              <Button type="button" variant="outline" className="sm:mr-auto" disabled={busy} onClick={() => unplace.mutate()}>
                Back with the device
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!entity || busy}>
              {place.isPending ? "Placing…" : "Place"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
