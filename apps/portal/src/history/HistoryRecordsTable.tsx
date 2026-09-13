import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type {
  DeviceDetail,
  DeviceProfileParameter,
  HistoryRecord,
} from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@iot-os/ui/components/pagination"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "lucide-react"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { formatTime } from "../devices/shared"
import { HistoryValue, QualityBadge } from "./HistoryValue"
import { buildHistoryCsv, configurationMeta, historyFileName } from "./model"

const PAGE_SIZE = 50

export function HistoryRecordsTable({
  org,
  device,
  parameter,
  window,
  limit,
}: {
  org: string
  device: DeviceDetail
  parameter: DeviceProfileParameter
  window: { from: string; to: string }
  limit: number
}) {
  const [page, setPage] = useState(0)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<unknown>(null)
  const [exportResult, setExportResult] = useState<{
    count: number
    limitReached: boolean
  } | null>(null)
  const cursor = cursors[page]
  const query = useQuery({
    queryKey: [
      "device-history-records",
      org,
      device.uuid,
      parameter.uuid,
      window.from,
      window.to,
      limit,
      cursor,
    ],
    queryFn: ({ signal }) =>
      api.deviceHistoryRecords(
        org,
        device.uuid,
        {
          parameter_uuid: parameter.uuid,
          ...window,
          limit,
          page_size: PAGE_SIZE,
          cursor,
        },
        signal,
      ),
    placeholderData: (previous) => previous,
  })

  async function exportCsv() {
    setExporting(true)
    setExportError(null)
    setExportResult(null)
    try {
      const records: HistoryRecord[] = []
      let exportCursor: string | undefined
      let limitReached = false
      do {
        const result = await api.deviceHistoryRecords(org, device.uuid, {
          parameter_uuid: parameter.uuid,
          ...window,
          limit,
          page_size: 100,
          cursor: exportCursor,
        })
        records.push(...result.data)
        limitReached = result.meta.limit_reached
        exportCursor = result.meta.next_cursor ?? undefined
      } while (exportCursor)
      const csv = buildHistoryCsv(records, {
        deviceUuid: device.uuid,
        deviceName: device.name,
        parameterUuid: parameter.uuid,
        parameterKey: parameter.key,
        parameterLabel: parameter.label,
        configurations: device.configurations,
      })
      const href = URL.createObjectURL(
        new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
      )
      const link = document.createElement("a")
      link.href = href
      link.download = historyFileName(device.name, parameter.key)
      document.body.append(link)
      link.click()
      link.remove()
      globalThis.setTimeout(() => URL.revokeObjectURL(href), 0)
      setExportResult({ count: records.length, limitReached })
    } catch (error) {
      setExportError(error)
    } finally {
      setExporting(false)
    }
  }

  const firstRecord = page * PAGE_SIZE + 1
  const lastRecord = page * PAGE_SIZE + (query.data?.data.length ?? 0)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Timestamped values</p>
          <p className="text-xs text-muted-foreground">
            Latest {limit.toLocaleString()} matching records, 50 per page.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={exporting}
          onClick={() => void exportCsv()}
        >
          <DownloadIcon data-icon="inline-start" />
          {exporting ? "Preparing CSV…" : "Download CSV"}
        </Button>
      </div>
      <RequestError error={query.error ?? exportError} />
      {query.isPending ? (
        <Skeleton className="h-56 w-full" />
      ) : query.data?.data.length ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Quality</TableHead>
                <TableHead>Device configuration</TableHead>
                <TableHead>Profile revision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.data.map((record) => {
                const meta = configurationMeta(
                  device.configurations,
                  record.configuration_uuid,
                )
                return (
                  <TableRow key={`${record.received_at}:${record.event_uuid}`}>
                    <TableCell className="whitespace-nowrap">
                      {formatTime(record.received_at)}
                    </TableCell>
                    <TableCell>
                      <HistoryValue record={record} parameter={parameter} />
                    </TableCell>
                    <TableCell>
                      <QualityBadge quality={record.quality} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {meta.configurationLabel}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {meta.profileLabel}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No exact records in this range.
        </p>
      )}
      {(query.data?.meta.limit_reached || exportResult?.limitReached) && (
        <Alert>
          <AlertDescription>
            The selected limit was reached.
            {exportResult
              ? ` The CSV contains the latest ${exportResult.count.toLocaleString()} matching records.`
              : ""}{" "}
            Increase the record limit to view and export older matching records.
          </AlertDescription>
        </Alert>
      )}
      {query.data?.data.length ? (
        <Pagination aria-label="History record pages">
          <PaginationContent className="w-full justify-between">
            <PaginationItem>
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0 || query.isFetching}
                onClick={() => setPage((current) => current - 1)}
              >
                <ChevronLeftIcon data-icon="inline-start" />
                Previous
              </Button>
            </PaginationItem>
            <PaginationItem>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} · records {firstRecord}–{lastRecord}
              </span>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="outline"
                size="sm"
                disabled={!query.data.meta.next_cursor || query.isFetching}
                onClick={() => {
                  const next = query.data?.meta.next_cursor
                  if (!next) return
                  setCursors((current) => [...current.slice(0, page + 1), next])
                  setPage((current) => current + 1)
                }}
              >
                Next
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  )
}
