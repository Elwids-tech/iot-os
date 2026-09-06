import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import type {
  CompiledDraft,
  DeviceProfileValidationResult,
  DeviceProfileArtifact,
} from "@iot-os/api-client"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card"
import { Button } from "@iot-os/ui/components/button"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@iot-os/ui/components/accordion"
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@iot-os/ui/components/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@iot-os/ui/components/dialog"
import { JsonEditor } from "@iot-os/ui/components/json-editor"
import { CheckCircle2Icon, UploadIcon } from "lucide-react"
import { api } from "../lib/api"
import { RequestError, Confirm } from "../components/forms"
import { useStudio } from "./use-studio"
import { artifactChanges, jsonText, type ArtifactChange } from "./authoring"
export function ReviewSection() {
  const studio = useStudio(),
    { profile } = studio
  const [validation, setValidation] =
      useState<DeviceProfileValidationResult | null>(null),
    [compiled, setCompiled] = useState<CompiledDraft | null>(null)
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false)
  const [page, setPage] = useState(1),
    [artifact, setArtifact] = useState<DeviceProfileArtifact | null>(null)
  const [selectedChange, setSelectedChange] = useState<ArtifactChange | null>(
    null,
  )
  const history = useQuery({
    queryKey: ["artifacts", studio.org, profile.uuid, page],
    queryFn: () => api.profileArtifacts(studio.org, profile.uuid, page),
  })
  const current =
    validation?.draft_revision === profile.draft_revision &&
    compiled?.draft_revision === profile.draft_revision
  const ready = Boolean(
    current && validation?.valid && profile.status === "draft",
  )
  const changes =
    compiled && current
      ? artifactChanges(
          profile.active_artifact?.definition ?? null,
          compiled.definition,
        )
      : []
  async function validate() {
    setBusy(true)
    setError(null)
    setCompiled(null)
    try {
      const result = await api.validateDeviceProfile(
        studio.org,
        profile.uuid,
        profile.draft_revision,
      )
      setValidation(result)
      if (result.valid)
        setCompiled(
          await api.compileDeviceProfile(
            studio.org,
            profile.uuid,
            profile.draft_revision,
          ),
        )
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }
  const base =
    "/organizations/" + studio.org + "/device-profiles/" + profile.uuid
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Review saved changes</CardTitle>
              <CardDescription>
                Validate the exact saved draft, inspect its compiled changes,
                then publish an immutable revision.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={
                  busy ||
                  studio.busy ||
                  studio.blocked ||
                  !studio.capabilities.validate
                }
                onClick={validate}
              >
                <CheckCircle2Icon data-icon="inline-start" />
                {busy ? "Checking…" : "Validate draft"}
              </Button>
              <Button
                disabled={
                  !ready ||
                  busy ||
                  studio.busy ||
                  studio.blocked ||
                  !studio.capabilities.publish
                }
                onClick={() => setConfirm(true)}
              >
                <UploadIcon data-icon="inline-start" />
                Publish revision {profile.revision + 1}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!studio.capabilities.validate && (
            <p className="text-sm text-muted-foreground">
              Your role can inspect this profile but cannot validate it.
            </p>
          )}
          {profile.status === "published" && (
            <Alert>
              <AlertTitle>Published revision {profile.revision}</AlertTitle>
              <AlertDescription>
                There are no pending saved changes. Publication does not confirm
                activation on devices.
              </AlertDescription>
            </Alert>
          )}
          {validation && (
            <Alert variant={validation.valid ? "default" : "destructive"}>
              <AlertTitle>
                {validation.draft_revision !== profile.draft_revision
                  ? "Validation is outdated"
                  : validation.valid
                    ? "Saved draft passed validation"
                    : "Resolve these issues before publishing"}
              </AlertTitle>
              <AlertDescription>
                {validation.draft_revision !== profile.draft_revision ? (
                  "Run validation again for the latest draft."
                ) : validation.valid ? (
                  "Parameters, expressions, and references passed the server checks."
                ) : (
                  <ul className="list-disc pl-4">
                    {validation.diagnostics.map((diagnostic, index) => (
                      <li key={index}>
                        <Link
                          className="underline"
                          to={
                            base +
                            (diagnostic.pointer.includes("alarm")
                              ? "/alarms"
                              : diagnostic.pointer.includes("calculation")
                                ? "/calculations"
                                : "/parameters")
                          }
                        >
                          {diagnostic.message}
                        </Link>
                        <span className="block text-xs">{diagnostic.code}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}
          {compiled && current && (
            <>
              <h3 className="text-sm font-semibold">
                Compiled changes since{" "}
                {profile.revision ? "revision " + profile.revision : "creation"}
              </h3>
              {changes.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Area</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Change</TableHead>
                        <TableHead className="text-right">Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {changes.map((change, index) => (
                        <TableRow key={index}>
                          <TableCell>{change.area}</TableCell>
                          <TableCell>{change.label}</TableCell>
                          <TableCell>{change.change}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedChange(change)}
                            >
                              Inspect change
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No compiled behavior changes. The draft may contain
                  authoring-only metadata changes.
                </p>
              )}
              <Accordion type="single" collapsible>
                <AccordionItem value="compiled">
                  <AccordionTrigger>
                    Inspect compiled JSON (read only)
                  </AccordionTrigger>
                  <AccordionContent>
                    <JsonEditor
                      label="Compiled draft definition"
                      readOnly
                      value={jsonText(compiled.definition)}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </>
          )}
          {!validation && (
            <p className="text-sm text-muted-foreground">
              Run validation to get a checklist and a reviewable change summary.
            </p>
          )}
          <RequestError error={error} />
          <p className="text-xs text-muted-foreground">
            Publishing stores a platform definition. Device activation and live
            alarms are not part of this action.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Published revision history</CardTitle>
          <CardDescription>
            Previous definitions are immutable and remain available for
            inspection.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <RequestError error={history.error}>
            <Button variant="outline" onClick={() => history.refetch()}>
              Retry revision history
            </Button>
          </RequestError>
          {history.isPending ? (
            <p role="status">Loading history…</p>
          ) : !history.data?.data.length ? (
            <p className="text-sm text-muted-foreground">
              No published revisions yet.
            </p>
          ) : (
            history.data.data.map((item) => (
              <div
                key={item.uuid}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    Revision {item.revision}
                    {item.revision === profile.revision
                      ? " · Current published definition"
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.compiled_at).toLocaleString()} ·{" "}
                    {item.definition_hash.slice(0, 12)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
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
                  Inspect revision {item.revision}
                </Button>
              </div>
            ))
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous revisions
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!history.data || page >= history.data.meta.last_page}
              onClick={() => setPage(page + 1)}
            >
              Older revisions
            </Button>
          </div>
        </CardContent>
      </Card>
      <Confirm
        open={confirm}
        title={"Publish revision " + (profile.revision + 1) + "?"}
        description={
          "This publishes saved draft " +
          profile.draft_revision +
          ". Future edits become pending changes; previous published revisions remain unchanged. This does not confirm device activation."
        }
        action="Publish revision"
        destructive={false}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          if (!ready)
            throw new Error(
              "Validate the latest saved draft before publishing.",
            )
          await studio.perform(() =>
            api.publishDeviceProfile(
              studio.org,
              profile.uuid,
              profile.draft_revision,
            ),
          )
          setCompiled(null)
          setValidation(null)
        }}
      />
      <Dialog
        open={Boolean(selectedChange)}
        onOpenChange={(open) => {
          if (!open) setSelectedChange(null)
        }}
      >
        <DialogContent className="flex max-h-[90svh] flex-col overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {selectedChange?.label} — {selectedChange?.change}
            </DialogTitle>
            <DialogDescription>
              Compare the previously published value with the saved draft. No
              edits are made in this view.
            </DialogDescription>
          </DialogHeader>
          {selectedChange && (
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <JsonEditor
                label="Previously published"
                value={jsonText(selectedChange.before)}
                readOnly
              />
              <JsonEditor
                label="Saved draft change"
                value={jsonText(selectedChange.after)}
                readOnly
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(artifact)}
        onOpenChange={(open) => {
          if (!open) setArtifact(null)
        }}
      >
        <DialogContent className="flex max-h-[90svh] flex-col overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Published revision {artifact?.revision}</DialogTitle>
            <DialogDescription>
              Immutable published definition. This view cannot edit the draft.
            </DialogDescription>
          </DialogHeader>
          {artifact && (
            <JsonEditor
              label={"Published revision " + artifact.revision}
              readOnly
              value={jsonText(artifact.definition)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
