import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel"
import { AppearanceSettings } from "@iot-os/ui/components/theme-picker"
import { SettingsPage } from "@iot-os/ui/templates/settings-page"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { useDeviceOrganization } from "../devices/shared"
import { TimezoneField } from "../devices/TimezoneField"
import { EmailPreferences } from "../alerts/EmailPreferences"
import { NotificationsList, WorkflowNotificationsPage } from "../alerts/NotificationSettings"
import { MembersPage } from "../members/Members"
import RoleRoutes, { RolesList } from "../members/Roles"
import { useAdministration } from "../members/shared"

/** One place for organization and personal settings. */
export default function SettingsRoutes() {
  const { org, can } = useAdministration()
  const { capabilities } = useDeviceOrganization()
  const { pathname } = useLocation()
  const base = `/organizations/${org}/settings`
  const sections = [
    { key: "general", label: "General", to: `${base}/general` },
    ...(can.members_view ? [{ key: "members", label: "Members", to: `${base}/members` }] : []),
    ...(can.roles_view ? [{ key: "roles", label: "Roles", to: `${base}/roles` }] : []),
    ...(capabilities.manage ? [{ key: "notifications", label: "Notifications", to: `${base}/notifications` }] : []),
    { key: "email", label: "Email preferences", to: `${base}/email` },
  ].map((section) => ({ ...section, current: pathname.startsWith(section.to) }))
  const layout = (
    <SettingsPage sections={sections}>
      <Outlet />
    </SettingsPage>
  )
  return (
    <Routes>
      <Route index element={<Navigate to="general" replace />} />
      <Route element={layout}>
        <Route path="general" element={<GeneralSettings />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="roles" element={<RolesList />} />
        <Route path="notifications" element={<NotificationsList />} />
        <Route path="email" element={<EmailSettings />} />
      </Route>
      <Route path="roles/*" element={<RoleRoutes />} />
      <Route path="notifications/:workflowUuid" element={<WorkflowNotificationsPage />} />
    </Routes>
  )
}

function GeneralSettings() {
  const { org, capabilities } = useDeviceOrganization()
  const client = useQueryClient()
  const sites = useQuery({ queryKey: ["sites", org], queryFn: () => api.sites(org) })
  const zone = useMutation({
    mutationFn: (timezone: string) => api.setOrganizationTimezone(org, timezone || null),
    onSuccess: () => client.invalidateQueries({ queryKey: ["sites", org] }),
  })
  return (
    <div className="flex max-w-form flex-col gap-(--panel-gap)">
      <h2 className="text-title">General</h2>
      <Panel>
        <PanelHeader>
          <PanelTitle>Time zone</PanelTitle>
          <PanelDescription>
            Devices without a site cut days, months and shifts in this zone. Times still show in each viewer's own zone.
          </PanelDescription>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-3">
          <RequestError error={sites.error ?? zone.error} />
          <TimezoneField
            label="Organization time zone"
            value={sites.data?.organization_timezone ?? ""}
            allowNone
            disabled={!capabilities.manage || zone.isPending || sites.isPending}
            onChange={(value) => zone.mutate(value)}
          />
        </PanelContent>
      </Panel>
      <Panel>
        <PanelHeader>
          <PanelTitle>Appearance</PanelTitle>
          <PanelDescription>Saved in this browser only.</PanelDescription>
        </PanelHeader>
        <PanelContent className="py-0">
          <AppearanceSettings />
        </PanelContent>
      </Panel>
    </div>
  )
}

/** Personal: applies to this account in every organization. */
function EmailSettings() {
  return (
    <div className="flex max-w-form flex-col gap-(--panel-gap)">
      <h2 className="text-title">Email preferences</h2>
      <EmailPreferences />
    </div>
  )
}
