import { useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { BellOffIcon, BellRingIcon, SmartphoneIcon } from "lucide-react"
import { ApiError, type NotificationLevel, type PushDevice, type PushLevels, type PushSettings } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { FieldGroup, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { SwitchField } from "@iot-os/ui/components/form-fields"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { api } from "../lib/api"
import { useUnsavedContribution } from "../lib/unsaved"
import { Confirm, RequestError, SaveBar, errorMessage } from "../components/forms"
import { InstallAppDialog } from "../pwa/InstallAppDialog"
import { SIGNED_OUT_HERE, removeDevice } from "../pwa/push"
import { support as pushSupport, type PushSupport } from "../pwa/push-support"
import { pushSettingsKey, usePushSettings, useSignedInUser, useThisDevice, useTurnOnPush } from "../pwa/usePush"
import { EmailPreferences } from "./EmailPreferences"

/**
 * My notifications (spec 033, US2 and US5): push on this person's devices and their alert
 * emails. Personal: it applies to the account in every organization.
 */
export function MyNotifications() {
  return (
    <div className="flex max-w-form flex-col gap-(--panel-gap)">
      <h2 className="text-title">My notifications</h2>
      <PushPanels />
      <EmailPreferences />
    </div>
  )
}

const levelLabels: Record<NotificationLevel, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
  recovery: "Cleared",
}
const levelDescriptions: Partial<Record<NotificationLevel, string>> = {
  recovery: "When an alert's condition clears.",
}
const levelOrder: NotificationLevel[] = ["critical", "warning", "info", "recovery"]

function PushPanels() {
  const user = useSignedInUser()?.id
  const settings = usePushSettings()
  const here = useThisDevice(user)
  if (settings.isPending) return <Skeleton className="h-40 w-full" />
  if (settings.error) return <RequestError error={settings.error} />
  const data = settings.data
  // No push key on this deployment: nothing about push is shown.
  if (!data.available || !data.public_key) return null
  const thisDevice = here && data.devices.some((device) => device.uuid === here) ? here : null
  return (
    <>
      <Panel>
        <PanelHeader>
          <PanelTitle>Push notifications</PanelTitle>
          <PanelDescription>
            The alerts in your bell, as notifications on your phone or computer, even while the app is closed.
          </PanelDescription>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-4">
          <ThisDevice publicKey={data.public_key} user={user} registered={thisDevice !== null} />
          {data.devices.length > 0 && <DeviceList devices={data.devices} thisDevice={thisDevice} user={user} />}
        </PanelContent>
      </Panel>
      {data.levels && <PushChoices data={data} levels={data.levels} />}
    </>
  )
}

/** Turning push on here, or why it can't be. */
function ThisDevice({ publicKey, user, registered }: { publicKey: string; user: number | undefined; registered: boolean }) {
  const support: PushSupport = pushSupport()
  const turnOn = useTurnOnPush(user)
  const [steps, setSteps] = useState(false)
  if (registered)
    return (
      <p className="flex items-center gap-2 text-body text-muted-foreground">
        <BellRingIcon className="size-4 shrink-0 text-success" aria-hidden="true" />
        Push is on for this device.
      </p>
    )
  if (support === "ios-needs-install")
    return (
      <Alert>
        <SmartphoneIcon />
        <AlertTitle>Add the app to your Home Screen first</AlertTitle>
        <AlertDescription>
          On iPhone and iPad, notifications work in the app added to the Home Screen, not in the browser. Add it, open
          it from the Home Screen, sign in there and turn on push.
          <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => setSteps(true)}>
            Show me how
          </Button>
        </AlertDescription>
        <InstallAppDialog open={steps} onOpenChange={setSteps} ios />
      </Alert>
    )
  if (support === "unsupported")
    return (
      <Alert>
        <BellOffIcon />
        <AlertTitle>This browser can't receive push notifications</AlertTitle>
        <AlertDescription>Use Chrome, Edge, Firefox or Safari, or the app on your phone.</AlertDescription>
      </Alert>
    )
  if (support === "denied")
    return (
      <Alert>
        <BellOffIcon />
        <AlertTitle>Notifications are blocked for this site</AlertTitle>
        <AlertDescription>
          Allow notifications in the browser's site settings, or on a phone in its Settings under Notifications, then
          reload this page.
        </AlertDescription>
      </Alert>
    )
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-body text-muted-foreground">Push is off for this device.</p>
      <Button disabled={turnOn.pending || user === undefined} onClick={() => turnOn.run(publicKey)}>
        <BellRingIcon data-icon="inline-start" />
        {turnOn.pending ? "Turning on…" : "Turn on push on this device"}
      </Button>
    </div>
  )
}

