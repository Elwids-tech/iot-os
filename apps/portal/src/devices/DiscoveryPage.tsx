import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import type { DiscoveryCandidate } from "@iot-os/api-client"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
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
import { api } from "../lib/api"
import { RequestError, Confirm, TextField } from "../components/forms"
import {
  devicePath,
  DevicePages,
  DeviceStatus,
  DeviceEmpty,
  formatTime,
  useDeviceOrganization,
} from "./shared"
import { RegisterDevice } from "./DeviceDirectory"

export function DiscoveryPage() {
  const { org, capabilities } = useDeviceOrganization(),
    navigate = useNavigate()
  const [params] = useSearchParams(),
    [page, setPage] = useState(1),
    [attachPage, setAttachPage] = useState(1),
    [deviceSearch, setDeviceSearch] = useState("")
  const [selected, setSelected] = useState<DiscoveryCandidate | null>(null),
    [create, setCreate] = useState(false),
    [existing, setExisting] = useState("")
  const [review, setReview] = useState<DiscoveryCandidate | null>(null),
    [search, setSearch] = useState("")
  const query = useQuery({
    queryKey: ["discovery-directory", org, search, page, params.get("gateway")],
    queryFn: () =>
      api.discoveryPage(org, {
        search,
        page,
        gateway_uuid: params.get("gateway") ?? undefined,
        per_page: 25,
      }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const devices = useQuery({
    queryKey: ["devices-attach", org, deviceSearch, attachPage],
    queryFn: () => api.devices(org, { search: deviceSearch, page: attachPage }),
  })
  const candidates = query.data?.data ?? []
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Discovery</h1>
        <p className="text-muted-foreground">
          Review sources announced by your Sparkplug gateways before adding them
          to a device.
        </p>
      </div>
      <RequestError error={query.error ?? devices.error} />
      <TextField
        label="Search discovered sources"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setPage(1)
        }}
      />
      <Card>
        <CardHeader>
          <CardTitle>Discovered sources</CardTitle>
          <CardDescription>
            A birth certificate makes a source discoverable. Activation is a
            separate, reviewed action.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {candidates.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Metrics</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((c) => (
                  <TableRow key={c.uuid}>
                    <TableCell>
                      {c.source_device_id || "Edge Node measurements"}
                      <p className="text-xs text-muted-foreground">
                        Birth revision {c.birth_revision}
                      </p>
                    </TableCell>
                    <TableCell>{c.gateway.name}</TableCell>
                    <TableCell>
                      <DeviceStatus value={c.status} />
                    </TableCell>
                    <TableCell>{c.metrics.length}</TableCell>
                    <TableCell>{formatTime(c.last_seen_at)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {c.assigned_device_uuid && (
                          <Button asChild variant="outline" size="sm">
                            <Link to={devicePath(org, c.assigned_device_uuid)}>
                              View device
                            </Link>
                          </Button>
                        )}
                        {capabilities.manage && !c.assigned_device_uuid && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={c.status === "rejected"}
                              onClick={() => {
                                setSelected(c)
                                setExisting("")
                              }}
                            >
                              Onboard
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setReview(c)}
                            >
                              {c.status === "rejected" ? "Restore" : "Ignore"}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <DeviceEmpty
              title="No sources discovered yet"
              description="Register a gateway, connect it with its scoped credentials, and wait for a birth certificate."
            />
          )}
          <DevicePages
            meta={query.data?.meta}
            onPage={setPage}
            label="Discovered sources"
          />
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        <Link className="underline" to={`/organizations/${org}/gateways`}>
          Manage gateways and connections
        </Link>
      </p>
      <Dialog
        open={Boolean(selected) && !create}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Onboard {selected?.source_device_id || "Edge Node measurements"}
            </DialogTitle>
            <DialogDescription>
              Create a new device or attach this source to an existing
              registered device.
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
            ? "Restore discovery candidate?"
            : "Ignore this discovery candidate?"
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
    </div>
  )
}
