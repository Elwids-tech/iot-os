import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import type { DeviceProfile } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Badge } from "@iot-os/ui/components/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@iot-os/ui/components/card"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@iot-os/ui/components/empty"
import { FieldGroup } from "@iot-os/ui/components/field"
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@iot-os/ui/components/table"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { PlusIcon, CpuIcon, Trash2Icon, ArrowRightIcon } from "lucide-react"
import { api } from "../lib/api"
import { useUnsaved, useDirtyContext } from "../lib/unsaved"
import {
  Choice,
  TextField,
  EditorSheet,
  SaveBar,
  Confirm,
  RequestError,
  fieldError,
} from "../components/forms"
import { useOrganization } from "./use-studio"
export function ProfileStatus({ profile }: { profile: DeviceProfile }) {
  return (
    <Badge
      variant={
        profile.status === "published"
          ? "success"
          : profile.revision > 0 && profile.status === "draft"
            ? "warning"
            : "secondary"
      }
    >
      {profile.status === "published"
        ? "Published"
        : profile.status === "archived"
          ? "Archived"
          : profile.revision > 0
            ? "Unpublished changes"
            : "Draft"}
    </Badge>
  )
}
export function ProfileDirectory() {
  const { setDirty } = useDirtyContext()
  const organization = useOrganization()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<DeviceProfile | null>(null)
  const search = params.get("search") ?? "",
    status = params.get("status") ?? "",
    category = params.get("category") ?? ""
  const page = Math.max(1, Number(params.get("page")) || 1)
  const query = useQuery({
    queryKey: [
      "profiles",
      organization.organizationUuid,
      search,
      status,
      category,
      page,
    ],
    queryFn: () =>
      api.deviceProfiles(organization.organizationUuid, {
        search,
        status,
        category,
        page,
        perPage: 25,
      }),
    enabled: organization.capabilities.view_any,
  })
  function filter(name: string, value: string) {
    const next = new URLSearchParams(params)
    value ? next.set(name, value) : next.delete(name)
    next.delete("page")
    setParams(next, { replace: true })
  }
  const base =
    "/organizations/" + organization.organizationUuid + "/device-profiles"
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-primary">
            Device profile studio
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Device profiles
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Define what your devices measure, report, and accept. Save a draft,
            then publish when it is ready.
          </p>
        </div>
        {organization.capabilities.create && (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            New profile
          </Button>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Your organization's profiles</CardTitle>
          <CardDescription>
            Reusable definitions, independent of connection protocols.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FieldGroup className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Search profiles"
              type="search"
              placeholder="Name or code…"
              value={search}
              onChange={(event) => filter("search", event.target.value)}
            />
            <Choice
              label="Status"
              value={status}
              options={[
                { value: "", label: "All statuses" },
                { value: "draft", label: "Draft / unpublished changes" },
                { value: "published", label: "Published" },
                { value: "archived", label: "Archived" },
              ]}
              onChange={(value) => filter("status", value)}
            />
            <TextField
              label="Category"
              placeholder="All categories"
              value={category}
              onChange={(event) => filter("category", event.target.value)}
            />
          </FieldGroup>
          {organization.error || query.error ? (
            <RequestError error={organization.error ?? query.error}>
              <Button
                variant="outline"
                onClick={() => {
                  void organization.refetch()
                  void query.refetch()
                }}
              >
                Retry
              </Button>
            </RequestError>
          ) : organization.isPending ||
            (organization.capabilities.view_any && query.isPending) ? (
            <Skeleton className="h-52 w-full" />
          ) : !organization.capabilities.view_any ? (
            <p>You do not have permission to list device profiles.</p>
          ) : !query.data?.data.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CpuIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {search || status || category
                    ? "No matching profiles"
                    : "Your first profile starts here"}
                </EmptyTitle>
                <EmptyDescription>
                  {search || status || category
                    ? "Try a different search or clear the filters."
                    : "Start with the device's name, then add its parameters. You can build it in small, saved steps."}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {organization.capabilities.create && (
                  <Button variant="outline" onClick={() => setCreating(true)}>
                    Create a device profile
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profile</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Parameters</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.data.map((profile) => (
                    <TableRow key={profile.uuid}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Link
                            className="font-medium text-primary hover:underline"
                            to={base + "/" + profile.uuid + "/overview"}
                          >
                            {profile.name}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {profile.category ?? profile.code}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <ProfileStatus profile={profile} />
                      </TableCell>
                      <TableCell>{profile.parameters_count ?? 0}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(profile.updated_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button asChild size="sm" variant="ghost">
                            <Link to={base + "/" + profile.uuid + "/overview"}>
                              Open
                              <ArrowRightIcon data-icon="inline-end" />
                            </Link>
                          </Button>
                          {organization.capabilities.delete_draft &&
                            profile.status === "draft" &&
                            profile.revision === 0 && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={"Delete " + profile.name}
                                onClick={() => setDeleting(profile)}
                              >
                                <Trash2Icon />
                              </Button>
                            )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {query.data?.meta.total ?? 0} profiles · Organization-scoped
          </span>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                const next = new URLSearchParams(params)
                next.set("page", String(page - 1))
                setParams(next)
              }}
            >
              Previous
            </Button>
            <span className="text-xs">
              Page {page} of {query.data?.meta.last_page ?? 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!query.data || page >= query.data.meta.last_page}
              onClick={() => {
                const next = new URLSearchParams(params)
                next.set("page", String(page + 1))
                setParams(next)
              }}
            >
              Next
            </Button>
          </div>
        </CardFooter>
      </Card>
      {creating && (
        <CreateProfile
          onClose={() => setCreating(false)}
          onCreate={async (values) => {
            const profile = await api.createDeviceProfile(
              organization.organizationUuid,
              values,
            )
            await cache.invalidateQueries({
              queryKey: ["profiles", organization.organizationUuid],
            })
            setCreating(false)
            setDirty(false)
            navigate(base + "/" + profile.uuid + "/parameters")
          }}
        />
      )}
      <Confirm
        open={Boolean(deleting)}
        title={"Delete " + deleting?.name + "?"}
        description="Only unused drafts can be deleted. Published revisions and referenced profiles are protected."
        onClose={() => setDeleting(null)}
        onRefresh={() => query.refetch()}
        onConfirm={async () => {
          if (deleting)
            await api.deleteDeviceProfile(
              organization.organizationUuid,
              deleting.uuid,
              deleting.draft_revision,
            )
          await query.refetch()
        }}
      />
    </section>
  )
}
function CreateProfile({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (values: {
    name: string
    code: string
    description: string
    category: string
  }) => Promise<void>
}) {
  const form = useForm({
    defaultValues: { name: "", code: "", description: "", category: "" },
  })
  const [error, setError] = useState<unknown>(null)
  useUnsaved(form.formState.isDirty)
  return (
    <EditorSheet
      title="Create a device profile"
      description="Start with the essentials. Add parameters and behavior after creating your draft."
      dirty={form.formState.isDirty}
      busy={form.formState.isSubmitting}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            setError(null)
            await onCreate(values)
          } catch (reason) {
            setError(reason)
          }
        })}
      >
        <div className="flex-1 overflow-y-auto p-6">
          <FieldGroup>
            <TextField
              label="Profile name"
              error={fieldError(error, "name")}
              required
              placeholder="Three-phase energy meter"
              {...form.register("name", {
                onChange: (event) => {
                  if (!form.formState.dirtyFields.code)
                    form.setValue(
                      "code",
                      event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, ""),
                    )
                },
              })}
            />
            <TextField
              label="Profile code"
              error={fieldError(error, "code")}
              required
              pattern="[a-z0-9][a-z0-9.\-]*"
              help="A unique identifier within this organization."
              {...form.register("code")}
            />
            <TextField
              label="Category"
              placeholder="Energy monitoring"
              {...form.register("category")}
            />
            <TextField
              label="Description"
              placeholder="What does this profile describe?"
              {...form.register("description")}
            />
            <RequestError error={error} />
          </FieldGroup>
        </div>
        <SaveBar
          dirty={form.formState.isDirty}
          busy={form.formState.isSubmitting}
          onCancel={onClose}
          label="Create profile"
        />
      </form>
    </EditorSheet>
  )
}
