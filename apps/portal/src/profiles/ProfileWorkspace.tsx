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
import { Panel, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { EntityPage } from "@iot-os/ui/templates/entity-page"
import { BoxesIcon } from "lucide-react"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { formatAge, formatDateTime } from "@iot-os/ui/lib/format"
import {
  StudioProvider,
  useStudio,
  useProfileValidation,
  publishBlocker,
} from "./use-studio"
import { plural } from "./ProfileDirectory"
import { DeviceSetupBanner, useReturnTo } from "./device-setup"
import { withParam } from "./return-to"
import { ParametersSection } from "./ParametersSection"
import { CalculationsSection } from "./CalculationsSection"
import { AlarmsSection } from "./AlarmsSection"
import { ReviewSection } from "./ReviewSection"
import { FirmwareSection } from "./FirmwareSection"
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
import { categoryLabel, jsonText } from "./authoring"
import { useDeviceOrganization } from "../devices/shared"
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
  { key: "firmware", label: "Firmware" },
  { key: "review", label: "Review" },
]
function Workspace() {
  const { capabilities: deviceCapabilities } = useDeviceOrganization()
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
  const { returnTo, keep } = useReturnTo()
  const next = profile.revision + 1
  // "published" means the saved draft matches the live version: nothing to publish.
  const unchanged = profile.status === "published"
  const checked = studio.capabilities.validate && profile.status === "draft"
  const checking = checked && (check.isFetching || (!check.data && !check.isError))
  // Publish rings once when a save makes it the next step, not when a page opens ready.
  const ready = !blocker
  const [wasReady, setWasReady] = useState(ready)
  const [announce, setAnnounce] = useState(false)
  if (ready !== wasReady) {
    setWasReady(ready)
    setAnnounce(ready)
  }
  const back = returnTo && withParam(returnTo, "profile", profile.uuid)
  const devices = usage.data ?? 0
  const saved = (
    <span title={formatDateTime(profile.updated_at)}>
      {formatAge(profile.updated_at)} ago
    </span>
  )
  return (
    <Tabs
      value={current}
      onValueChange={(value) => navigate(keep(base + "/" + value))}
      // Arrow keys move focus only; Enter or a click opens the section (it is a route change).
      activationMode="manual"
      className="gap-0"
    >
      <EntityPage
        title={profile.name}
        icon={<BoxesIcon />}
        code={
          <>
            {profile.category && (
              <span className="font-sans" title={profile.category}>
                {categoryLabel(profile.category)} ·{" "}
              </span>
            )}
            {profile.code}
          </>
        }
        back={{
          to: keep("/organizations/" + studio.org + "/device-profiles"),
          label: "Device profiles",
        }}
        actions={
          <>
            {profile.revision > 0 && deviceCapabilities.manage && !returnTo && <Button asChild size="sm" variant="outline"><Link to={`/organizations/${studio.org}/devices/onboard?profile=${profile.uuid}`}>Connect a device</Link></Button>}
            {back && unchanged ? (
              <Button asChild size="sm">
                <Link to={back}>Continue setup with version {profile.revision}</Link>
              </Button>
            ) : (
              studio.capabilities.publish && (
                <>
                  {blocker && !unchanged && !checking && (
                    <span className="text-meta text-muted-foreground">{blocker}</span>
                  )}
                  <Button
                    size="sm"
                    variant={unchanged ? "outline" : "default"}
                    disabled={Boolean(blocker)}
                    className={announce ? "motion-safe:animate-next-step" : undefined}
                    onAnimationEnd={() => setAnnounce(false)}
                    onClick={() => setConfirm(true)}
                  >
                    {back ? "Publish and continue setup" : "Publish version " + next}
                  </Button>
                </>
              )
            )}
          </>
        }
        status={
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground [&>span+span]:before:mr-2 [&>span+span]:before:content-['·']">
            <span>
              {profile.status === "archived" ? (
                <StatusMark tone="muted">Archived</StatusMark>
              ) : profile.revision > 0 ? (
                <StatusMark tone="good">Live: version {profile.revision}</StatusMark>
              ) : (
                <StatusMark tone="muted">Not published yet</StatusMark>
              )}
            </span>
            {studio.busy ? (
              <span>Saving changes…</span>
            ) : profile.status === "archived" ? (
              profile.revision > 0 && <span>Last version {profile.revision}</span>
            ) : unchanged ? (
              <span>No changes since version {profile.revision}</span>
            ) : profile.revision > 0 ? (
              <span className="text-warning">Draft changes saved {saved}</span>
            ) : (
              <span>Draft saved {saved}</span>
            )}
            {usage.data !== undefined && profile.revision > 0 && (
              <span>Used by {plural(usage.data, "device")}</span>
            )}
            {checked && (checking || result || check.isError) && (
              <span>
                {checking ? (
                  <StatusMark tone="muted">Checking…</StatusMark>
                ) : (
                  <Link to={keep(base + "/review")} className="hover:underline">
                    {!result ? (
                      <StatusMark tone="critical">Check didn't finish</StatusMark>
                    ) : result.valid ? (
                      <StatusMark tone="good">
                        {studio.capabilities.publish ? "Ready to publish" : "Checks passed"}
                      </StatusMark>
                    ) : (
                      <StatusMark tone="critical">
                        {plural(result.diagnostics.length, "issue")} to fix
                      </StatusMark>
                    )}
                  </Link>
                )}
              </span>
            )}
</div>
        }
        tabs={
          <TabsList variant="line" aria-label="Profile sections" className="justify-start px-1">
            {sections.map((item) => (
              <TabsTrigger key={item.key} value={item.key} className="flex-none">
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        }
        notices={returnTo && <DeviceSetupBanner returnTo={returnTo} profile={profile} />}
      >
        <TabsContent value={current} className="min-w-0">
          {current === "overview" ? (
            <Overview key={profile.uuid} />
          ) : current === "parameters" ? (
            <ParametersSection />
          ) : current === "calculations" ? (
            <CalculationsSection />
          ) : current === "alarms" ? (
            <AlarmsSection />
          ) : current === "firmware" ? (
            <FirmwareSection />
          ) : (
            <ReviewSection />
          )}
        </TabsContent>
      </EntityPage>
      <Confirm
        open={confirm}
        title={"Publish version " + next + "?"}
        description={
          (profile.revision === 0
            ? profile.name +
              " becomes available when you add devices. Later edits stay as a draft."
            : "Your saved draft becomes version " +
              next +
              ". " +
              (devices
                ? "The " +
                  plural(devices, "device") +
                  " using version " +
                  profile.revision +
                  (devices === 1 ? " is" : " are") +
                  " not changed."
                : "Earlier versions stay as they are.")) +
          (back ? " You go back to device setup with this version selected." : "")
        }
        action={back ? "Publish and continue" : "Publish"}
        destructive={false}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          if (!check.ready)
            throw new Error("Wait for the check of the saved draft to finish.")
          await studio.perform(() =>
            api.publishDeviceProfile(
              studio.org,
              profile.uuid,
              profile.draft_revision,
            ),
          )
          check.clear()
          if (back) navigate(back)
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
    <div className="grid min-w-0 items-start gap-(--panel-gap) xl:grid-cols-[minmax(0,48rem)_var(--rail-width)]">
      <Panel aria-labelledby="profile-details">
        <PanelHeader>
          <PanelTitle id="profile-details">Details</PanelTitle>
        </PanelHeader>
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
          <FieldGroup className="p-4">
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
      </Panel>
      <Panel aria-labelledby="profile-contents">
        <PanelHeader>
          <PanelTitle id="profile-contents">Draft contents</PanelTitle>
        </PanelHeader>
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
      </Panel>
    </div>
  )
}
