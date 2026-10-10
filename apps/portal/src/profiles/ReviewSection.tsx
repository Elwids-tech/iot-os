import { Fragment, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import type {
  DeviceProfileArtifact,
  DeviceProfileDetail,
  DeviceProfileDiagnostic,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@iot-os/ui/components/table"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@iot-os/ui/components/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@iot-os/ui/components/dialog"
import { JsonEditor } from "@iot-os/ui/components/json-editor"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { formatAge, formatDateTime } from "@iot-os/ui/lib/format"
import { api } from "../lib/api"
import { Pager, RequestError } from "../components/forms"
import { useStudio, useProfileValidation, publishBlocker } from "./use-studio"
import { plural } from "./ProfileDirectory"
import { useReturnTo } from "./device-setup"
import {
  artifactChanges,
  fieldChanges,
  jsonText,
  kindLabel,
} from "./authoring"
const areas = [
  { key: "overview", label: "Profile" },
  { key: "parameters", label: "Parameters" },
  { key: "calculations", label: "Calculations" },
  { key: "alarms", label: "Alarm templates" },
] as const
/** Section and item name for a diagnostic pointer such as /parameters/{uuid}/rule. */
function locate(diagnostic: DeviceProfileDiagnostic, profile: DeviceProfileDetail) {
  const [, area, id] = diagnostic.pointer.split("/")
  if (area === "parameters")
    return {
      section: "parameters",
      item: profile.parameters.find((item) => item.uuid === id)?.label,
    }
  if (area === "calculations")
    return {
      section: "calculations",
      item: profile.parameters.find((item) => item.calculation?.uuid === id)
        ?.label,
    }
  if (area === "alarm_templates")
    return {
      section: "alarms",
      item: profile.alarm_templates.find((item) => item.uuid === id)?.name,
    }
  return { section: "overview", item: profile.name }
}
export function ReviewSection() {
  const studio = useStudio(),
    { profile } = studio
  const check = useProfileValidation()
  const [error, setError] = useState<unknown>(null)
  const [page, setPage] = useState(1),
    [artifact, setArtifact] = useState<DeviceProfileArtifact | null>(null)
  const history = useQuery({
    queryKey: ["artifacts", studio.org, profile.uuid, page],
    queryFn: () => api.profileArtifacts(studio.org, profile.uuid, page),
  })
  const result = check.data
  const changes = result?.compiled
    ? artifactChanges(
        profile.active_artifact?.definition ?? null,
        result.compiled.definition,
      )
    : []
  const fields = fieldChanges(changes)
  const diagnostics = (result?.validation.diagnostics ?? []).map(
    (diagnostic) => ({ ...diagnostic, ...locate(diagnostic, profile) }),
  )
  const base =
    "/organizations/" + studio.org + "/device-profiles/" + profile.uuid
  const blocker = publishBlocker(studio, check)
  const { keep } = useReturnTo()
  return (
    <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-8">
        <section aria-labelledby="review-validation" className="flex flex-col gap-3">
          <h2 id="review-validation" className="text-sm font-semibold">
            Validation
          </h2>
          <RequestError error={check.error} />
          {!studio.capabilities.validate ? (
            <p className="text-sm text-muted-foreground">
              Your role can view this profile but can't validate it.
            </p>
          ) : !result ? (
            <p className="text-sm text-muted-foreground">
              Validate the saved draft to check it and list its changes.
            </p>
          ) : result.validation.valid ? (
            <StatusMark tone="good">Saved draft passed validation</StatusMark>
          ) : (
            <>
              <StatusMark tone="critical">
                Resolve {plural(diagnostics.length, "issue")} before publishing
              </StatusMark>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead>Code</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {areas.map((area) => {
                    const rows = diagnostics.filter(
                      (item) => item.section === area.key,
                    )
                    if (!rows.length) return null
                    return (
                      <Fragment key={area.key}>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableCell colSpan={3} className="font-medium">
                            <Link
                              className="text-primary hover:underline"
                              to={keep(base + "/" + area.key)}
                            >
                              {area.label}
                            </Link>
                          </TableCell>
                        </TableRow>
                        {rows.map((item, index) => (
                          <TableRow key={index}>
                            <TableCell>{item.item ?? area.label}</TableCell>
                            <TableCell className="whitespace-normal">
                              {item.message}
                            </TableCell>
                            <TableCell
                              className="font-mono text-xs text-muted-foreground"
                              title={item.pointer}
                            >
                              {item.code}
                            </TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </section>
        {result?.compiled && (
          <section aria-labelledby="review-changes">
            <Tabs defaultValue="fields" className="gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="review-changes" className="text-sm font-semibold">
                  Changes since{" "}
                  {profile.revision ? "version " + profile.revision : "creation"}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {plural(fields.length, "change")}
                  </span>
                </h2>
                <TabsList aria-label="Change view">
                  <TabsTrigger value="fields">Fields</TabsTrigger>
                  <TabsTrigger value="json">JSON</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="fields">
                {fields.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Area</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Field</TableHead>
                        <TableHead>Before</TableHead>
                        <TableHead>After</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fields.map((row, index) => (
                        <TableRow key={index}>
                          <TableCell className="text-muted-foreground">
                            {kindLabel(row.area)}
                          </TableCell>
                          <TableCell>{row.item}</TableCell>
                          <TableCell title={row.path || undefined}>
                            {row.field}
                          </TableCell>
                          <TableCell
                            className="max-w-64 truncate font-mono text-xs text-muted-foreground"
                            title={row.before}
                          >
                            {row.before}
                          </TableCell>
                          <TableCell
                            className="max-w-64 truncate font-mono text-xs"
                            title={row.after}
                          >
                            {row.after}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No published behaviour changes. The draft only changes
                    authoring details.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="json">
                <JsonEditor
                  label="Changes as JSON"
                  readOnly
                  value={jsonText(changes)}
                />
              </TabsContent>
            </Tabs>
          </section>
        )}
      </div>
      <aside aria-label="Publishing" className="flex min-w-0 flex-col gap-8">
        <section aria-labelledby="review-publish" className="flex flex-col gap-1 text-sm">
          <h2 id="review-publish" className="mb-1 font-semibold">
            Publish
          </h2>
          <p>{blocker ?? "Ready to publish as version " + (profile.revision + 1)}</p>
          <p className="text-muted-foreground">
            Publishing doesn't change devices. Activation is separate.
          </p>
        </section>
        <section aria-labelledby="review-versions" className="flex flex-col gap-2">
          <h2 id="review-versions" className="text-sm font-semibold">
            Versions
            {history.data && (
              <span className="ml-2 font-normal text-muted-foreground">
                {history.data.meta.total}
              </span>
            )}
          </h2>
          <RequestError error={history.error ?? error}>
            <Button variant="outline" onClick={() => history.refetch()}>
              Retry version history
            </Button>
          </RequestError>
          {history.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading versions…
            </p>
          ) : !history.data?.data.length ? (
            <p className="text-sm text-muted-foreground">
              No published versions yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data.data.map((item) => (
                  <TableRow key={item.uuid}>
                    <TableCell title={item.definition_hash.slice(0, 12)}>
                      Version {item.revision}
                      {item.revision === profile.revision && (
                        <span className="text-muted-foreground">
                          {profile.status === "archived" ? " · latest" : " · live"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground tabular-nums"
                      title={formatDateTime(item.compiled_at)}
                    >
                      {formatAge(item.compiled_at)} ago
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={"Inspect version " + item.revision}
                        onClick={async () => {
                          try {
                            setError(null)
                            setArtifact(
                              await api.profileArtifact(
                                studio.org,
                                profile.uuid,
                                item.revision,
                              ),
                            )
                          } catch (reason) {
                            setError(reason)
                          }
                        }}
                      >
                        Inspect
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {history.data && history.data.meta.last_page > 1 && (
            <Pager
              page={page}
              pages={history.data.meta.last_page}
              onPage={setPage}
            />
          )}
        </section>
      </aside>
      <Dialog
        open={Boolean(artifact)}
        onOpenChange={(open) => {
          if (!open) setArtifact(null)
        }}
      >
        <DialogContent className="flex max-h-[90svh] flex-col overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Version {artifact?.revision}</DialogTitle>
            <DialogDescription>
              Published definitions can't be edited.
            </DialogDescription>
          </DialogHeader>
          {artifact && (
            <JsonEditor
              label={"Version " + artifact.revision}
              readOnly
              value={jsonText(artifact.definition)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
