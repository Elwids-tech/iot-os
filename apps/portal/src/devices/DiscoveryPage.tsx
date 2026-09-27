import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import type { DiscoveryCandidate } from "@iot-os/api-client"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Button } from "@iot-os/ui/components/button"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@iot-os/ui/components/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { XIcon } from "lucide-react"
import { api } from "../lib/api"
import { RequestError, Confirm } from "../components/forms"
import {
  Age,
  devicePath,
  DevicePages,
  DeviceStatus,
  DeviceEmpty,
  gatewayPath,
  useDeviceOrganization,
} from "./shared"
import { RegisterDevice } from "./DeviceDirectory"

const sourceName = (c: DiscoveryCandidate) =>
  c.source_device_id || "Gateway measurements"

export function DiscoveryPage() {
  const { org, capabilities } = useDeviceOrganization(),
    navigate = useNavigate()
  const [params, setParams] = useSearchParams(),
    [page, setPage] = useState(1),
    [attachPage, setAttachPage] = useState(1),
    [deviceSearch, setDeviceSearch] = useState("")
  const [selected, setSelected] = useState<DiscoveryCandidate | null>(null),
    [create, setCreate] = useState(false),
    [existing, setExisting] = useState("")
  const [review, setReview] = useState<DiscoveryCandidate | null>(null)
  const search = params.get("search") ?? "",
    gateway = params.get("gateway") ?? ""
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
    setPage(1)
  }
  const query = useQuery({
    queryKey: ["discovery-directory", org, search, page, gateway],
    queryFn: () =>
      api.discoveryPage(org, {
        search,
        page,
        gateway_uuid: gateway || undefined,
        per_page: 25,
      }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const devices = useQuery({
    queryKey: ["devices-attach", org, deviceSearch, attachPage],
    queryFn: () => api.devices(org, { search: deviceSearch, page: attachPage }),
    enabled: Boolean(selected),
  })
  const candidates = query.data?.data ?? []
  const total = query.data?.meta.total
  return (
    <>
      <PageHeader
        title="Discovery"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={gatewayPath(org)}>Gateways</Link>
          </Button>
        }
      >
        <Input
          aria-label="Search discovered sources"
          placeholder="Search source or gateway"
          className="h-8 w-full sm:w-64"
          value={search}
          onChange={(e) => filter("search", e.target.value)}
        />
        {gateway && (
          <span className="inline-flex h-7 items-center gap-1 rounded-md border pr-0.5 pl-2 text-sm">
            Gateway: {candidates[0]?.gateway.name ?? "selected"}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Clear gateway filter"
              onClick={() => filter("gateway", "")}
            >
              <XIcon />
            </Button>
          </span>
        )}
        {total !== undefined && (
          <span className="ml-auto text-sm text-muted-foreground" role="status">
            {total === 1 ? "1 source" : `${total} sources`}
          </span>
        )}
      </PageHeader>
      <div className="p-4 md:p-6">
        <RequestError error={query.error ?? devices.error} />
        {query.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : candidates.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Gateway</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Metrics</TableHead>
                <TableHead>Device</TableHead>
                <TableHead className="text-right">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.map((c) => (
                <TableRow key={c.uuid}>
                  <TableCell>
                    <span className="font-mono">{sourceName(c)}</span>
                    <p className="text-xs text-muted-foreground">
                      <abbr
                        title="Sparkplug birth certificate revision"
                        className="cursor-help"
                      >
                        Announced revision
                      </abbr>{" "}
                      {c.birth_revision}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Link
                      className="text-primary underline-offset-4 hover:underline"
                      to={gatewayPath(org, c.gateway.uuid)}
                    >
                      {c.gateway.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <DeviceStatus value={c.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.metrics.length}
                  </TableCell>
                  <TableCell>
                    {c.assigned_device_uuid ? (
                      <Link
                        className="text-primary underline-offset-4 hover:underline"
                        to={devicePath(org, c.assigned_device_uuid)}
                      >
                        View device
                      </Link>
                    ) : capabilities.manage ? (
                      <div className="flex gap-2">
                        {c.status !== "rejected" && (
                          <Button
                            size="xs"
                            onClick={() => {
                              setSelected(c)
                              setExisting("")
                            }}
                          >
                            Onboard
                          </Button>
                        )}
                        <Button size="xs" variant="ghost" onClick={() => setReview(c)}>
                          {c.status === "rejected" ? "Restore" : "Ignore"}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Not onboarded</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Age value={c.last_seen_at} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : search || gateway ? (
          <DeviceEmpty title="No matching sources">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
            >
              Clear filters
            </Button>
          </DeviceEmpty>
        ) : (
          <DeviceEmpty
            title="No sources discovered yet"
            description="Sources appear here when a registered gateway connects and announces them."
          />
        )}
        <DevicePages
          meta={query.data?.meta}
          onPage={setPage}
          label="Discovered sources"
        />
      </div>
      <Dialog
        open={Boolean(selected) && !create}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Onboard {selected ? sourceName(selected) : ""}
            </DialogTitle>
            <DialogDescription>
              Attach it to a registered device that has no configuration yet,
              or register a new device.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <SearchableSelect
              search={deviceSearch}
              onSearchChange={(value) => {
                setDeviceSearch(value)
                setAttachPage(1)
              }}
              loading={devices.isLoading}
              page={attachPage}
              hasNextPage={Boolean(
                devices.data && attachPage < devices.data.meta.last_page,
              )}
              onPageChange={setAttachPage}
              label="Existing device"
              value={existing}
              onChange={setExisting}
              options={[
                { value: "", label: "Choose a registered device" },
                ...(devices.data?.data ?? [])
                  .filter(
                    (d) =>
                      !d.applied_configuration_uuid &&
                      d.lifecycle !== "archived",
                  )
                  .map((d) => ({ value: d.uuid, label: d.name })),
              ]}
            />
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreate(true)}>
              Register new device
            </Button>
            <Button
              disabled={!existing}
              onClick={() =>
                navigate(
                  devicePath(org, existing) +
                    "/configuration?candidate=" +
                    selected!.uuid,
                )
              }
            >
              Configure selected device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {create && selected && (
        <RegisterDevice
          org={org}
          candidate={selected.uuid}
          onClose={() => {
            setCreate(false)
            setSelected(null)
          }}
        />
      )}
      <Confirm
        open={Boolean(review)}
        title={
          review?.status === "rejected"
            ? "Restore this source?"
            : "Ignore this source?"
        }
        description="This changes the review status only. It does not change the gateway or send a device command."
        action={review?.status === "rejected" ? "Restore" : "Ignore"}
        destructive={false}
        onClose={() => setReview(null)}
        onConfirm={async () => {
          if (review)
            await api.reviewCandidate(
              org,
              review.uuid,
              review.status === "rejected" ? "pending" : "rejected",
              review.birth_revision,
            )
          await query.refetch()
        }}
      />
    </>
  )
}
