import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import type { OrganizationPermissionCeiling } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog"
import { Button } from "@iot-os/ui/components/button"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Panel, PanelContent, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { PermissionMatrix, permissionChanges } from "@iot-os/ui/components/permission-matrix"
import { RadioGroup, RadioGroupItem } from "@iot-os/ui/components/radio-group"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { keepToastsAbove } from "@iot-os/ui/components/sonner"
import { AlertCircleIcon } from "lucide-react"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"

const back = { to: "/organizations", label: "Organizations" }

type Draft = { restricted: boolean; selected: ReadonlySet<string> }

/** The permission ceiling: which tenant permissions this organization's roles may hold. */
export function OrganizationPermissionsPage() {
  const { organizationUuid = "" } = useParams()
  const [ceiling, setCeiling] = useState<OrganizationPermissionCeiling | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [draft, setDraft] = useState<Draft>({ restricted: false, selected: new Set() })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let active = true
    setLoadError(false)
    apiClient
      .adminOrganizationPermissions(organizationUuid)
      .then((data) => {
        if (!active) return
        setCeiling(data)
        setDraft({ restricted: data.restricted, selected: new Set(data.permission_names) })
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
    return () => {
      active = false
    }
  }, [organizationUuid])

  const saved = new Set(ceiling?.permission_names ?? [])
  const everything = new Set(ceiling?.catalogue.map((permission) => permission.name) ?? [])
  // Unrestricted means every catalogue permission, now and later.
  const effective = draft.restricted ? draft.selected : everything
  const changes = permissionChanges(effective, saved)
  const dirty = Boolean(ceiling) && (draft.restricted !== ceiling?.restricted || changes.dirty)
  const { dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard unsaved permission changes?",
    description: `The available permissions for ${ceiling?.organization.name ?? "this organization"} will not change.`,
  })

  async function save() {
    if (!ceiling) return
    setSaving(true)
    setSaveError(null)
    try {
      const data = await apiClient.updateAdminOrganizationPermissions(ceiling.organization.uuid, {
        restricted: draft.restricted,
        permission_names: draft.restricted ? [...draft.selected].sort() : [],
      })
      setCeiling(data)
      setDraft({ restricted: data.restricted, selected: new Set(data.permission_names) })
      toast.success(`Available permissions saved for ${data.organization.name}`)
    } catch {
      setSaveError("The available permissions could not be saved. Your selections are kept; try again.")
    } finally {
      setSaving(false)
      setConfirming(false)
    }
  }

  if (loadError)
    return (
      <>
        <PageHeader title="Available permissions" back={back} />
        <div className="p-4 md:p-6">
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Could not load this organization</AlertTitle>
            <AlertDescription>Go back to Organizations and try again.</AlertDescription>
          </Alert>
        </div>
      </>
    )

  if (!ceiling)
    return (
      <>
        <PageHeader title="Available permissions" back={back} />
        <div className="flex flex-col gap-3 p-4 md:p-6" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </>
    )

  return (
    <>
      <PageHeader
        title={`Available permissions · ${ceiling.organization.name}`}
        heading="Available permissions"
        back={back}
        meta={`${ceiling.organization.name} · ${effective.size} of ${everything.size} permissions`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <p className="max-w-3xl text-body text-muted-foreground">
          Organization administrators can only grant permissions available here. Organization Admin always has exactly
          this set.
        </p>
        <Panel>
          <PanelContent>
        <FieldSet>
          <FieldLegend variant="label">Permissions this organization can use</FieldLegend>
          <RadioGroup
            value={draft.restricted ? "selected" : "all"}
            onValueChange={(value) =>
              setDraft((current) => ({
                restricted: value === "selected",
                // Restricting starts from everything currently available, so nothing is lost by accident.
                selected: value === "selected" && !current.restricted ? new Set(everything) : current.selected,
              }))
            }
            disabled={saving}
            className="max-w-xl"
          >
            <Field orientation="horizontal">
              <RadioGroupItem value="all" id="ceiling-all" />
              <FieldContent>
                <FieldLabel htmlFor="ceiling-all">All permissions</FieldLabel>
                <FieldDescription>Includes permissions added by future platform features.</FieldDescription>
              </FieldContent>
            </Field>
            <Field orientation="horizontal">
              <RadioGroupItem value="selected" id="ceiling-selected" />
              <FieldContent>
                <FieldLabel htmlFor="ceiling-selected">Only selected permissions</FieldLabel>
                <FieldDescription>New platform permissions stay unavailable until you add them.</FieldDescription>
              </FieldContent>
            </Field>
          </RadioGroup>
        </FieldSet>
          </PanelContent>
        </Panel>

        {saveError ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Could not save</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}

        <Panel>
          <PanelHeader>
            <PanelTitle>Permissions</PanelTitle>
          </PanelHeader>
          <PanelContent>
        <PermissionMatrix
          permissions={ceiling.catalogue}
          selected={effective}
          initial={saved}
          disabled={!draft.restricted || saving}
          onChange={(selected) => setDraft({ restricted: true, selected })}
        />
          </PanelContent>
        </Panel>
      </div>

      <div ref={keepToastsAbove} className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-background px-4 py-3 md:px-6">
        <p className="mr-auto text-sm" aria-live="polite">
          {dirty ? (
            <>
              Unsaved changes{" "}
              <span className="text-muted-foreground">
                · {changes.added} added, {changes.removed} removed
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">All changes saved</span>
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => setDraft({ restricted: ceiling.restricted, selected: new Set(ceiling.permission_names) })}
        >
          Reset changes
        </Button>
        <Button
          type="button"
          disabled={!dirty || saving || (draft.restricted && draft.selected.size === 0)}
          onClick={() => (changes.removed > 0 ? setConfirming(true) : void save())}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={(open) => !open && !saving && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {changes.removed} {changes.removed === 1 ? "permission" : "permissions"} from{" "}
              {ceiling.organization.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every role in this organization loses them immediately, including Organization Admin. Adding them back
              later restores them only to Organization Admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Remove permissions"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {discardDialog}
    </>
  )
}
