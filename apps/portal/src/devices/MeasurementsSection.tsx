import { useQuery } from "@tanstack/react-query"
import type { DeviceDetail, Measurement } from "@iot-os/api-client"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import {
  Age,
  DeviceEmpty,
  DeviceStatus,
  formatReading,
  parameterPrecisions,
  Section,
} from "./shared"

export function MeasurementTable({
  readings,
  precision,
}: {
  readings: Measurement[]
  precision?: Map<string, number | undefined>
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Parameter</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead>Quality</TableHead>
          <TableHead className="text-right">Observed</TableHead>
          <TableHead className="text-right">Received</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {readings.map((r) => (
          <TableRow key={r.parameter_uuid}>
            <TableCell>
              {r.label}
              <p className="font-mono text-xs text-muted-foreground">{r.key}</p>
            </TableCell>
            <TableCell className="max-w-64 truncate text-right font-mono tabular-nums">
              {formatReading(r.value, precision?.get(r.parameter_uuid))}
              {r.unit && <span className="ml-1 text-muted-foreground">{r.unit}</span>}
            </TableCell>
            <TableCell>
              <DeviceStatus value={r.quality} />
              {r.diagnostic && (
                <p className="max-w-xs text-xs whitespace-normal text-muted-foreground">
                  {r.diagnostic}
                </p>
              )}
            </TableCell>
            <TableCell className="text-right">
              <Age value={r.observed_at} />
            </TableCell>
            <TableCell className="text-right">
              <Age value={r.received_at} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
export function MeasurementsSection({
  org,
  device,
}: {
  org: string
  device: DeviceDetail
}) {
  const configured = Boolean(
    device.applied_configuration_uuid || device.last_applied_configuration_uuid,
  )
  const query = useQuery({
    queryKey: [
      "device-latest",
      org,
      device.uuid,
      device.applied_configuration_uuid ?? device.last_applied_configuration_uuid,
      device.lifecycle,
    ],
    queryFn: () => api.deviceLatest(org, device.uuid),
    enabled: configured,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  return (
    <Section
      title="Latest measurements"
      meta={
        device.lifecycle === "deactivated"
          ? "Retained readings, ingestion is off"
          : "Updates every 5 s"
      }
    >
      <RequestError error={query.error} />
      {!configured ? (
        <DeviceEmpty
          title="Configure and activate this device"
          description="Measurements appear after the runtime applies a reviewed configuration and receives data."
        />
      ) : query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : query.data?.data.length ? (
        <MeasurementTable
          readings={query.data.data}
          precision={parameterPrecisions(device)}
        />
      ) : (
        <DeviceEmpty
          title="Waiting for measurements"
          description="The configuration is applied. The next source update fills this table."
        />
      )}
    </Section>
  )
}
