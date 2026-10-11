import { Status } from "@iot-os/ui/components/status-mark"
import { RelativeTime } from "@iot-os/ui/components/freshness"
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
import { Button } from "@iot-os/ui/components/button"
import { LayoutDashboardIcon } from "lucide-react"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import {
  DeviceEmpty,
  formatReading,
  parameterPrecisions,
  Section,
} from "./shared"

export function MeasurementTable({
  readings,
  precision,
  onAdd,
}: {
  readings: Measurement[]
  precision?: Map<string, number | undefined>
  /** Starts Add to dashboard with this parameter selected. */
  onAdd?: (parameterUuid: string) => void
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
          {onAdd && <TableHead className="w-0"><span className="sr-only">Actions</span></TableHead>}
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
              <Status value={r.quality} />
              {r.diagnostic && (
                <p className="max-w-xs text-xs whitespace-normal text-muted-foreground">
                  {r.diagnostic}
                </p>
              )}
            </TableCell>
            <TableCell className="text-right">
              <RelativeTime at={r.observed_at} />
            </TableCell>
            <TableCell className="text-right">
              <RelativeTime at={r.received_at} />
            </TableCell>
            {onAdd && (
              <TableCell className="text-right">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Add ${r.label} to a dashboard`}
                  title="Add to dashboard"
                  onClick={() => onAdd(r.parameter_uuid)}
                >
                  <LayoutDashboardIcon />
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
export function MeasurementsSection({
  org,
  device,
  onAddToDashboard,
}: {
  org: string
  device: DeviceDetail
  onAddToDashboard?: (parameterUuid: string) => void
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
          onAdd={onAddToDashboard}
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
