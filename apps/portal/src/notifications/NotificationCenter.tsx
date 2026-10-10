import { Navigate, useParams, useSearchParams } from "react-router-dom"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { api } from "../lib/api"
import { EmailPreferences } from "../alerts/EmailPreferences"
import { legacyNotificationPath } from "../alerts/model"

/**
 * The notification center moved into Alerts (Event log and Email preferences tabs).
 * Old links land there; without any organization only the personal email preferences remain.
 */
export default function NotificationCenter() {
  const { organizationUuid } = useParams()
  const [params] = useSearchParams()
  const org = organizationUuid ?? api.getSelectedOrganizationUuid()
  if (org) return <Navigate replace to={legacyNotificationPath(org, params)} />
  return <>
    <PageHeader title="Email preferences" />
    <div className="flex flex-col gap-6 p-4 md:p-6"><EmailPreferences /></div>
  </>
}
