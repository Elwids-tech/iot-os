import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import type { DeviceProfile } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Input } from "@iot-os/ui/components/input"
import { Label } from "@iot-os/ui/components/label"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@iot-os/ui/components/select"
import {
  Empty,
  EmptyHeader,
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
import { PageHeader } from "@iot-os/ui/components/page-header"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { formatAge, formatDateTime } from "@iot-os/ui/lib/format"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { api } from "../lib/api"
import { useUnsaved, useDirtyContext } from "../lib/unsaved"
import {
  TextField,
  EditorSheet,
  SaveBar,
  Confirm,
  Pager,
  RequestError,
  fieldError,
} from "../components/forms"
import { useOrganization } from "./use-studio"
import { categoryLabel } from "./authoring"
import { DeviceSetupBanner, useReturnTo } from "./device-setup"
export function ProfileStatus({ profile }: { profile: DeviceProfile }) {
  return profile.status === "published" ? (
    <StatusMark tone="good">Live: version {profile.revision}</StatusMark>
  ) : profile.status === "archived" ? (
    <StatusMark tone="muted">Archived</StatusMark>
  ) : profile.revision > 0 ? (
    <StatusMark tone="warning">Unpublished changes</StatusMark>
  ) : (
    <StatusMark tone="muted">Draft</StatusMark>
  )
}
export const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`
const statuses = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft / unpublished changes" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
]
export function ProfileDirectory() {
  const { setDirty } = useDirtyContext()
  const organization = useOrganization()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const [params, setParams] = useSearchParams()
  const { returnTo, keep } = useReturnTo()
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
  const rows = query.data?.data ?? []
  // The API omits devices_count when the user can't view devices.
  const usedBy = rows.some((profile) => profile.devices_count !== undefined)
  const filtered = Boolean(search || status || category)
  return (
    <>
      <PageHeader
        title="Device profiles"
        actions={
          organization.capabilities.create && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" />
              New profile
            </Button>
          )
        }
      />
      {returnTo && <DeviceSetupBanner returnTo={returnTo} />}
      <div className="flex flex-col gap-3 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Label htmlFor="profile-search" className="sr-only">
            Search profiles
          </Label>
          <Input
            id="profile-search"
            type="search"
            placeholder="Name or code"
            className="w-full sm:w-64"
            value={search}
            onChange={(event) => filter("search", event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Label htmlFor="profile-status" className="font-normal text-muted-foreground">
              Status
            </Label>
            <Select
              value={status || "all"}
              onValueChange={(value) =>
                filter("status", value === "all" ? "" : value)
              }
            >
              <SelectTrigger id="profile-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="profile-category" className="font-normal text-muted-foreground">
              Category
            </Label>
            <Input
              id="profile-category"
              placeholder="All categories"
              className="w-40"
              value={category}
              onChange={(event) => filter("category", event.target.value)}
            />
          </div>
          {query.data && (
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {plural(query.data.meta.total, "profile")}
            </span>
          )}
        </div>
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
          <p className="text-sm text-muted-foreground">
            You don't have permission to list device profiles.
          </p>
        ) : !rows.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {filtered ? "No matching profiles" : "No device profiles yet"}
              </EmptyTitle>
              <EmptyDescription>
                {filtered
                  ? "Try a different search or clear the filters."
                  : "A profile describes what a device measures, reports and accepts."}
              </EmptyDescription>
            </EmptyHeader>
            {!filtered && organization.capabilities.create && (
              <EmptyContent>
                <Button variant="outline" onClick={() => setCreating(true)}>
                  Create a device profile
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profile</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Parameters</TableHead>
                {usedBy && <TableHead>Used by</TableHead>}
                <TableHead className="text-right">Updated</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((profile) => (
                <TableRow key={profile.uuid}>
                  <TableCell className="max-w-96 truncate">
                    <Link
                      className="font-medium text-primary hover:underline"
                      to={keep(base + "/" + profile.uuid + "/overview")}
                    >
                      {profile.name}
                    </Link>
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={profile.category ?? undefined}
                  >
                    {profile.category ? categoryLabel(profile.category) : "—"}
                  </TableCell>
                  <TableCell>
                    <ProfileStatus profile={profile} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {profile.parameters_count ?? 0}
                  </TableCell>
                  {usedBy && (
                    <TableCell className="text-muted-foreground tabular-nums">
                      {plural(profile.devices_count ?? 0, "device")}
                    </TableCell>
                  )}
                  <TableCell
                    className="text-right text-muted-foreground tabular-nums"
                    title={formatDateTime(profile.updated_at)}
                  >
                    {formatAge(profile.updated_at)} ago
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button asChild size="sm" variant="ghost">
                        <Link to={keep(base + "/" + profile.uuid + "/overview")}>
                          Open
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
        )}
        {query.data && query.data.meta.last_page > 1 && (
          <Pager
            page={page}
            pages={query.data.meta.last_page}
            onPage={(next) => {
              const values = new URLSearchParams(params)
              values.set("page", String(next))
              setParams(values)
            }}
          />
        )}
      </div>
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
            navigate(keep(base + "/" + profile.uuid + "/parameters"))
          }}
        />
      )}
      <Confirm
        open={Boolean(deleting)}
        title={"Delete " + deleting?.name + "?"}
        description="Only unused drafts can be deleted. Published versions and referenced profiles are protected."
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
    </>
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
      title="New device profile"
      description="Add parameters after you create the draft."
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
              help="Unique in this organization."
              {...form.register("code")}
            />
            <TextField
              label="Category"
              placeholder="Energy monitoring"
              {...form.register("category")}
            />
            <TextField
              label="Description"
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
