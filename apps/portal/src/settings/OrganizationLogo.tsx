import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { defaultBrandImageLimits, type AuthenticatedUser, type OrganizationLogoRole, type OrganizationLogos } from "@iot-os/api-client"
import { FieldGroup } from "@iot-os/ui/components/field"
import { ImageField } from "@iot-os/ui/components/image-field"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { toast } from "sonner"
import { api } from "../lib/api"
import { errorMessage } from "../components/forms"
import { useAdministration } from "../members/shared"

/**
 * The organization's own logo (spec 036 US2), shown in the sidebar instead of its name's
 * initial. People who may update the organization change it; everyone else sees it.
 */
export function OrganizationLogoPanel() {
  const { org, organization } = useAdministration()
  const client = useQueryClient()
  const [busy, setBusy] = useState<OrganizationLogoRole | null>(null)
  const [errors, setErrors] = useState<Partial<Record<OrganizationLogoRole, string>>>({})
  if (!organization) return null
  const editable = Boolean(organization.capabilities?.manage_administration)
  const inherited = !organization.logo && organization.brand?.logo ? organization.brand : null

  async function change(role: OrganizationLogoRole, request: () => Promise<OrganizationLogos>, done: string) {
    setErrors((current) => ({ ...current, [role]: undefined }))
    setBusy(role)
    try {
      const logos = await request()
      // The sidebar reads the session: show the change there at once.
      client.setQueryData<AuthenticatedUser>(["session"], (session) =>
        session && {
          ...session,
          organizations: session.organizations.map((item) =>
            item.uuid === logos.uuid ? { ...item, logo: logos.logo, logo_dark: logos.logo_dark, brand: logos.brand } : item,
          ),
        },
      )
      toast.success(done)
    } catch (error) {
      setErrors((current) => ({ ...current, [role]: errorMessage(error) }))
    } finally {
      setBusy(null)
    }
  }

  const field = (role: OrganizationLogoRole, label: string, description: string, surface?: "dark") => (
    <ImageField
      id={`organization-${role}`}
      label={label}
      description={description}
      value={organization[role] ?? null}
      accept={defaultBrandImageLimits.types}
      maxBytes={defaultBrandImageLimits.image_bytes}
      surface={surface}
      busy={busy === role}
      disabled={!editable || (busy !== null && busy !== role)}
      error={errors[role]}
      onSelect={(file) => void change(role, () => api.setOrganizationLogo(org, role, file), `${label} saved`)}
      onRemove={editable ? () => void change(role, () => api.removeOrganizationLogo(org, role), `${label} removed`) : undefined}
    />
  )

  return (
    <Panel aria-labelledby="organization-logo-title">
      <PanelHeader>
        <PanelTitle id="organization-logo-title">Organization logo</PanelTitle>
        <PanelDescription>
          Shown in the sidebar for everyone in {organization.name}.
          {inherited ? " Without one, the logo of the organization's provider is shown." : ""}
          {editable ? "" : " Only people who may update the organization can change it."}
        </PanelDescription>
      </PanelHeader>
      <PanelContent>
        <FieldGroup>
          {field("logo", "Logo", "Scaled to fit 480 × 160 pixels.")}
          {field("logo_dark", "Logo for dark appearance", "Optional. Without it, the logo is shown on dark appearance too.", "dark")}
        </FieldGroup>
      </PanelContent>
    </Panel>
  )
}
