import { useEffect, useState } from "react"
import type { Device, Organization, PaginatedResponse } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table"
import { CpuIcon, PlusIcon } from "lucide-react"
import { Link, useOutletContext } from "react-router-dom"
import { PageError, PageHeading, PageLoading } from "../components/PageStates"
import { StateBadge } from "../components/StateBadge"
import { apiClient } from "../lib/api-client"

type DeviceState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; response: PaginatedResponse<Device> }

function shortUuid(uuid: string): string {
  return `${uuid.slice(0, 8)}…${uuid.slice(-4)}`
}

export function DevicesPage() {
  const organization = useOutletContext<Organization>()
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<DeviceState>({ status: "loading" })

  useEffect(() => {
    let active = true

    setState({ status: "loading" })
    apiClient
      .devices({ perPage: 100 })
      .then((response) => {
        if (active) setState({ status: "ready", response })
      })
      .catch(() => {
        if (active) setState({ status: "error" })
      })

    return () => {
      active = false
    }
  }, [organization.uuid, reload])

  const onboardingUrl = `/organizations/${organization.uuid}/devices/onboard`

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
      <PageHeading
        title="Devices"
        description="Create a Device draft, pin an exact published Profile and Binding Version, then explicitly register it."
        actions={
          <Button asChild>
            <Link to={onboardingUrl}>
              <PlusIcon data-icon="inline-start" />
              Onboard Device
            </Link>
          </Button>
        }
      />

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Device registry</CardTitle>
          <CardDescription>
            Registration makes the current immutable definition assignment operationally fixed.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {state.status === "loading" ? (
            <div className="p-6">
              <PageLoading label="Loading Devices…" />
            </div>
          ) : state.status === "error" ? (
            <div className="p-6">
              <PageError retry={() => setReload((value) => value + 1)} />
            </div>
          ) : state.response.data.length === 0 ? (
            <Empty className="min-h-72">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CpuIcon />
                </EmptyMedia>
                <EmptyTitle>No Devices registered</EmptyTitle>
                <EmptyDescription>
                  Publish a Device definition, then onboard the first physical or simulated Device
                  identity.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild>
                  <Link to={onboardingUrl}>Onboard Device</Link>
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>External ID</TableHead>
                  <TableHead>Lifecycle</TableHead>
                  <TableHead>Definition assignment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.response.data.map((device) => (
                  <TableRow key={device.uuid}>
                    <TableCell>
                      <div className="flex min-w-48 flex-col gap-1">
                        <span className="font-medium">{device.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {shortUuid(device.uuid)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{device.external_id}</TableCell>
                    <TableCell>
                      <StateBadge state={device.lifecycle_state} />
                    </TableCell>
                    <TableCell>
                      {device.definition_assignment ? (
                        <div className="flex min-w-56 flex-col gap-1 text-xs">
                          <span>
                            Profile {shortUuid(device.definition_assignment.profile_version_uuid)}
                          </span>
                          <span className="text-muted-foreground">
                            Binding {shortUuid(device.definition_assignment.binding_version_uuid)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Not assigned</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
