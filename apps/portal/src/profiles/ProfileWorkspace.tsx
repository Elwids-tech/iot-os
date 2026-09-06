import { useState } from "react"
import { useForm } from "react-hook-form"
import { Link, useParams } from "react-router-dom"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Button } from "@iot-os/ui/components/button"
import { Badge } from "@iot-os/ui/components/badge"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@iot-os/ui/components/accordion"
import { JsonEditor } from "@iot-os/ui/components/json-editor"
import { ArrowLeftIcon, LockKeyholeIcon } from "lucide-react"
import { cn } from "@iot-os/ui/lib/utils"
import { StudioProvider, useStudio } from "./use-studio"
import { ProfileStatus } from "./ProfileDirectory"
import { ParametersSection } from "./ParametersSection"
import { CalculationsSection } from "./CalculationsSection"
import { AlarmsSection } from "./AlarmsSection"
import { ReviewSection } from "./ReviewSection"
import { ConflictReview } from "./ConflictReview"
import {
  TextField,
  SaveBar,
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
function Workspace() {
  const studio = useStudio(),
    { section = "overview" } = useParams(),
    { profile } = studio
  const base =
    "/organizations/" + studio.org + "/device-profiles/" + profile.uuid
  const sections = [
    { key: "overview", label: "Overview" },
    { key: "parameters", label: "Parameters" },
    { key: "calculations", label: "Calculations" },
    { key: "alarms", label: "Alarm templates" },
    { key: "review", label: "Review & publish" },
  ]
  const current = sections.some((item) => item.key === section)
    ? section
    : "overview"
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Button
          variant="link"
          className="h-auto justify-start self-start px-0"
          asChild
        >
          <Link to={"/organizations/" + studio.org + "/device-profiles"}>
            <ArrowLeftIcon data-icon="inline-start" />
            All device profiles
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {profile.name}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {profile.category ?? "Device profile"} · {profile.code}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ProfileStatus profile={profile} />
            {profile.revision > 0 && (
              <Badge variant="outline">
                Published revision {profile.revision}
              </Badge>
            )}
          </div>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LockKeyholeIcon className="size-3.5" />
          {studio.busy
            ? "Saving changes…"
            : "Saved draft " +
              profile.draft_revision +
              " · Changes are private to this organization until published."}
        </p>
      </div>
      <nav
        className="flex gap-1 overflow-x-auto border-b"
        aria-label="Profile sections"
      >
        {sections.map((item) => (
          <Link
            key={item.key}
            to={base + "/" + item.key}
            aria-current={current === item.key ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              current === item.key && "border-primary text-primary",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
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
    </section>
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
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Profile details</CardTitle>
          <CardDescription>
            Describe the device, not its transport connection. Save changes here
            without publishing them.
          </CardDescription>
        </CardHeader>
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
          <CardContent>
            <FieldGroup>
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
                  <AccordionTrigger>
                    Advanced extension metadata
                  </AccordionTrigger>
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
          </CardContent>
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
      </Card>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>At a glance</CardTitle>
            <CardDescription>Your current saved draft</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-4">
              {[
                ["Parameters", profile.parameters.length],
                ["Groups", profile.parameter_groups.length],
                [
                  "Calculations",
                  profile.parameters.filter((item) => item.calculation).length,
                ],
                ["Alarm templates", profile.alarm_templates.length],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 text-sm">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <p className="text-xs leading-relaxed text-muted-foreground">
          A profile defines meaning and behavior. Connection details and live
          device activation are separate workflows.
        </p>
      </div>
    </div>
  )
}
