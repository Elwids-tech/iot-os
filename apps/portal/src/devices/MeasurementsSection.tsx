import { useQuery } from "@tanstack/react-query"
import type { DeviceDetail, Measurement } from "@iot-os/api-client"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card"
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
import { DeviceEmpty, DeviceStatus, formatTime, formatValue } from "./shared"

export function MeasurementTable({ readings }: { readings: Measurement[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Parameter</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Quality</TableHead>
          <TableHead>Observed</TableHead>
          <TableHead>Received</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {readings.map((r) => (
          <TableRow key={r.parameter_uuid}>
            <TableCell>
              {r.label}
              <p className="text-xs text-muted-foreground">{r.key}</p>
            </TableCell>
            <TableCell className="max-w-64 truncate font-mono tabular-nums">
              {formatValue(r.value)} {r.unit}
            </TableCell>
            <TableCell>
              <DeviceStatus value={r.quality} />
              {r.diagnostic && (
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  {r.diagnostic}
                </p>
              )}
            </TableCell>
            <TableCell>{formatTime(r.observed_at)}</TableCell>
            <TableCell>{formatTime(r.received_at)}</TableCell>
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
  const query = useQuery({
    queryKey: [
      "device-latest",
      org,
      device.uuid,
      device.applied_configuration_uuid ?? device.last_applied_configuration_uuid,
      device.lifecycle,
    ],
    queryFn: () => api.deviceLatest(org, device.uuid),
    enabled: Boolean(device.applied_configuration_uuid || device.last_applied_configuration_uuid),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Latest measurements</CardTitle>
        <CardDescription>
          {device.lifecycle === "deactivated" ? "Ingestion is disabled. These are retained readings from the last working configuration. " : "Updates every five seconds while this page is visible. "}Invalid
          readings preserve the last valid value and show their current quality.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RequestError error={query.error} />
        {!device.applied_configuration_uuid && !device.last_applied_configuration_uuid ? (
          <DeviceEmpty
            title="Configure and activate this device"
            description="Measurements appear after the runtime applies a reviewed configuration and receives data."
          />
        ) : query.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : query.data?.data.length ? (
          <MeasurementTable readings={query.data.data} />
        ) : (
          <DeviceEmpty
            title="Waiting for measurements"
            description="The configuration is applied. The next source update will populate this table."
          />
        )}
      </CardContent>
    </Card>
  )
}
