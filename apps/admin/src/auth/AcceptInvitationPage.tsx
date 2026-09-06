import { AcceptInvitationPage as SharedInvitationPage } from "@iot-os/auth/AcceptInvitationPage"
import { apiClient } from "../lib/api-client"
export function AcceptInvitationPage() {
  return <SharedInvitationPage apiClient={apiClient} portalUrl={import.meta.env.VITE_PORTAL_URL || `${window.location.protocol}//${window.location.hostname}:5173`} />
}
