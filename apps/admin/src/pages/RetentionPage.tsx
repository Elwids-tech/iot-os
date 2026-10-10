import { useEffect, useId, useState } from "react"
import {
  ApiError,
  type Organization,
  type RetentionSetting,
} from "@iot-os/api-client"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@iot-os/ui/components/alert-dialog"
import { Button } from "@iot-os/ui/components/button"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Switch } from "@iot-os/ui/components/switch"
import { formatDateTime } from "@iot-os/ui/lib/format"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"

function message(error: unknown) {
  if (error instanceof ApiError)
    return (
      (error.payload as { message?: string })?.message ??
      "This change could not be saved."
    )
  return error instanceof Error
    ? error.message
    : "The service could not be reached."
}
export function RetentionPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [more, setMore] = useState(false),
    [organizationsLoading, setOrganizationsLoading] = useState(true)
  const [org, setOrg] = useState("platform"),
    [setting, setSetting] = useState<RetentionSetting | null>(null),
    [days, setDays] = useState("90"),
    [inherited, setInherited] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [confirmation, setConfirmation] = useState(false)
  const id = useId()
  const proposed = inherited ? null : Number(days),
    effective =
      proposed ?? (org === "platform" ? 90 : (setting?.platform_days ?? 90))
  const dirty = Boolean(
    setting &&
    (inherited !== (setting.override_days === null) ||
      (!inherited && days !== String(setting.override_days))),
  )
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard unsaved retention changes?",
    description: "The saved setting will remain unchanged.",
  })
  function apply(value: RetentionSetting) {
    setSetting(value)
    setDays(String(value.override_days ?? value.days))
    setInherited(value.override_days === null)
  }
  useEffect(() => {
    let current = true
    setOrganizationsLoading(true)
    const timer = window.setTimeout(() => {
      apiClient
        .adminOrganizations({ search, page, perPage: 25 })
        .then((result) => {
          if (current) {
            setOrganizations(result.data)
            setMore(result.meta.current_page < result.meta.last_page)
          }
        })
        .catch((reason) => {
          if (current) setError(reason)
        })
        .finally(() => {
          if (current) setOrganizationsLoading(false)
        })
    }, 200)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [search, page])
  useEffect(() => {
    let current = true
    setSetting(null)
    setError(null)
    apiClient
      .retention(org === "platform" ? undefined : org)
      .then((value) => {
        if (current) apply(value)
      })
      .catch((reason) => {
        if (current) setError(reason)
      })
    return () => {
      current = false
    }
  }, [org])
  async function save(confirmed: boolean) {
    if (!setting || busy) return
    setBusy(true)
    setError(null)
    try {
      apply(
        await apiClient.updateRetention(
          {
            days: proposed,
            revision: setting.revision,
            confirmed_reduction: confirmed,
          },
          org === "platform" ? undefined : org,
        ),
      )
      setConfirmation(false)
      toast.success("Retention settings saved")
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeader title="Retention" />
      <div className="flex w-full max-w-3xl flex-col gap-8 p-4 md:p-6">
        {Boolean(error) && (
          <Alert variant="destructive">
            <AlertTitle>Settings need attention</AlertTitle>
            <AlertDescription>
              {message(error)}
              {error instanceof ApiError && error.status === 409 && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      apply(
                        await apiClient.retention(
                          org === "platform" ? undefined : org,
                        ),
                      )
                      setError(null)
                    } catch (reason) {
                      setError(reason)
                    }
                  }}
                >
                  Load saved settings
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        <FieldGroup className="max-w-sm">
          <SearchableSelect
            label="Settings for"
            value={org}
            disabled={busy}
            search={search}
            onSearchChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            loading={organizationsLoading}
            page={page}
            hasNextPage={more}
            onPageChange={setPage}
            onChange={(value) => {
              if (value !== org) guard(() => setOrg(value))
            }}
            options={[
              ...(!search || "platform default".includes(search.toLowerCase())
                ? [{ value: "platform", label: "Platform default" }]
                : []),
              ...organizations.map((o) => ({ value: o.uuid, label: o.name })),
            ]}
          />
        </FieldGroup>
        {setting && (
          <section aria-labelledby={id + "-setting"} className="flex flex-col gap-4 border-t pt-6">
            <div>
              <h2 id={id + "-setting"} className="font-semibold">
                {org === "platform" ? "Platform default" : "Organization override"}
              </h2>
              <p className="text-sm text-muted-foreground">
                Effective retention: {setting.days} days · Source:{" "}
                {setting.source === "default"
                  ? "400-day fallback"
                  : setting.source === "platform"
                    ? "saved platform default"
                    : "organization override"}
              </p>
            </div>
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault()
                if (effective < setting.days) setConfirmation(true)
                else void save(false)
              }}
            >
              <FieldGroup>
                <Field orientation="horizontal">
                  <Switch
                    id={id + "-inherit"}
                    checked={inherited}
                    disabled={busy}
                    onCheckedChange={setInherited}
                  />
                  <FieldLabel htmlFor={id + "-inherit"}>
                    {org === "platform"
                      ? "Use the 400-day fallback"
                      : "Inherit the platform default"}
                  </FieldLabel>
                </Field>
                <Field>
                  <FieldLabel htmlFor={id + "-days"}>Retention in days</FieldLabel>
                  <Input
                    id={id + "-days"}
                    type="number"
                    required
                    min={1}
                    max={36500}
                    step={1}
                    value={inherited ? effective : days}
                    disabled={inherited || busy}
                    onChange={(e) => setDays(e.target.value)}
                    className="max-w-48 tabular-nums"
                  />
                  <FieldDescription>
                    Positive whole days. Removing an override restores inheritance.
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <p className="text-sm text-muted-foreground">
                Daily cleanup deletes measurements received before the cutoff.
                Configuration and command audit records are retained. Increasing
                retention cannot recover deleted measurements.
              </p>
              <div className="flex gap-3">
                <Button disabled={!dirty || busy}>
                  {busy ? "Saving…" : "Save retention"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!dirty || busy}
                  onClick={() => apply(setting)}
                >
                  Discard edits
                </Button>
              </div>
            </form>
          </section>
        )}
        {setting && (
          <section aria-labelledby={id + "-cleanup"} className="flex flex-col gap-3 border-t pt-6">
            <div>
              <h2 id={id + "-cleanup"} className="font-semibold">
                Cleanup
              </h2>
              <p className="text-sm text-muted-foreground">
                {setting.cleanup
                  ? `Latest run ${formatDateTime(setting.cleanup.at)} · ${setting.cleanup.status}`
                  : "No daily cleanup recorded yet."}
              </p>
            </div>
            {Boolean(setting.cleanup_failures) && (
              <Alert variant="destructive">
                <AlertTitle>Cleanup needs attention</AlertTitle>
                <AlertDescription>
                  {setting.cleanup_failures} organization cleanup runs are
                  awaiting recovery. {setting.cleanup?.diagnostic}
                </AlertDescription>
              </Alert>
            )}
            {setting.cleanup && (
              <p className="text-sm">
                <span className="tabular-nums">{setting.cleanup.deleted_rows.toLocaleString()}</span>{" "}
                measurement and diagnostic rows removed in the latest run. The runtime retries
                pending or failed cleanup.
              </p>
            )}
          </section>
        )}
        {!setting && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading retention settings…
          </p>
        )}
      </div>
      <AlertDialog
        open={confirmation}
        onOpenChange={(value) => {
          if (!busy) setConfirmation(value)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reduce measurement retention?</AlertDialogTitle>
            <AlertDialogDescription>
              Reduce from {setting?.days} to {effective} days. At the next daily
              cleanup, measurements received before{" "}
              {formatDateTime(new Date(Date.now() - effective * 86400000).toISOString())}{" "}
              will be eligible for permanent deletion.{" "}
              {org === "platform"
                ? "This affects organizations inheriting the platform default."
                : "This affects only the selected organization."}{" "}
              Deleted history cannot be restored by increasing this setting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => save(true)}
            >
              Confirm reduction
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {discardDialog}
    </>
  )
}
