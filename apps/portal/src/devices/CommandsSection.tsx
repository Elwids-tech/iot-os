import { useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  configurationProfile,
  type DeviceCommand,
  type DeviceDetail,
  type DeviceProfileParameter,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { FieldGroup } from "@iot-os/ui/components/field"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import { Choice, TextField, RequestError, Confirm } from "../components/forms"
import {
  Age,
  DeviceEmpty,
  DeviceStatus,
  formatValue,
  Section,
} from "./shared"
import type { DeviceOperation } from "./DeviceWorkspace"

const outstanding = (c: DeviceCommand) =>
  ["prepared", "pending", "sent"].includes(c.status)
function commandValue(
  parameter: DeviceProfileParameter,
  text: string,
): unknown {
  if (parameter.data_type === "boolean") {
    if (!["true", "false"].includes(text))
      throw new Error("Choose the proposed state.")
    return text === "true"
  }
  if (["number", "integer"].includes(parameter.data_type)) {
    const number = Number(text)
    if (
      !text.trim() ||
      !Number.isFinite(number) ||
      (parameter.data_type === "integer" && !Number.isSafeInteger(number))
    )
      throw new Error("Enter a valid value within the supported numeric range.")
    return number
  }
  return text
}

export function CommandsSection({
  org,
  device,
  allowed,
  run,
  busy,
}: {
  org: string
  device: DeviceDetail
  allowed: boolean
  run: DeviceOperation
  busy: boolean
}) {
  const cache = useQueryClient(),
    [parameterUuid, setParameter] = useState(""),
    [value, setValue] = useState(""),
    [error, setError] = useState<unknown>(null),
    [review, setReview] = useState<DeviceCommand | null>(null),
    [cancel, setCancel] = useState<DeviceCommand | null>(null)
  const request = useRef<{ signature: string; key: string } | null>(null)
  const configuration = device.configurations.find(
    (c) => c.uuid === device.applied_configuration_uuid,
  )
  const parameters = configuration
    ? configurationProfile(configuration).parameters.filter(
        (p) =>
          p.accepts_command &&
          p.reports_state &&
          configuration.definition.mappings.some(
            (m) => m.parameter_uuid === p.uuid && m.command_metric,
          ),
      )
    : []
  const parameter = parameters.find((p) => p.uuid === parameterUuid)
  const key = ["device-commands", org, device.uuid]
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.deviceCommands(org, device.uuid),
    refetchInterval: (q) =>
      q.state.data?.some((c) => ["pending", "sent"].includes(c.status))
        ? 1000
        : 5000,
    refetchIntervalInBackground: false,
  })
  useUnsaved(Boolean(value) || Boolean(review && review.status === "prepared"))
  const ready =
    allowed &&
    device.lifecycle === "active" &&
    ["applied", "failed"].includes(device.deployment_status) &&
    device.presence === "online"
  async function remember(command: DeviceCommand) {
    cache.setQueryData<DeviceCommand[]>(key, (previous) => [
      command,
      ...(previous ?? []).filter((c) => c.uuid !== command.uuid),
    ])
    return command
  }
  return (
    <div className="flex flex-col gap-8">
      <RequestError error={error ?? query.error} />
      <Section title="Set device state">
        <div className="flex flex-col gap-5">
          {!parameters.length ? (
            <DeviceEmpty
              title="No controls configured"
              description="The applied configuration needs a writable parameter with an approved outbound mapping."
            />
          ) : (
            <>
              {!ready && (
                <Alert>
                  <AlertTitle>Controls are unavailable</AlertTitle>
                  <AlertDescription>
                    {!allowed
                      ? "Your role can view command history."
                      : "The device must be online with a fully applied, compatible configuration."}
                  </AlertDescription>
                </Alert>
              )}
              <form
                className="flex flex-col gap-5"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!parameter || !configuration) return
                  setError(null)
                  try {
                    const proposed = commandValue(parameter, value),
                      signature = JSON.stringify([
                        configuration.uuid,
                        parameter.uuid,
                        proposed,
                      ])
                    if (request.current?.signature !== signature)
                      request.current = { signature, key: crypto.randomUUID() }
                    const command = await run(() =>
                      api.prepareDeviceCommand(org, device.uuid, {
                        configuration_uuid: configuration.uuid,
                        parameter_uuid: parameter.uuid,
                        value: proposed,
                        idempotency_key: request.current!.key,
                      }),
                    )
                    await remember(command)
                    setReview(command)
                  } catch (reason) {
                    setError(reason)
                  }
                }}
              >
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <Choice
                    label="Control parameter"
                    value={parameterUuid}
                    onChange={(v) => {
                      setParameter(v)
                      setValue(
                        parameters.find((p) => p.uuid === v)?.data_type ===
                          "boolean"
                          ? "false"
                          : "",
                      )
                    }}
                    disabled={!ready || busy}
                    options={[
                      { value: "", label: "Choose a parameter" },
                      ...parameters.map((p) => ({
                        value: p.uuid,
                        label: p.label,
                      })),
                    ]}
                  />
                  {parameter?.data_type === "boolean" ? (
                    <Choice
                      label="Proposed value"
                      value={value}
                      onChange={setValue}
                      disabled={!ready || busy}
                      options={[
                        { value: "", label: "Choose a value" },
                        { value: "false", label: "Off / false" },
                        { value: "true", label: "On / true" },
                      ]}
                    />
                  ) : (
                    <TextField
                      label="Proposed value"
                      required
                      disabled={!ready || !parameter || busy}
                      type={
                        parameter &&
                        ["number", "integer"].includes(parameter.data_type)
                          ? "number"
                          : "text"
                      }
                      step={parameter?.data_type === "integer" ? 1 : "any"}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      help={
                        parameter?.unit
                          ? `Value in ${parameter.unit}`
                          : undefined
                      }
                    />
                  )}
                </FieldGroup>
                <div>
                  <Button
                    disabled={
                      !ready ||
                      !parameter ||
                      (parameter.data_type === "boolean" && !value) ||
                      busy ||
                      query.data?.some(
                        (c) =>
                          c.parameter_uuid === parameterUuid && outstanding(c),
                      )
                    }
                  >
                    Prepare command
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      </Section>
      <Section
        title="Command history"
        meta="One outstanding request per parameter. Uncertain delivery is never retried."
      >
          {query.isPending ? (
            <p role="status">Loading commands…</p>
          ) : !query.data?.length ? (
            <DeviceEmpty
              title="No commands yet"
              description="Prepared requests, confirmations, and outcomes will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prepared</TableHead>
                  <TableHead>Parameter / value</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Confirmed / completed</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((c) => {
                  const config = device.configurations.find(
                      (config) => config.uuid === c.configuration_uuid,
                    ),
                    p =
                      config &&
                      configurationProfile(config).parameters.find(
                        (p) => p.uuid === c.parameter_uuid,
                      )
                  return (
                    <TableRow key={c.uuid}>
                      <TableCell>
                        <Age value={c.created_at} />
                        <p className="text-xs text-muted-foreground">
                          {c.actor_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Configuration {config?.revision ?? "historical"}
                        </p>
                      </TableCell>
                      <TableCell>
                        {p?.label ?? c.parameter_uuid}
                        <p className="font-mono">
                          {formatValue(c.value)} {p?.unit}
                        </p>
                      </TableCell>
                      <TableCell>
                        <DeviceStatus value={c.status} />
                        {c.diagnostic && (
                          <p className="max-w-md text-xs whitespace-normal text-muted-foreground">
                            {c.diagnostic}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Age value={c.confirmed_at} never="Not confirmed" />
                        <p className="text-xs text-muted-foreground">
                          <Age value={c.completed_at} never="Not completed" />
                        </p>
                      </TableCell>
                      <TableCell>
                        {allowed && c.status === "prepared" && (
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy || !ready}
                              onClick={() => setReview(c)}
                            >
                              Review
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => setCancel(c)}
                            >
                              Cancel request
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
      </Section>
      <Confirm
        open={Boolean(review)}
        title="Confirm device state change?"
        description={`${device.name} (${device.code}) · ${parameters.find((p) => p.uuid === review?.parameter_uuid)?.label ?? "parameter"}: set to ${formatValue(review?.value)}. The request has a 30-second execution deadline. A matching cached value does not establish completion.`}
        action="Confirm and send"
        destructive={false}
        onClose={() => setReview(null)}
        onConfirm={async () => {
          if (!review) return
          await remember(
            await run(() =>
              api.confirmDeviceCommand(org, device.uuid, review.uuid),
            ),
          )
          request.current = null
          setValue("")
        }}
      />
      <Confirm
        open={Boolean(cancel)}
        title="Cancel this request?"
        description="The prepared command is withdrawn and never sent. You can prepare a new one afterwards."
        action="Cancel request"
        destructive={false}
        onClose={() => setCancel(null)}
        onConfirm={async () => {
          if (!cancel) return
          await remember(
            await run(() => api.cancelDeviceCommand(org, device.uuid, cancel.uuid)),
          )
          request.current = null
          setValue("")
        }}
      />
    </div>
  )
}
