import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ApiError,
  type Device,
  type DeviceMove,
  type DeviceMoveDeviceInput,
  type DeviceMoveItemInput,
  type DeviceMoveReview,
  type DeviceMoveStale,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { Stepper } from "@iot-os/ui/components/stepper"
import { api } from "../../lib/api"
import { RequestError } from "../../components/forms"
import { Confirm } from "./Confirm"
import { Done } from "./Done"
import { WhatComesAlong } from "./WhatComesAlong"
import { WhereTo, type MoveTarget } from "./WhereTo"

/** A device the move starts from, as the list or the device page has it. */
export type MoveSelection = Pick<Device, "uuid" | "name" | "code" | "lifecycle">

const STEPS = [
  { label: "Where to" },
  { label: "What comes along" },
  { label: "Confirm" },
  { label: "Done" },
]

/** The most devices one move takes (spec 031 FR-001). */
export const MOVE_LIMIT = 100

/**
 * Whether the person can move this organization's devices anywhere: `Device.move` here,
 * and a target in the billing account or room to create one.
 */
export function useCanMove(org: string, allowed: boolean): boolean {
  const targets = useQuery({
    queryKey: ["device-move-targets", org],
    queryFn: () => api.deviceMoveTargets(org),
    enabled: allowed,
    staleTime: 60_000,
  })
  return allowed && Boolean(targets.data && (targets.data.data.length > 0 || targets.data.new_organization))
}

/** A dashboard or automation's key in the choices and archive confirmations. */
export const itemKey = (item: { kind: string; uuid: string }) => `${item.kind}:${item.uuid}`

/**
 * Moving devices to another organization of the billing account (spec 031): where to,
 * what comes along, confirm, done. Nothing changes until **Move**; closing before then
 * discards the choices. Dashboards and automations come with a preselected choice each;
 * a changed choice, or devices added for an automation, re-review at once.
 */
export function MoveDialog({
  org,
  organizationName,
  devices,
  origin,
  onClose,
  onMoved,
}: {
  org: string
  organizationName: string
  devices: MoveSelection[]
  origin: "devices" | "device"
  onClose: () => void
  /** Called once the move is confirmed. */
  onMoved?: () => void
}) {
  const cache = useQueryClient()
  const [step, setStep] = useState(1)
  const [target, setTarget] = useState<MoveTarget | null>(null)
  const [overrides, setOverrides] = useState<Record<string, DeviceMoveDeviceInput>>({})
  const [settled, setSettled] = useState(overrides)
  const [choices, setChoices] = useState<Record<string, DeviceMoveItemInput>>({})
  const [added, setAdded] = useState<string[]>([])
  const [archives, setArchives] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [changed, setChanged] = useState(false)
  const [move, setMove] = useState<DeviceMove | null>(null)
  // Edits re-review once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setSettled(overrides), 400)
    return () => clearTimeout(timer)
  }, [overrides])
  const uuids = useMemo(() => [...devices.map((device) => device.uuid), ...added], [devices, added])
  const input = useMemo(
    () => ({
      target_organization_uuid: target?.uuid ?? "",
      device_uuids: uuids,
      devices: Object.values(settled),
      items: Object.values(choices),
    }),
    [target, uuids, settled, choices],
  )
  const reviewKey = ["device-move-review", org, input]
  const review = useQuery({
    queryKey: reviewKey,
    queryFn: () => api.previewDeviceMove(org, input),
    enabled: Boolean(target) && step >= 2 && !move,
    retry: false,
  })
  // One operation per reviewed request: a retried Move returns the same move.
  const operation = useMemo(() => crypto.randomUUID(), [review.data?.preview_hash])

  const confirm = async (current: DeviceMoveReview) => {
    setBusy(true)
    setError(null)
    try {
      const confirmed_archives = current.archives.map(({ kind, uuid }) => ({ kind, uuid }))
      const created = await api.createDeviceMove(org, { ...input, operation_uuid: operation, preview_hash: current.preview_hash, confirmed_archives, origin })
      setMove(created)
      setStep(4)
      onMoved?.()
      void cache.invalidateQueries({ queryKey: ["devices", org] })
    } catch (reason) {
      const fresh = reason instanceof ApiError && reason.status === 409 ? (reason.payload as Partial<DeviceMoveStale> | null)?.review : undefined
      if (fresh) {
        // Something changed since the review: show the fresh one before anything moves.
        cache.setQueryData(reviewKey, fresh)
        setChanged(true)
        setStep(2)
      } else {
        setError(reason)
      }
    } finally {
      setBusy(false)
    }
  }

  const count = uuids.length
  const title = count === 1 ? `Move ${devices[0].name}` : `Move ${count.toLocaleString()} devices`
  const current = review.data
  const ready = current && !review.isFetching && settled === overrides
  // Each archive is confirmed on its own before Move (FR-006).
  const archivesConfirmed = Boolean(current?.archives.every((item) => archives[itemKey(item)]))
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            To another organization of {organizationName}’s billing account. Each device is archived here and
            continues there with its configuration; adapters and gateways stay with their owner.
          </DialogDescription>
        </DialogHeader>
        <Stepper
          steps={STEPS}
          current={step}
          onStep={move ? undefined : (number) => number < step && setStep(number)}
        />
        {step === 1 && <WhereTo org={org} value={target} onChange={setTarget} />}
        {step === 2 && target && (
          <>
            {changed && (
              <StatusMark tone="warning">
                Something changed since you reviewed this move. Check it again before you confirm.
              </StatusMark>
            )}
            <WhatComesAlong
              source={organizationName}
              target={target}
              devices={devices}
              review={current}
              loading={review.isFetching}
              error={review.error}
              overrides={overrides}
              onOverride={(uuid, values) =>
                setOverrides((current) => ({ ...current, [uuid]: { ...current[uuid], ...values, uuid } }))
              }
              onChoose={(item, action) =>
                setChoices((current) => ({ ...current, [itemKey(item)]: { kind: item.kind, uuid: item.uuid, action } }))
              }
              onAdd={(more) => setAdded((current) => [...new Set([...current, ...more])].filter((uuid) => !devices.some((device) => device.uuid === uuid)))}
            />
          </>
        )}
        {step === 3 && current && (
          <Confirm
            review={current}
            source={organizationName}
            target={target?.name ?? ""}
            confirmed={archives}
            onConfirm={(item, checked) => setArchives((current) => ({ ...current, [itemKey(item)]: checked }))}
          />
        )}
        {step === 4 && move && <Done org={org} move={move} />}
        <RequestError error={error} />
        <DialogFooter>
          {step < 4 ? (
            <>
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              {step > 1 && (
                <Button variant="outline" disabled={busy} onClick={() => setStep(step - 1)}>
                  Back
                </Button>
              )}
              {step === 1 && (
                <Button disabled={!target} onClick={() => setStep(2)}>
                  Next
                </Button>
              )}
              {step === 2 && (
                <Button
                  disabled={!ready || !current?.can_confirm}
                  onClick={() => {
                    setChanged(false)
                    setStep(3)
                  }}
                >
                  Next
                </Button>
              )}
              {step === 3 && current && (
                <Button disabled={busy || !current.can_confirm || !archivesConfirmed} onClick={() => void confirm(current)}>
                  {busy ? "Moving…" : count === 1 ? "Move device" : `Move ${count.toLocaleString()} devices`}
                </Button>
              )}
            </>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