function DeviceList({ devices, thisDevice, user }: { devices: PushDevice[]; thisDevice: string | null; user: number | undefined }) {
  const cache = useQueryClient()
  const [removing, setRemoving] = useState<PushDevice | null>(null)
  const test = useMutation({
    mutationFn: (device: PushDevice) => api.testPushDevice(device.uuid),
    onSuccess: (result, device) => {
      if (result.status === "accepted") toast.success(`Test sent to ${device.label}`, { description: "It arrives in a few seconds." })
      else if (result.status === "gone")
        toast.error(`${device.label} can't get push any more`, {
          description: "Its browser stopped the subscription, so it was removed. Turn on push there again.",
        })
      else toast.error("The test didn't get through", { description: "The push service didn't answer. Try again in a minute." })
      void cache.invalidateQueries({ queryKey: pushSettingsKey })
    },
    onError: (error) => toast.error("The test couldn't be sent", { description: errorMessage(error) }),
  })
  const columns: DataColumn<PushDevice>[] = [
    {
      id: "device",
      header: "Device",
      mobile: "title",
      hideable: false,
      value: (device) => device.label,
      cell: (device) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="max-md:font-medium">{device.label}</span>
          {device.uuid === thisDevice && <Badge variant="secondary">This device</Badge>}
        </span>
      ),
    },
    {
      id: "added",
      header: "Added",
      mobile: "meta",
      hideable: false,
      className: "text-muted-foreground",
      cell: (device) => <RelativeTime at={device.created_at} />,
    },
    {
      id: "reached",
      header: "Last reached",
      mobile: "meta",
      hideable: false,
      className: "text-muted-foreground",
      cell: (device) => <RelativeTime at={device.last_reached_at} never="Not yet" />,
    },
    {
      id: "actions",
      header: "Actions",
      headerHidden: true,
      align: "end",
      hideable: false,
      cell: (device) => (
        <span className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate(device)}>
            Send test
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRemoving(device)}>
            Remove
          </Button>
        </span>
      ),
    },
  ]
  const here = removing?.uuid === thisDevice
  return (
    <>
      <DataTable
        id="push-devices"
        label="Push devices"
        noun={["device", "devices"]}
        rows={devices}
        rowKey={(device) => device.uuid}
        rowLabel={(device) => device.label}
        columns={columns}
      />
      <Confirm
        open={Boolean(removing)}
        title={here ? "Remove this device?" : `Remove ${removing?.label ?? "this device"}?`}
        description={
          here
            ? "Push stops here and this browser is signed out, as when you sign out."
            : `Push stops on ${removing?.label ?? "it"}, and it is signed out there. Use this for a lost or old phone.`
        }
        action="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing || user === undefined) return
          const { signedOut } = await removeDevice(removing.uuid, user)
          if (signedOut) {
            window.dispatchEvent(new Event(SIGNED_OUT_HERE))
            return
          }
          toast.success(`${removing.label} was removed`)
          await cache.invalidateQueries({ queryKey: pushSettingsKey })
        }}
      />
    </>
  )
}

type Draft = { enabled: boolean; levels: PushLevels; organizations: Record<string, boolean> }

const draftOf = (data: PushSettings, levels: PushLevels): Draft => ({
  enabled: data.enabled,
  levels,
  organizations: Object.fromEntries(data.organizations.map((organization) => [organization.uuid, organization.enabled])),
})
const signature = (data: PushSettings) =>
  `${data.revision}:${data.organizations.map((organization) => `${organization.uuid}=${organization.enabled}`).join(",")}`
const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b)

