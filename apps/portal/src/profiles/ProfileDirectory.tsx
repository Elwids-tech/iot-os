import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import type { DeviceProfile } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RowLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem, DropdownMenuSeparator } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { FieldGroup } from "@iot-os/ui/components/field"
import { FilterField } from "@iot-os/ui/components/filter-bar"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Input } from "@iot-os/ui/components/input"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { BoxesIcon, LockIcon, PlusIcon } from "lucide-react"
import { api } from "../lib/api"
import { useUnsaved, useDirtyContext } from "../lib/unsaved"
import {
  TextField,
  EditorSheet,
  SaveBar,
  Confirm,
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
const statusViews = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Live" },
  { value: "archived", label: "Archived" },
]
export function ProfileDirectory() {
  const { setDirty } = useDirtyContext()
  const organization = useOrganization()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const url = useUrlState()
  const { returnTo, keep } = useReturnTo()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<DeviceProfile | null>(null)
  const search = url.get("search"),
    status = url.get("status"),
    category = url.get("category")
  const page = Math.max(1, Number(url.get("page")) || 1),
    pageSize = Number(url.get("per_page") || 25)
  const query = useQuery({
    queryKey: ["profiles", organization.organizationUuid, search, status, category, page, pageSize],
    queryFn: () =>
      api.deviceProfiles(organization.organizationUuid, {
        search,
        status,
        category,
        page,
        perPage: pageSize,
      }),
    enabled: organization.capabilities.view_any,
    placeholderData: keepPreviousData,
  })
  const base = "/organizations/" + organization.organizationUuid + "/device-profiles"
  const rows = query.data?.data
  // The API omits devices_count when the user can't view devices.
  const usedBy = rows?.some((profile) => profile.devices_count !== undefined) ?? false
  const open = (profile: DeviceProfile, section = "overview") =>
    keep(base + "/" + profile.uuid + "/" + section)
  const columns = useMemo<DataColumn<DeviceProfile>[]>(
    () => [
      {
        id: "profile",
        header: "Profile",
        mobile: "title",
        className: "max-w-96",
        value: (profile) => profile.name,
        cell: (profile) => (
          <>
            <RowLink to={open(profile)} className="block truncate">
              {profile.name}
            </RowLink>
            <span className="block truncate font-mono text-meta text-muted-foreground">{profile.code}</span>
          </>
        ),
      },
      {
        id: "category",
        header: "Category",
        value: (profile) => (profile.category ? categoryLabel(profile.category) : null),
        cell: (profile) => (
          <span className="text-muted-foreground" title={profile.category ?? undefined}>
            {profile.category ? categoryLabel(profile.category) : "—"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        mobile: "badge",
        value: (profile) => profile.status,
        cell: (profile) => <ProfileStatus profile={profile} />,
      },
      {
        id: "parameters",
        header: "Parameters",
        align: "end",
        value: (profile) => profile.parameters_count ?? 0,
        cell: (profile) => <span className="font-mono tabular-nums">{profile.parameters_count ?? 0}</span>,
      },
      ...(usedBy
        ? [
            {
              id: "used-by",
              header: "Used by",
              value: (profile: DeviceProfile) => profile.devices_count ?? 0,
              cell: (profile: DeviceProfile) => (
                <span className="text-muted-foreground tabular-nums">
                  {plural(profile.devices_count ?? 0, "device")}
                </span>
              ),
            },
          ]
        : []),
      {
        id: "updated",
        header: "Updated",
        align: "end",
        value: (profile) => profile.updated_at,
        cell: (profile) => <RelativeTime at={profile.updated_at} className="text-muted-foreground" />,
      },
    ],
    // `open` only depends on the organization and the return path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, usedBy, returnTo],
  )
  const canList = organization.capabilities.view_any
  return (
    <>
      <CollectionPage
        title="Device profiles"
        actions={
          organization.capabilities.create && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" />
              New profile
            </Button>
          )
        }
        notices={returnTo && <DeviceSetupBanner returnTo={returnTo} />}
      >
        {organization.error ? (
          <RequestError error={organization.error}>
            <Button variant="outline" onClick={() => void organization.refetch()}>
              Retry
            </Button>
          </RequestError>
        ) : !organization.isPending && !canList ? (
          <EmptyState
            icon={<LockIcon />}
            title="You can't list device profiles"
            description="Ask an organization admin for access to device profiles."
          />
        ) : (
          <DataTable
            id="device-profiles"
            label="Device profiles"
            noun={["profile", "profiles"]}
            rows={organization.isPending ? undefined : rows}
            rowKey={(profile) => profile.uuid}
            rowLabel={(profile) => profile.name}
            rowHref={(profile) => open(profile)}
            columns={columns}
            error={
              query.error ? (
                <RequestError error={query.error}>
                  <Button variant="outline" onClick={() => void query.refetch()}>
                    Retry
                  </Button>
                </RequestError>
              ) : undefined
            }
            views={{
              label: "Status",
              value: status || "all",
              options: statusViews,
              onChange: (value) => url.set({ status: value === "all" ? null : value }),
            }}
            search={{
              label: "Search profiles",
              placeholder: "Search name or code",
              value: search,
              onChange: (value) => url.set({ search: value }),
            }}
            toolbar={
              // A text filter, not a picker: it matches any part of the category.
              // On phones it shares a row with the icon buttons.
              <FilterField label="Category" id="profile-category" className="min-w-32 flex-1 sm:w-44 sm:flex-none">
                {(id) => (
                  <Input
                    id={id}
                    placeholder="Filter by category"
                    value={category}
                    onChange={(event) => url.set({ category: event.target.value })}
                  />
                )}
              </FilterField>
            }
            filtered={Boolean(search || status || category)}
            onReset={() => url.clear(["search", "status", "category"])}
            groups={[
              { id: "category", label: "Category", value: (p) => (p.category ? categoryLabel(p.category) : null) },
              { id: "status", label: "Status", value: (p) => (p.status === "published" ? "Live" : p.status === "archived" ? "Archived" : "Draft") },
            ]}
            pagination={{
              page,
              pageSize,
              total: query.data?.meta.total ?? 0,
              pageCount: query.data?.meta.last_page,
              onPageChange: (next) => url.set({ page: next > 1 ? String(next) : null }),
              onPageSizeChange: (next) => url.set({ per_page: next === 25 ? null : String(next) }),
            }}
            rowActions={(profile) => (
              <>
                <DropdownMenuItem asChild>
                  <Link to={open(profile, "parameters")}>Parameters</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={open(profile, "review")}>Review and publish</Link>
                </DropdownMenuItem>
                {organization.capabilities.delete_draft &&
                  profile.status === "draft" &&
                  profile.revision === 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(profile)}>
                        Delete {profile.name}
                      </DropdownMenuItem>
                    </>
                  )}
              </>
            )}
            empty={
              <EmptyState
                inset
                icon={<BoxesIcon />}
                title="No device profiles yet"
                description="A profile describes what a device measures, reports and accepts."
                action={
                  organization.capabilities.create && (
                    <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                      Create a device profile
                    </Button>
                  )
                }
              />
            }
          />
        )}
      </CollectionPage>
      {creating && (
        <CreateProfile
          onClose={() => setCreating(false)}
          onCreate={async (values) => {
            const profile = await api.createDeviceProfile(organization.organizationUuid, values)
            await cache.invalidateQueries({ queryKey: ["profiles", organization.organizationUuid] })
            setCreating(false)
            setDirty(false)
            navigate(open(profile, "parameters"))
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
