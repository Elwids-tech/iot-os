import { useState } from "react"
import { useForm } from "react-hook-form"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "react-router-dom"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Button } from "@iot-os/ui/components/button"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@iot-os/ui/components/tabs"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@iot-os/ui/components/accordion"
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
} from "@iot-os/ui/components/table"
import { JsonEditor } from "@iot-os/ui/components/json-editor"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { formatAge, formatDateTime } from "@iot-os/ui/lib/format"
import {
  StudioProvider,
  useStudio,
  useProfileValidation,
  publishBlocker,
} from "./use-studio"
import { ProfileStatus, plural } from "./ProfileDirectory"
import { ParametersSection } from "./ParametersSection"
import { CalculationsSection } from "./CalculationsSection"
import { AlarmsSection } from "./AlarmsSection"
import { ReviewSection } from "./ReviewSection"
import { ConflictReview } from "./ConflictReview"
import {
  TextField,
  SaveBar,
  Confirm,
  RequestError,
  fieldError,
  parseObject,
} from "../components/forms"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import { jsonText } from "./authoring"
export function ProfileWorkspace() {
  return (
    <StudioProvider>
      <Workspace />
    </StudioProvider>
  )
}
const sections = [
  { key: "overview", label: "Overview" },
  { key: "parameters", label: "Parameters" },
  { key: "calculations", label: "Calculations" },
  { key: "alarms", label: "Alarm templates" },
  { key: "review", label: "Review and publish" },
]
function Workspace() {
  const studio = useStudio(),
    { section = "overview" } = useParams(),
    { profile } = studio
  const navigate = useNavigate()
  const check = useProfileValidation()
  const [confirm, setConfirm] = useState(false)
  const base =
    "/organizations/" + studio.org + "/device-profiles/" + profile.uuid
  const current = sections.some((item) => item.key === section)
    ? section
    : "overview"
  // ponytail: the show endpoint has no devices_count, so read it from the list filtered by code.
  const usage = useQuery({
    queryKey: ["profiles", studio.org, "usage", profile.code],
    queryFn: () =>
      api.deviceProfiles(studio.org, { search: profile.code, perPage: 100 }),
    select: (page) =>
      page.data.find((item) => item.uuid === profile.uuid)?.devices_count,
  })
  const blocker = publishBlocker(studio, check)
  const result = check.data?.validation
  return (
    <Tabs
      value={current}
      onValueChange={(value) => navigate(base + "/" + value)}
      // Arrow keys move focus only; Enter or a click opens the section (it is a route change).
      activationMode="manual"
      className="gap-0"
    >
      <PageHeader
        title={profile.name}
        back={{
          to: "/organizations/" + studio.org + "/device-profiles",
          label: "Device profiles",
        }}
        meta={<span className="font-mono text-xs">{profile.code}</span>}
        actions={
          <>
            {studio.capabilities.validate && (
              <Button
                variant="outline"
                disabled={check.isFetching || studio.busy || studio.blocked}
                onClick={() => void check.validate()}
              >
                {check.isFetching ? "Checking…" : "Validate draft"}
              </Button>
            )}
            {studio.capabilities.publish && (
              <span title={blocker ?? undefined}>
                <Button disabled={Boolean(blocker)} onClick={() => setConfirm(true)}>
                  Publish revision {profile.revision + 1}
                </Button>
              </span>
            )}
          </>
        }
      >
        <div className="flex w-full min-w-0 flex-col">
          <p
            className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-sm text-muted-foreground [&>span+span]:before:mr-2 [&>span+span]:before:content-['·']"
          >
            <span>
              <ProfileStatus profile={profile} />
            </span>
            {studio.busy ? (
              <span>Saving changes…</span>
            ) : (
              <>
                <span>Saved draft {profile.draft_revision}</span>
                <span title={formatDateTime(profile.updated_at)}>
                  {formatAge(profile.updated_at)} ago
                </span>
              </>
            )}
            {profile.revision > 0 && (
              <span>
                based on{" "}
                <Link className="text-primary hover:underline" to={base + "/review"}>
                  v{profile.revision}
                </Link>
              </span>
            )}
            {usage.data !== undefined && (
              <span>Used by {plural(usage.data, "device")}</span>
            )}
            {result && (
              <span>
                <Link to={base + "/review"} className="hover:underline">
                  {result.valid ? (
                    <StatusMark tone="good">Validation passed</StatusMark>
                  ) : (
                    <StatusMark tone="critical">
                      {plural(result.diagnostics.length, "issue")}
                    </StatusMark>
                  )}
                </Link>
              </span>
            )}
          </p>
          <TabsList
            variant="line"
            aria-label="Profile sections"
            className="max-w-full justify-start overflow-x-auto scrollbar-none"
          >
            {sections.map((item) => (
              <TabsTrigger key={item.key} value={item.key} className="flex-none">
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </PageHeader>
      <TabsContent value={current} className="min-w-0 p-4 md:p-6">
        {current === "overview" ? (
          <Overview key={profile.uuid} />
        ) : current === "parameters" ? (
          <ParametersSection />
        ) : current === "calculations" ? (
          <CalculationsSection />
        ) : current === "alarms" ? (
          <AlarmsSection />
        ) : (
          <ReviewSection />
        )}
      </TabsContent>
      <Confirm
        open={confirm}
        title={"Publish revision " + (profile.revision + 1) + "?"}
        description={
          "This publishes saved draft " +
          profile.draft_revision +
          ". Later edits become unpublished changes and earlier revisions stay as they are. Devices are not changed."
        }
        action="Publish revision"
        destructive={false}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          if (!check.ready)
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
          check.clear()
        }}
      />
    </Tabs>
  )
}
function Overview() {
  const studio = useStudio(),
    { profile } = studio
  const [revision, setRevision] = useState(profile.draft_revision),
    [error, setError] = useState<unknown>(null)
  const form = useForm({
    defaultValues: {
      name: profile.name,
      code: profile.code,
      category: profile.category ?? "",
      description: profile.description ?? "",
      extensions: jsonText(profile.extensions),
    },
  })
  const values = form.watch(),
    disabled =
      !studio.capabilities.update ||
      profile.status === "archived" ||
      studio.blocked
  useUnsaved(form.formState.isDirty)
  return (
    <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,42rem)_18rem]">
      <section aria-labelledby="profile-details" className="min-w-0">
        <h2 id="profile-details" className="mb-4 text-sm font-semibold">
          Details
        </h2>
        <form
          onSubmit={form.handleSubmit(async (input) => {
            try {
              setError(null)
              await studio.perform(() =>
                api.updateDeviceProfile(studio.org, profile.uuid, {
                  ...input,
                  category: input.category || null,
                  description: input.description || null,
                  extensions: parseObject(input.extensions),
                  draft_revision: revision,
                }),
              )
              const fresh = await studio.reload()
              setRevision(fresh.draft_revision)
              form.reset({
                name: fresh.name,
                code: fresh.code,
                category: fresh.category ?? "",
                description: fresh.description ?? "",
                extensions: jsonText(fresh.extensions),
              })
            } catch (reason) {
              setError(reason)
            }
          })}
        >
          <FieldGroup className="pb-4">
            <TextField
              label="Profile name"
              error={fieldError(error, "name")}
              required
              disabled={disabled}
              {...form.register("name")}
            />
            <TextField
              label="Profile code"
              error={fieldError(error, "code")}
              required
              pattern="[a-z0-9][a-z0-9.\-]*"
              disabled={disabled}
              {...form.register("code")}
            />
            <TextField
              label="Category"
              disabled={disabled}
              {...form.register("category")}
            />
            <TextField
              label="Description"
              disabled={disabled}
              {...form.register("description")}
            />
            <Accordion type="single" collapsible>
              <AccordionItem value="extensions">
                <AccordionTrigger>Extensions (JSON)</AccordionTrigger>
                <AccordionContent>
                  <JsonEditor
                    label="Profile extensions"
                    value={values.extensions}
                    readOnly={disabled}
                    onChange={(value) =>
                      form.setValue("extensions", value, {
                        shouldDirty: true,
                      })
                    }
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            <RequestError error={error} />
            <ConflictReview
              error={error}
              local={values}
              selectLatest={(fresh) => ({
                name: fresh.name,
                code: fresh.code,
                category: fresh.category,
                description: fresh.description,
                extensions: fresh.extensions,
              })}
              onRebase={(value) => {
                setRevision(value)
                setError(null)
              }}
            />
          </FieldGroup>
          <SaveBar
            dirty={form.formState.isDirty}
            busy={form.formState.isSubmitting || studio.busy}
            disabled={disabled}
            onCancel={() => {
              form.reset({
                name: profile.name,
                code: profile.code,
                category: profile.category ?? "",
                description: profile.description ?? "",
                extensions: jsonText(profile.extensions),
              })
              setRevision(profile.draft_revision)
              setError(null)
            }}
          />
        </form>
      </section>
      <section aria-labelledby="profile-contents">
        <h2 id="profile-contents" className="mb-2 text-sm font-semibold">
          Draft {profile.draft_revision} contents
        </h2>
        <Table>
          <TableBody>
            {[
              ["Parameters", profile.parameters.length],
              ["Groups", profile.parameter_groups.length],
              [
                "Calculations",
                profile.parameters.filter((item) => item.calculation).length,
              ],
              ["Alarm templates", profile.alarm_templates.length],
            ].map(([label, value]) => (
              <TableRow key={label}>
                <TableCell className="text-muted-foreground">{label}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {value}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
