import { Navigate, useParams, useSearchParams } from "react-router-dom"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { api } from "../lib/api"
import { MyNotifications } from "../alerts/MyNotifications"
import { legacyNotificationPath } from "../alerts/model"

/**
 * The notification center moved: events to Alerts → Event log, preferences to Settings → My
 * notifications. Old links land there; without any organization only the personal settings remain.
 */
export default function NotificationCenter() {
  const { organizationUuid } = useParams()
  const [params] = useSearchParams()
  const org = organizationUuid ?? api.getSelectedOrganizationUuid()
  if (org) return <Navigate replace to={legacyNotificationPath(org, params)} />
  return <>
    <PageHeader title="My notifications" />
    <div className="flex flex-col gap-6 p-4 md:p-6"><MyNotifications /></div>
  </>
}

/**
 * A push opens `/settings/my-notifications` (the test push names no organization): the
 * selected organization's page, or the personal page without one.
 */
export function MyNotificationsRedirect() {
  const org = api.getSelectedOrganizationUuid()
  if (org) return <Navigate replace to={`/organizations/${encodeURIComponent(org)}/settings/my-notifications`} />
  return <Navigate replace to="/notifications" />
}
