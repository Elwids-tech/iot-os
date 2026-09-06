import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useForm } from "react-hook-form"
import type { DeviceInput } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card"
import { FieldGroup } from "@iot-os/ui/components/field"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { PlusIcon } from "lucide-react"
import { api } from "../lib/api"
import { useDirtyContext, useUnsaved } from "../lib/unsaved"
import {
  TextField,
  Choice,
  RequestError,
  EditorSheet,
  SaveBar,
  fieldError,
} from "../components/forms"
import {
  devicePath,
  DeviceStatus,
  DeviceEmpty,
  formatTime,
  useDeviceOrganization,
} from "./shared"

export function DeviceDirectory() {
  const { org, capabilities } = useDeviceOrganization()
  const [params, setParams] = useSearchParams()
  const [create, setCreate] = useState(false)
  const query = useQuery({
    queryKey: ["devices", org, params.toString()],
    queryFn: () =>
      api.devices(org, {
        search: params.get("search") ?? "",
        lifecycle: params.get("lifecycle") ?? "",
        page: Number(params.get("page") ?? 1),
      }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params)
    value ? next.set(key, value) : next.delete(key)
    next.delete("page")
    setParams(next, { replace: true })
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Devices</h1>
          <p className="text-muted-foreground">
            Register equipment, connect its source, and follow its measurements.
          </p>
        </div>
        {capabilities.manage && (
          <Button onClick={() => setCreate(true)}>
            <PlusIcon data-icon="inline-start" />
            Register device
          </Button>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Device inventory</CardTitle>
          <CardDescription>
            {query.data?.meta.total ?? 0} registered devices in this
            organization
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Search devices"
              value={params.get("search") ?? ""}
              onChange={(e) => filter("search", e.target.value)}
              placeholder="Name or device code"
            />
            <Choice
              label="Lifecycle"
              value={params.get("lifecycle") ?? ""}
              onChange={(v) => filter("lifecycle", v)}
              options={[
                { value: "", label: "All devices" },
                ...["registered", "active", "deactivated", "archived"].map(
                  (value) => ({ value, label: value }),
                ),
              ]}
            />
          </FieldGroup>
          <RequestError error={query.error} />
          {query.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : query.data?.data.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Lifecycle</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead>Configuration</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((device) => (
                  <TableRow key={device.uuid}>
                    <TableCell>
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        to={devicePath(org, device.uuid)}
                      >
                        {device.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {device.code}
                      </p>
                    </TableCell>
                    <TableCell>
                      <DeviceStatus value={device.lifecycle} />
                    </TableCell>
                    <TableCell>
                      <DeviceStatus value={device.presence} />
                    </TableCell>
                    <TableCell>
                      <DeviceStatus value={device.deployment_status} />
                    </TableCell>
                    <TableCell>{formatTime(device.last_seen_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <DeviceEmpty
              title="No matching devices"
              description="Register a device now, or open Discovery to onboard a source that has connected."
            />
          )}
          {query.data && query.data.meta.last_page > 1 && (
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                disabled={query.data.meta.current_page <= 1}
                onClick={() => {
                  const p = new URLSearchParams(params)
                  p.set("page", String(query.data!.meta.current_page - 1))
                  setParams(p)
                }}
              >
                Previous
              </Button>
              <span>
                Page {query.data.meta.current_page} of{" "}
                {query.data.meta.last_page}
              </span>
              <Button
                variant="outline"
                disabled={
                  query.data.meta.current_page >= query.data.meta.last_page
                }
                onClick={() => {
                  const p = new URLSearchParams(params)
                  p.set("page", String(query.data!.meta.current_page + 1))
                  setParams(p)
                }}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {create && <RegisterDevice org={org} onClose={() => setCreate(false)} />}
    </div>
  )
}

export function RegisterDevice({
  org,
  candidate,
  onClose,
}: {
  org: string
  candidate?: string
  onClose: () => void
}) {
  const navigate = useNavigate(),
    cache = useQueryClient()
  const { setDirty } = useDirtyContext()
  const form = useForm<DeviceInput>({
    defaultValues: { name: "", code: "", serial_number: "", description: "" },
  })
  const [error, setError] = useState<unknown>(null)
  useUnsaved(form.formState.isDirty)
  return (
    <EditorSheet
      title="Register device"
      description="Create its identity now. Connection and activation follow after you choose a published profile."
      dirty={form.formState.isDirty}
      busy={form.formState.isSubmitting}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (values) => {
          setError(null)
          try {
            const device = await api.createDevice(org, values)
            form.reset(values)
            await cache.invalidateQueries({ queryKey: ["devices", org] })
            onClose()
            setDirty(false)
            navigate(
              devicePath(org, device.uuid) +
                "/configuration" +
                (candidate
                  ? "?candidate=" + encodeURIComponent(candidate)
                  : ""),
            )
          } catch (reason) {
            setError(reason)
          }
        })}
      >
        <div className="flex-1 overflow-auto p-6">
          <FieldGroup>
            <TextField
              label="Device name"
              required
              {...form.register("name")}
              error={fieldError(error, "name")}
            />
            <TextField
              label="Device code"
              required
              {...form.register("code")}
              error={fieldError(error, "code")}
              help="Unique in this organization. Use letters, numbers, dots, dashes, or underscores."
            />
            <TextField
              label="Serial number"
              {...form.register("serial_number")}
            />
            <TextField label="Description" {...form.register("description")} />
            <RequestError error={error} />
          </FieldGroup>
        </div>
        <SaveBar
          dirty={form.formState.isDirty}
          busy={form.formState.isSubmitting}
          onCancel={onClose}
          label="Register device"
        />
      </form>
    </EditorSheet>
  )
}
