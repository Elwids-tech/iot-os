import { useState } from "react"
import { Link } from "react-router-dom"
import { useForm } from "react-hook-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Site, SiteInput } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { FieldGroup } from "@iot-os/ui/components/field"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { PlusIcon } from "lucide-react"
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
import { DeviceEmpty, devicePath, useDeviceOrganization } from "./shared"
import { TimezoneField, utcOffset } from "./TimezoneField"

/** Sites give devices a time zone for calendar periods such as days, months and shifts. */
export default function SitesPage() {
  const { org, capabilities } = useDeviceOrganization()
  const client = useQueryClient()
  const [editing, setEditing] = useState<Site | "new" | null>(null)
  const [removing, setRemoving] = useState<Site | null>(null)
  const sites = useQuery({ queryKey: ["sites", org], queryFn: () => api.sites(org) })
  const organizationZone = useMutation({
    mutationFn: (timezone: string) => api.setOrganizationTimezone(org, timezone || null),
    onSuccess: () => client.invalidateQueries({ queryKey: ["sites", org] }),
  })
  const list = sites.data?.data ?? []
  return (
    <>
      <PageHeader
        title="Sites"
        actions={
          capabilities.manage && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <PlusIcon data-icon="inline-start" />
              New site
            </Button>
          )
        }
      >
        <p className="text-sm text-muted-foreground">
          Daily, monthly and shift totals for a device are cut in its site's time
          zone, so every viewer sees the same numbers. Times are still shown in
          each viewer's own time zone.
        </p>
      </PageHeader>
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <RequestError error={sites.error ?? organizationZone.error} />
        <div className="max-w-md">
          <TimezoneField
            label="Organization time zone"
            value={sites.data?.organization_timezone ?? ""}
            allowNone
            disabled={!capabilities.manage || organizationZone.isPending || sites.isPending}
            help="Used for devices without a site."
            onChange={(zone) => organizationZone.mutate(zone)}
          />
        </div>
        {sites.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : list.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead>
                  <TableHead>Time zone</TableHead>
                  <TableHead className="text-right">Devices</TableHead>
                  {capabilities.manage && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((site) => (
                  <TableRow key={site.uuid}>
                    <TableCell className="max-w-80">
                      <span className="block truncate font-medium">{site.name}</span>
                      {site.address && (
                        <span className="block truncate text-xs text-muted-foreground">{site.address}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {site.timezone.replaceAll("_", " ")}
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">{utcOffset(site.timezone)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {site.devices_count ? (
                        <Link
                          className="text-primary underline-offset-4 hover:underline"
                          to={devicePath(org) + "?site=" + encodeURIComponent(site.uuid)}
                        >
                          {site.devices_count}
                        </Link>
                      ) : (
                        0
                      )}
                    </TableCell>
                    {capabilities.manage && (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(site)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(site)}>
                          Delete
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <DeviceEmpty
            title="No sites yet"
            description="Add a site for each place whose devices should report days and shifts in its own time zone."
          />
        )}
      </div>
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