/** Levels, the switch and organizations: saved together with the sticky bar. */
function PushChoices({ data, levels }: { data: PushSettings; levels: PushLevels }) {
  const cache = useQueryClient()
  const saved = draftOf(data, levels)
  const [draft, setDraft] = useState(saved)
  // Saved elsewhere, refused as stale, or just saved here: the form starts from the latest.
  const [loaded, setLoaded] = useState(signature(data))
  if (loaded !== signature(data)) {
    setLoaded(signature(data))
    setDraft(saved)
  }
  const dirty = !sameDraft(draft, saved)
  useUnsavedContribution(dirty)
  const save = useMutation({
    mutationFn: async (next: Draft) => {
      let latest = data
      if (next.enabled !== data.enabled || levelOrder.some((level) => next.levels[level] !== levels[level]))
        latest = await api.updatePushSettings({ revision: data.revision, enabled: next.enabled, levels: next.levels })
      for (const organization of data.organizations)
        if (next.organizations[organization.uuid] !== organization.enabled)
          latest = await api.setPushOrganization(organization.uuid, next.organizations[organization.uuid])
      return latest
    },
    onSuccess: (latest) => cache.setQueryData(pushSettingsKey, latest),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) void cache.invalidateQueries({ queryKey: pushSettingsKey })
    },
  })
  const stale = save.error instanceof ApiError && save.error.status === 409
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate(draft)
  }
  return (
    <Panel>
      <form onSubmit={submit}>
        <PanelHeader>
          <PanelTitle>What gets pushed</PanelTitle>
          <PanelDescription>For your account in every organization, on every device above.</PanelDescription>
          <PanelActions>
            <Button
              type="button"
              variant="outline"
              disabled={!data.enabled || dirty || save.isPending}
              onClick={() => save.mutate({ ...saved, enabled: false })}
            >
              <BellOffIcon data-icon="inline-start" />
              Turn off push everywhere
            </Button>
          </PanelActions>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-6">
          {stale ? (
            <Alert>
              <AlertTitle>Your push settings changed in another window</AlertTitle>
              <AlertDescription>The latest settings are shown. Make your changes again.</AlertDescription>
            </Alert>
          ) : (
            <RequestError error={save.error} />
          )}
          <SwitchField
            align="end"
            id="push-enabled"
            label="Push notifications"
            description="Off stops push on every device. Your levels, organizations and devices are kept."
            checked={draft.enabled}
            disabled={save.isPending}
            onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          />
          <FieldSet>
            <FieldLegend variant="label">Levels</FieldLegend>
            <FieldGroup className="gap-4">
              {levelOrder.map((level) => (
                <SwitchField
                  key={level}
                  align="end"
                  id={`push-level-${level}`}
                  label={levelLabels[level]}
                  description={levelDescriptions[level]}
                  checked={draft.levels[level]}
                  disabled={save.isPending || !draft.enabled}
                  onCheckedChange={(on) => setDraft({ ...draft, levels: { ...draft.levels, [level]: on } })}
                />
              ))}
            </FieldGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">Organizations</FieldLegend>
            {data.organizations.length ? (
              <FieldGroup className="gap-4">
                {data.organizations.map((organization) => (
                  <SwitchField
                    key={organization.uuid}
                    align="end"
                    id={`push-organization-${organization.uuid}`}
                    label={organization.name}
                    checked={draft.organizations[organization.uuid] ?? true}
                    disabled={save.isPending || !draft.enabled}
                    onCheckedChange={(on) =>
                      setDraft({ ...draft, organizations: { ...draft.organizations, [organization.uuid]: on } })
                    }
                  />
                ))}
              </FieldGroup>
            ) : (
              <p className="text-body text-muted-foreground">You aren't in an organization that sends alerts.</p>
            )}
          </FieldSet>
          <p className="text-meta text-muted-foreground">
            Push follows your bell: an automation must list you as a recipient. An organization switched off still
            shows its alerts in the bell.
          </p>
        </PanelContent>
        <SaveBar dirty={dirty} busy={save.isPending} onCancel={() => setDraft(saved)} />
      </form>
    </Panel>
  )
}
