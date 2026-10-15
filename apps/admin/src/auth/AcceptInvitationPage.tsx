import { AcceptInvitationPage as SharedInvitationPage } from "@iot-os/auth/AcceptInvitationPage"
import { apiClient } from "../lib/api-client"
import { portalUrl } from "../lib/portal"

export function AcceptInvitationPage() {
  return <SharedInvitationPage apiClient={apiClient} portalUrl={portalUrl} adminUrl="/" />
}
