import { useMemo, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import type {
  DeviceDetail,
  DeviceProfileParameter,
  HistoryRecord,
} from "@iot-os/api-client"
import { DataTable, ToolbarButton, type DataColumn } from "@iot-os/ui/components/data-table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { DownloadIcon } from "lucide-react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { RequestError, errorMessage } from "../components/forms"
import { formatTime } from "../devices/shared"
import { HistoryValue, QualityBadge } from "./HistoryValue"
import {
  buildHistoryCsv,
  configurationMeta,
  deviceTimeOffset,
  historyFileName,
} from "./model"

/** The API's largest limit: browsing walks this many of the newest records, then stops. */
const BROWSE_LIMIT = 5000
const PAGE_SIZE = 50
const EXPORT_LIMITS = [100, 500, 1000, 5000]

/** Every record in the range, newest first, loaded a batch at a time from the cursor. */
export function HistoryRecordsTable({
  org,
  device,
  parameter,
  window,
}: {
  org: string
  device: DeviceDetail
  parameter: DeviceProfileParameter
  window: { from: string; to: string }
}) {
  const [exporting, setExporting] = useState(false)
  const query = useInfiniteQuery({
    queryKey: [
      "device-history-records",
      org,
      device.uuid,
      parameter.uuid,
      window.from,
      window.to,
    ],
    queryFn: ({ pageParam, signal }) =>
      api.deviceHistoryRecords(
        org,
        device.uuid,
        {
          parameter_uuid: parameter.uuid,
          ...window,
          limit: BROWSE_LIMIT,
          page_size: PAGE_SIZE,
          cursor: pageParam,
        },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    // Coming back to a parameter starts from the newest batch, not every batch loaded before.
    gcTime: 0,
  })
  const records = useMemo(
    () => query.data?.pages.flatMap((page) => page.data),
    [query.data],
  )
  const limitReached = query.data?.pages.at(-1)?.meta.limit_reached ?? false

  const columns = useMemo<DataColumn<HistoryRecord>[]>(
    () => [
      {
        id: "received",
        header: "Received",
        mobile: "title",
        value: (record) => record.received_at,
        cell: (record) => (
          <time dateTime={record.received_at}>
            {formatTime(record.received_at)}
          </time>
        ),
      },
      {
        id: "value",
        header: "Value",
        mobile: "badge",
        cell: (record) => <HistoryValue record={record} parameter={parameter} />,
      },
      {
        id: "quality",
        header: "Quality",
        value: (record) => record.quality,
        cell: (record) => (
          <span className="inline-flex items-center gap-2">
            <QualityBadge quality={record.quality} />
            {record.diagnostic ? (
              <span className="text-muted-foreground">{record.diagnostic}</span>
            ) : null}
          </span>
        ),
      },
      {
        id: "device-time",
        header: "Device time",
        hidden: true,
        value: (record) => record.observed_at,
        cell: (record) => {
          const offset = deviceTimeOffset(record)
          return (
            <>
              <time dateTime={record.observed_at}>
                {formatTime(record.observed_at)}
              </time>
              {offset && (
                <span className="ml-1.5 text-muted-foreground">{offset}</span>
              )}
            </>
          )
        },
      },
    ],
    [parameter],
  )

  async function exportCsv(limit: number) {
    setExporting(true)
    try {
      const exported: HistoryRecord[] = []
      let cursor: string | undefined
      let reached = false
      do {
        const result = await api.deviceHistoryRecords(org, device.uuid, {
          parameter_uuid: parameter.uuid,
          ...window,
          limit,
          page_size: 100,
          cursor,
        })
        exported.push(...result.data)
        reached = result.meta.limit_reached
        cursor = result.meta.next_cursor ?? undefined
      } while (cursor)
      const csv = buildHistoryCsv(exported, {
        deviceUuid: device.uuid,
        deviceName: device.name,
        parameterUuid: parameter.uuid,
        parameterKey: parameter.key,
        parameterLabel: parameter.label,
        configurations: device.configurations,
      })
      const href = URL.createObjectURL(
        new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }),
      )
      const link = document.createElement("a")
      link.href = href
      link.download = historyFileName(device.name, parameter.key)
      document.body.append(link)
      link.click()
      link.remove()
      globalThis.setTimeout(() => URL.revokeObjectURL(href), 0)
      toast.success(
        `Downloaded ${exported.length.toLocaleString()} ${exported.length === 1 ? "record" : "records"}`,
        {
          description: reached
            ? "Older records in this range were left out. Choose a larger download or a shorter range."
            : undefined,
        },
      )
    } catch (error) {
      toast.error("The CSV couldn't be prepared", {
        description: errorMessage(error),
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <DataTable
      id="device-history-records"
      label={`${parameter.label} records`}
      noun={["record", "records"]}
      rows={records}
      rowKey={(record) => `${record.received_at}:${record.event_uuid}`}
      columns={columns}
      bounded
      separator={(record, previous) => {
        if (previous?.configuration_uuid === record.configuration_uuid)
          return null
        const meta = configurationMeta(
          device.configurations,
          record.configuration_uuid,
        )
        return `${meta.configurationLabel} · ${meta.profileLabel}`
      }}
      loadMore={{
        hasMore: Boolean(query.hasNextPage),
        loading: query.isFetchingNextPage,
        onLoadMore: () => void query.fetchNextPage(),
        label: "Load older",
        note: query.isFetchNextPageError
          ? "older records couldn't load"
          : query.hasNextPage
            ? "newest first"
            : limitReached
              ? `only the newest ${BROWSE_LIMIT.toLocaleString()}; shorten the range for older ones`
              : "all in this range",
      }}
      error={
        query.error && !records ? <RequestError error={query.error} /> : undefined
      }
      empty={
        <EmptyState
          inset
          title="No records in this range"
          description="Choose another parameter or time range."
        />
      }
      toolbar={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ToolbarButton
              icon={<DownloadIcon />}
              label={exporting ? "Preparing CSV…" : "Download CSV"}
              disabled={exporting}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {EXPORT_LIMITS.map((limit) => (
              <DropdownMenuItem key={limit} onSelect={() => void exportCsv(limit)}>
                Newest {limit.toLocaleString()} records
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  )
}
