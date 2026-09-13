import type { DeviceProfileParameter, HistoryRecord } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { cn } from "@iot-os/ui/lib/utils"
import { formatValue } from "../devices/shared"
import {
  booleanValue,
  isColorParameter,
  stateLabel,
  validHexColor,
} from "./model"

export function QualityBadge({ quality }: { quality: string }) {
  const variant =
    quality === "good"
      ? "success"
      : quality === "invalid"
        ? "destructive"
        : quality === "stale" || quality === "inactive"
          ? "warning"
          : "secondary"
  return <Badge variant={variant}>{quality || "unknown"}</Badge>
}

export function HistoryValue({
  record,
  parameter,
}: {
  record: HistoryRecord
  parameter?: DeviceProfileParameter
}) {
  if (record.data_type === "boolean") {
    const value = booleanValue(record.value)
    return (
      <Badge variant={value ? "success" : "secondary"}>
        {stateLabel(record.value, value !== null, "boolean")}
      </Badge>
    )
  }
  if (record.data_type === "enum")
    return <Badge variant="outline">{formatValue(record.value)}</Badge>
  if (isColorParameter(parameter)) {
    const color = validHexColor(record.value) ? record.value : null
    return (
      <span className="inline-flex items-center gap-2 font-mono">
        <span
          aria-hidden
          className={cn(
            "size-4 shrink-0 rounded-sm border",
            !color && "bg-muted",
          )}
          style={color ? { backgroundColor: color } : undefined}
        />
        {formatValue(record.value)}
      </span>
    )
  }
  const value = formatValue(record.value)
  return (
    <span
      className={cn(
        ["number", "integer"].includes(record.data_type) &&
          "font-mono tabular-nums",
        record.data_type === "string" && "break-all",
      )}
    >
      {value}
      {record.unit ? (
        <span className="ml-1 text-muted-foreground">{record.unit}</span>
      ) : null}
    </span>
  )
}
