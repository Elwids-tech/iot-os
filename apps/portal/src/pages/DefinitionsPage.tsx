import { useEffect, useState } from "react"
import type { Organization } from "@iot-os/api-client"
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
import { FileCode2Icon, PlusIcon } from "lucide-react"
import { Link, useOutletContext } from "react-router-dom"
import { PageError, PageHeading, PageLoading } from "../components/PageStates"
import { StateBadge } from "../components/StateBadge"
import { loadDefinitionCatalog, type DefinitionCatalog } from "../device-domain/catalog"

type CatalogState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; catalog: DefinitionCatalog }

export function DefinitionsPage() {
  const organization = useOutletContext<Organization>()
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<CatalogState>({ status: "loading" })

  useEffect(() => {
    let active = true

    setState({ status: "loading" })
    loadDefinitionCatalog()
      .then((catalog) => {
        if (active) setState({ status: "ready", catalog })
      })
      .catch(() => {
        if (active) setState({ status: "error" })
      })

    return () => {
      active = false
    }
  }, [organization.uuid, reload])

  const createUrl = `/organizations/${organization.uuid}/definitions/new`

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
      <PageHeading
        title="Device definitions"
        description="Author semantic Device Profiles and their Native MQTT JSON mappings as one coordinated, versioned definition."
        actions={
          <Button asChild>
            <Link to={createUrl}>
              <PlusIcon data-icon="inline-start" />
              Create definition
            </Link>
          </Button>
        }
      />

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Definition catalog</CardTitle>
          <CardDescription>
            Drafts remain editable. Published Profile and Binding Versions are immutable and can
            be assigned to Devices.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {state.status === "loading" ? (
            <div className="p-6">
              <PageLoading label="Loading Device definitions…" />
            </div>
          ) : state.status === "error" ? (
            <div className="p-6">
              <PageError retry={() => setReload((value) => value + 1)} />
            </div>
          ) : state.catalog.entries.length === 0 && state.catalog.unboundProfiles.length === 0 ? (
            <Empty className="min-h-72">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileCode2Icon />
                </EmptyMedia>
                <EmptyTitle>No Device definitions yet</EmptyTitle>
                <EmptyDescription>
                  Start with the guided temperature, humidity, and thermostat definition.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild>
                  <Link to={createUrl}>Create definition</Link>
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Profile</TableHead>
                  <TableHead>Binding</TableHead>
                  <TableHead>Versions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.catalog.entries.map((entry) => {
                  const isDraft =
                    entry.profileVersion.state === "draft" &&
                    entry.bindingVersion.state === "draft"
                  const actionUrl = isDraft
                    ? `/organizations/${organization.uuid}/definitions/${entry.bindingVersion.uuid}/edit`
                    : `/organizations/${organization.uuid}/devices/onboard?definition=${entry.bindingVersion.uuid}`

                  return (
                    <TableRow key={entry.bindingVersion.uuid}>
                      <TableCell>
                        <div className="flex min-w-48 flex-col gap-1">
                          <span className="font-medium">{entry.profile.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {entry.profile.key}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-48 flex-col gap-1">
                          <span>{entry.binding.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {entry.binding.key}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        Profile v{entry.profileVersion.version} · Binding v
                        {entry.bindingVersion.version}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <StateBadge state={entry.profileVersion.state} />
                          {entry.bindingVersion.state !== entry.profileVersion.state ? (
                            <StateBadge state={entry.bindingVersion.state} />
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant={isDraft ? "outline" : "default"}>
                          <Link to={actionUrl}>{isDraft ? "Continue draft" : "Onboard Device"}</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {state.catalog.unboundProfiles.map((profile) => (
                  <TableRow key={profile.uuid}>
                    <TableCell>
                      <div className="flex min-w-48 flex-col gap-1">
                        <span className="font-medium">{profile.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {profile.key}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">No Binding</TableCell>
                    <TableCell className="tabular-nums">{profile.versions_count ?? 0}</TableCell>
                    <TableCell>
                      <StateBadge state="draft" />
                    </TableCell>
                    <TableCell />
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
