import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import {
  ApiError,
  configurationProfile,
  type DeviceDetail,
  type DeviceLifecycleRequest,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import { Confirm } from "../components/forms"
import { api } from "../lib/api"
import { lifecycleStorageKey, reconcileDevice } from "./lifecycle"

export function DeviceLifecycleAction({
  org,
  device,
  disabled,
  onUnconfirmed,
}: {
  org: string
  device: DeviceDetail
  disabled: boolean
  onUnconfirmed: (value: boolean) => void
}) {
  const cache = useQueryClient()
  const storageKey = lifecycleStorageKey(org, device.uuid)
  const [request, setRequest] = useState<
    (DeviceLifecycleRequest & { submitted_at?: string }) | null
  >(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) ?? "null")
    } catch {
      return null
    }
  })
  const [review, setReview] = useState<{
    request: DeviceLifecycleRequest
    description: string
  } | null>(null)
  const [notice, setNotice] = useState("")
  const [now, setNow] = useState(Date.now())
  const operation = device.operation
  const pending = Boolean(
    request ||
    operation?.status === "pending" ||
    device.deployment_status === "pending",
  )
  const operationId =
    request?.operation_uuid ??
    (operation?.status === "pending" ? operation.uuid : undefined)
  const status = useQuery({
    queryKey: ["device-operation", org, device.uuid, operationId],
    queryFn: () => api.deviceOperation(org, device.uuid, operationId!),
    enabled: Boolean(operationId),
    retry: false,
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  })
  useEffect(() => {
    onUnconfirmed(Boolean(request))
  }, [Boolean(request), onUnconfirmed])
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pending])
  useEffect(() => {
    if (!status.data) return
    reconcileDevice(cache, org, status.data.data)
    if (status.data.operation.status !== "pending") {
      sessionStorage.removeItem(storageKey)
      setRequest(null)
      setNotice(
        status.data.operation.status === "failed"
          ? (status.data.operation.diagnostic ??
              "The runtime rejected the request.")
          : "",
      )
    }
  }, [status.data, cache, org, storageKey])
  const working = device.configurations.find(
    (c) => c.uuid === device.last_applied_configuration_uuid,
  )
  const target =
    request?.target_state ??
    (operation?.status === "pending"
      ? operation.target_state
      : device.lifecycle === "active"
        ? "inactive"
        : "active")
  const delayed =
    pending &&
    now -
      Date.parse(
        operation?.status === "pending"
          ? operation.created_at
          : (request?.submitted_at ?? new Date(now).toISOString()),
      ) >=
      60000
  const canResume = device.lifecycle === "deactivated" && Boolean(working)
  if (!pending && device.lifecycle !== "active" && !canResume)
    return (
      <div className="flex flex-col gap-2">
        {device.lifecycle === "deactivated" && (
          <p className="text-sm text-muted-foreground">
            No confirmed working configuration is available. Review
            Configuration before activation.
          </p>
        )}
        <Button variant="outline" asChild>
          <Link
            to={
              "/organizations/" +
              org +
              "/devices/" +
              device.uuid +
              "/configuration"
            }
          >
            Configure and activate
          </Link>
        </Button>
      </div>
    )
  return (
    <div className="flex w-full flex-col gap-3">
      <div>
        <Button
          variant={target === "inactive" ? "destructive" : "default"}
          disabled={disabled || pending}
          onClick={() => {
            const target_state =
              device.lifecycle === "active" ? "inactive" : "active"
            const profile = working ? configurationProfile(working) : null
            setReview({
              request: {
                operation_uuid: crypto.randomUUID(),
                expected_generation: device.deployment_generation,
                target_state,
              },
              description:
                target_state === "active"
                  ? "Resume " +
                    device.name +
                    " with its last working configuration, revision " +
                    working?.revision +
                    ", " +
                    profile?.profile.name +
                    ". Saved draft changes will not be applied. The runtime must validate the live source before confirming activation."
                  : "Stop measurement ingestion and commands for " +
                    device.name +
                    ". Unsent commands will be cancelled; potentially sent commands with no confirmed outcome will be marked uncertain. History and gateway discovery are retained.",
            })
          }}
        >
          {pending
            ? target === "active"
              ? "Activating…"
              : "Deactivating…"
            : device.lifecycle === "active"
              ? "Deactivate device"
              : "Activate device"}
        </Button>
      </div>
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          {delayed
            ? "Confirmation delayed. Still checking the runtime; this action remains locked."
            : status.error
              ? "Checking request status. Connection interrupted; reconciliation will continue automatically."
              : "Waiting for runtime confirmation. Ingestion and controls follow the last confirmed processing state until the runtime handles this request."}
        </p>
      )}
      {request &&
        status.error instanceof ApiError &&
        status.error.status === 404 && (
          <Button
            variant="outline"
            disabled={false}
            onClick={async () => {
              try {
                const result = await api.deviceLifecycle(
                  org,
                  device.uuid,
                  request,
                )
                reconcileDevice(cache, org, result.data)
                setNotice("")
              } catch (error) {
                if (
                  error instanceof ApiError &&
                  [403, 409, 422].includes(error.status)
                ) {
                  sessionStorage.removeItem(storageKey)
                  setRequest(null)
                  onUnconfirmed(false)
                  void cache.invalidateQueries({
                    queryKey: ["device", org, device.uuid],
                  })
                }
                setNotice(
                  error instanceof Error
                    ? error.message
                    : "Request status could not be confirmed.",
                )
              }
            }}
          >
            Retry the same request
          </Button>
        )}
      {(notice || operation?.status === "failed") && !pending && (
        <Alert variant="destructive">
          <AlertTitle>Lifecycle action needs attention</AlertTitle>
          <AlertDescription>
            {notice || operation?.diagnostic}{" "}
            <Link
              className="underline"
              to={
                "/organizations/" +
                org +
                "/devices/" +
                device.uuid +
                "/configuration"
              }
            >
              Review Configuration
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <Confirm
        open={Boolean(review)}
        title={
          review?.request.target_state === "active"
            ? "Activate this device?"
            : "Deactivate this device?"
        }
        description={review?.description ?? ""}
        action={
          review?.request.target_state === "active"
            ? "Activate device"
            : "Deactivate device"
        }
        destructive={review?.request.target_state === "inactive"}
        onClose={() => setReview(null)}
        onConfirm={async () => {
          if (!review) return
          const input = {
            ...review.request,
            submitted_at: new Date().toISOString(),
          }
          sessionStorage.setItem(storageKey, JSON.stringify(input))
          setRequest(input)
          setNotice("")
          await cache.cancelQueries({ queryKey: ["device", org, device.uuid] })
          try {
            const result = await api.deviceLifecycle(org, device.uuid, input)
            reconcileDevice(cache, org, result.data)
          } catch (error) {
            if (
              error instanceof ApiError &&
              error.status >= 400 &&
              error.status < 500 &&
              error.status !== 408
            ) {
              sessionStorage.removeItem(storageKey)
              setRequest(null)
              void cache.invalidateQueries({
                queryKey: ["device", org, device.uuid],
              })
              throw error
            }
            setNotice(
              "The response was interrupted. Checking whether the operation was accepted.",
            )
          }
        }}
      />
    </div>
  )
}
