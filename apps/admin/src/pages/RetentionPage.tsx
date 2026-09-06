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
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@iot-os/ui/components/select"
import { Switch } from "@iot-os/ui/components/switch"
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
    [more, setMore] = useState(false)
  const [org, setOrg] = useState("platform"),
    [setting, setSetting] = useState<RetentionSetting | null>(null),
    [days, setDays] = useState("90"),
    [inherited, setInherited] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [confirmation, setConfirmation] = useState(false),
    [saved, setSaved] = useState(false)
  const [leave, setLeave] = useState<(() => void) | null>(null),
    id = useId()
  const proposed = inherited ? null : Number(days),
    effective =
      proposed ?? (org === "platform" ? 90 : (setting?.platform_days ?? 90))
  const dirty = Boolean(
    setting &&
      (inherited !== (setting.override_days === null) ||
        (!inherited && days !== String(setting.override_days))),
  )
  function apply(value: RetentionSetting) {
    setSetting(value)
    setDays(String(value.override_days ?? value.days))
    setInherited(value.override_days === null)
  }
  useEffect(() => {
    let current = true
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
    setSaved(false)
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
  useEffect(() => {
    if (!dirty) return
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null
      if (!anchor || event.defaultPrevented || event.metaKey || event.ctrlKey)
        return
      event.preventDefault()
      event.stopPropagation()
      setLeave(() => () => {
        window.location.href = anchor.href
      })
    }
    window.addEventListener("beforeunload", unload)
    document.addEventListener("click", click, true)
    return () => {
      window.removeEventListener("beforeunload", unload)
      document.removeEventListener("click", click, true)
    }
  }, [dirty])
  async function save(confirmed: boolean) {
    if (!setting || busy) return
    setBusy(true)
    setError(null)
    setSaved(false)
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
      setSaved(true)
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Measurement retention</h1>
        <p className="mt-2 text-muted-foreground">
          Manage how long organizations retain measurement history.
        </p>
      </div>
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
      <Card>
        <CardHeader>
          <CardTitle>Choose a setting</CardTitle>
          <CardDescription>
            Organization overrides take precedence over the saved platform
            default. The fallback is 90 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={id + "-search"}>
                Find an organization
              </FieldLabel>
              <Input
                id={id + "-search"}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={id + "-scope"}>Settings for</FieldLabel>
              <Select
                value={org}
                disabled={busy}
                onValueChange={(value) => {
                  if (dirty) setLeave(() => () => setOrg(value))
                  else setOrg(value)
                }}
              >
                <SelectTrigger id={id + "-scope"} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="platform">Platform default</SelectItem>
                    {organizations.map((o) => (
                      <SelectItem key={o.uuid} value={o.uuid}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <div className="mt-4 flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous organizations
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!more}
              onClick={() => setPage((p) => p + 1)}
            >
              More organizations
            </Button>
          </div>
        </CardContent>
      </Card>
      {setting && (
        <Card>
          <CardHeader>
            <CardTitle>
              {org === "platform"
                ? "Platform default"
                : "Organization override"}
            </CardTitle>
            <CardDescription>
              Effective retention: {setting.days} days · Source:{" "}
              {setting.source === "default"
                ? "90-day fallback"
                : setting.source === "platform"
                  ? "saved platform default"
                  : "organization override"}
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                      ? "Use the 90-day fallback"
                      : "Inherit the platform default"}
                  </FieldLabel>
                </Field>
                <Field>
                  <FieldLabel htmlFor={id + "-days"}>
                    Retention in days
                  </FieldLabel>
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
                  />
                  <FieldDescription>
                    Positive whole days. Removing an override restores
                    inheritance.
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <p className="text-sm text-muted-foreground">
                Daily cleanup deletes measurements received before the cutoff.
                Configuration and command audit records are retained. Increasing
                retention cannot recover deleted measurements.
              </p>
              {saved && (
                <p role="status" className="text-sm">
                  Retention settings saved.
                </p>
              )}
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
          </CardContent>
        </Card>
      )}
      {setting && (
        <Card>
          <CardHeader>
            <CardTitle>Cleanup status</CardTitle>
            <CardDescription>
              {setting.cleanup
                ? `Latest recorded run: ${new Date(setting.cleanup.at).toLocaleString()} · ${setting.cleanup.status}`
                : "The first daily cleanup has not been recorded yet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
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
              <p className="text-sm text-muted-foreground">
                {setting.cleanup.deleted_rows} measurement and diagnostic rows
                removed in the latest recorded run. Pending or failed cleanup is
                retried by the runtime.
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {!setting && !error && <p role="status">Loading retention settings…</p>}
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
              {new Date(Date.now() - effective * 86400000).toLocaleString()}{" "}
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
      <AlertDialog
        open={Boolean(leave)}
        onOpenChange={(v) => {
          if (!v) setLeave(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Discard unsaved retention changes?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The saved setting will remain unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                const action = leave
                setLeave(null)
                action?.()
              }}
            >
              Discard changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
