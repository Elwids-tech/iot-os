import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Site, SiteInput } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { FieldGroup } from "@iot-os/ui/components/field"
import { DataTable, RefLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { PageTabs } from "@iot-os/ui/components/page-tabs"
import { Link } from "react-router-dom"
import { MapPinIcon, PlusIcon } from "lucide-react"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import {
  Confirm,
  EditorSheet,
  RequestError,
  SaveBar,
  TextField,
  fieldError,
} from "../components/forms"
import { devicePath, useDeviceOrganization } from "./shared"
import { TimezoneField, utcOffset } from "./TimezoneField"

/** Sites give devices a time zone for calendar periods such as days, months and shifts. */
/** Sites and Geofences are two views of one Locations area. */
export function LocationTabs({ org }: { org: string }) {
  return (
    <PageTabs
      label="Locations"
      items={[
        { to: `/organizations/${org}/sites`, label: "Sites" },
        { to: `/organizations/${org}/geofences`, label: "Geofences" },
      ]}
    />
  )
}

export default function SitesPage() {
  const { org, capabilities } = useDeviceOrganization()
  const client = useQueryClient()
  const [editing, setEditing] = useState<Site | "new" | null>(null)
  const [removing, setRemoving] = useState<Site | null>(null)
  const [search, setSearch] = useState("")
  const sites = useQuery({ queryKey: ["sites", org], queryFn: () => api.sites(org) })
  const columns = useMemo<DataColumn<Site>[]>(
    () => [
      {
        id: "site",
        header: "Site",
        mobile: "title",
        className: "max-w-80",
        sortable: true,
        searchable: true,
        value: (site) => site.name,
        cell: (site) => (
          <>
            <span className="block truncate font-medium">{site.name}</span>
            {site.address && (
              <span className="block truncate text-meta text-muted-foreground">{site.address}</span>
            )}
          </>
        ),
      },
      {
        id: "timezone",
        header: "Time zone",
        className: "whitespace-nowrap",
        sortable: true,
        searchable: true,
        value: (site) => site.timezone,
        cell: (site) => (
          <>
            {site.timezone.replaceAll("_", " ")}
            <span className="ml-2 text-meta text-muted-foreground tabular-nums">{utcOffset(site.timezone)}</span>
          </>
        ),
      },
      {
        id: "devices",
        header: "Devices",
        align: "end",
        sortable: true,
        summary: "sum",
        value: (site) => site.devices_count ?? 0,
        cell: (site) =>
          site.devices_count ? (
            <RefLink
              className="tabular-nums"
              to={devicePath(org) + "?site=" + encodeURIComponent(site.uuid)}
            >
              {site.devices_count}
            </RefLink>
          ) : (
            <span className="text-muted-foreground tabular-nums">0</span>
          ),
      },
    ],
    [org],
  )
  return (
    <>
      <CollectionPage
        title="Locations"
        description="Sites: places whose time zone cuts days, months and shifts for their devices."
        actions={
          capabilities.manage && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <PlusIcon data-icon="inline-start" />
              New site
            </Button>
          )
        }
        tabs={<LocationTabs org={org} />}
        notices={
          <p className="text-body text-muted-foreground">
            Devices without a site use the organization time zone, set in{" "}
            <Link className="text-foreground underline underline-offset-4" to={`/organizations/${org}/settings/general`}>
              Settings
            </Link>
            .
          </p>
        }
      >
        <DataTable
          id="sites"
          label="Sites"
          noun={["site", "sites"]}
          rows={sites.data?.data}
          rowKey={(site) => site.uuid}
          rowLabel={(site) => site.name}
          columns={columns}
          defaultSort={[{ id: "site", desc: false }]}
          error={sites.error ? <RequestError error={sites.error} /> : undefined}
          search={{ label: "Search sites", placeholder: "Search name, address or zone", value: search, onChange: setSearch }}
          rowActions={
            capabilities.manage
              ? (site) => (
                  <>
                    <DropdownMenuItem onSelect={() => setEditing(site)}>Edit site</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(site)}>
                      Delete site
                    </DropdownMenuItem>
                  </>
                )
              : undefined
          }
          empty={
            <EmptyState
              inset
              icon={<MapPinIcon />}
              title="No sites yet"
              description="Add a site for each place whose devices should report days and shifts in its own time zone."
              action={
                capabilities.manage && (
                  <Button size="sm" onClick={() => setEditing("new")}>
                    New site
                  </Button>
                )
              }
            />
          }
        />
      </CollectionPage>
      {editing && (
        <SiteEditor
          org={org}
          site={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => client.invalidateQueries({ queryKey: ["sites", org] })}
        />
      )}
      <Confirm
        open={Boolean(removing)}
        title={`Delete ${removing?.name ?? "site"}?`}
        description="Its devices keep working and their history is kept. Their days and shifts then use the organization's time zone."
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await api.deleteSite(org, removing.uuid)
          await client.invalidateQueries({ queryKey: ["sites", org] })
          await client.invalidateQueries({ queryKey: ["devices", org] })
          setRemoving(null)
        }}
      />
    </>
  )
}

type SiteForm = { name: string; timezone: string; address: string; latitude: string; longitude: string }

function SiteEditor({
  org,
  site,
  onClose,
  onSaved,
}: {
  org: string
  site: Site | null
  onClose: () => void
  onSaved: () => void
}) {
  const form = useForm<SiteForm>({
    defaultValues: {
      name: site?.name ?? "",
      timezone: site?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      address: site?.address ?? "",
      latitude: site?.latitude?.toString() ?? "",
      longitude: site?.longitude?.toString() ?? "",
    },
  })
  const [error, setError] = useState<unknown>(null)
  const dirty = form.formState.isDirty
  useUnsaved(dirty)
  const timezone = form.watch("timezone")
  return (
    <EditorSheet
      title={site ? `Edit ${site.name}` : "New site"}
      description="The time zone decides where days, months and shifts start for this site's devices."
      dirty={dirty}
      busy={form.formState.isSubmitting}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (values) => {
          setError(null)
          const input: SiteInput = {
            name: values.name,
            timezone: values.timezone,
            address: values.address || null,
            latitude: values.latitude === "" ? null : Number(values.latitude),
            longitude: values.longitude === "" ? null : Number(values.longitude),
          }
          try {
            if (site) await api.updateSite(org, site.uuid, input)
            else await api.createSite(org, input)
            onSaved()
            form.reset(values)
            onClose()
          } catch (reason) {
            setError(reason)
          }
        })}
      >
        <div className="flex-1 overflow-auto p-6">
          <FieldGroup>
            <TextField label="Site name" required placeholder="Vancouver plant" error={fieldError(error, "name")} {...form.register("name")} />
            <TimezoneField
              label="Time zone"
              value={timezone}
              help={fieldError(error, "timezone") ?? "Search by city. Daylight saving changes are handled automatically."}
              onChange={(zone) => form.setValue("timezone", zone, { shouldDirty: true })}
            />
            <TextField label="Address" optional {...form.register("address")} />
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <TextField label="Latitude" type="number" step="any" min="-90" max="90" optional error={fieldError(error, "latitude")} {...form.register("latitude")} />
              <TextField label="Longitude" type="number" step="any" min="-180" max="180" optional error={fieldError(error, "longitude")} {...form.register("longitude")} />
            </FieldGroup>
            <RequestError error={error} />
          </FieldGroup>
        </div>
        <SaveBar dirty={dirty} busy={form.formState.isSubmitting} onCancel={onClose} label={site ? "Save site" : "Create site"} />
      </form>
    </EditorSheet>
  )
}
