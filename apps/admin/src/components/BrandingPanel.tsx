import { useCallback, useEffect, useState } from "react"
import { ApiError, type BillingAccountDetail, type Branding } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { BrandEditor, type BrandEditorFailure } from "@iot-os/ui/components/brand-editor"
import { Button } from "@iot-os/ui/components/button"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { AlertCircleIcon, InfoIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { errorMessage } from "../lib/errors"

function brandFailure(error: unknown): BrandEditorFailure {
  if (error instanceof ApiError) {
    const payload = error.payload as { message?: string; code?: string; errors?: Record<string, string[]> } | null
    if (error.status === 409 && payload?.code === "brand_changed") return { conflict: true, message: payload.message ?? "" }
    if (error.status === 422 && payload?.errors)
      return { fields: payload.errors, message: Object.values(payload.errors).flat()[0] ?? errorMessage(error) }
  }
  return { message: errorMessage(error) }
}

/**
 * A billing account's brand, edited on its owners' behalf (spec 036 US6). Staff can
 * prepare it before Branding is on; it shows only once the allowance is on and it has a
 * product name.
 */
export function BrandingPanel({ account }: { account: Pick<BillingAccountDetail, "uuid" | "name" | "allowances"> }) {
  const [branding, setBranding] = useState<Branding | null>(null)
  const [failed, setFailed] = useState(false)
  const [dirty, setDirty] = useState(false)
  const { dialog } = useDiscardGuard(dirty, { title: "Discard the brand changes?", description: "The names and link you changed are not saved." })
  // The switch is changed in the Allowances panel beside this one.
  const allowed = account.allowances.find((allowance) => allowance.kind === "branding")?.value === 1

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setBranding(await apiClient.branding(account.uuid, true))
    } catch {
      setFailed(true)
    }
  }, [account.uuid])
  useEffect(() => void load(), [load, allowed])

  return (
    <Panel aria-labelledby="billing-branding">
      <PanelHeader>
        <PanelTitle id="billing-branding">Branding</PanelTitle>
        <PanelDescription>
          The product name and logo {account.name}&apos;s organizations see instead of the platform&apos;s.
          {branding ? (
            <StatusMark tone={branding.brand.in_effect ? "good" : "muted"} className="ml-2">
              {branding.brand.in_effect ? "Shown" : "Not shown"}
            </StatusMark>
          ) : null}
        </PanelDescription>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        {failed ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>
              Could not load the brand.
              <Button variant="outline" size="sm" className="mt-2 self-start" onClick={() => void load()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {!branding && !failed ? <Skeleton className="h-40 w-full" /> : null}
        {branding && !allowed ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>Branding is off for this account</AlertTitle>
            <AlertDescription>
              You can prepare the brand here. It shows once Branding is turned on under Allowances and it has a product name.
            </AlertDescription>
          </Alert>
        ) : null}
        {branding ? (
          <BrandEditor
            brand={branding.brand}
            limits={branding.limits}
            platformName="IoT OS"
            idPrefix="admin-brand"
            onSave={async (values) => {
              const saved = await apiClient.updateBrand(account.uuid, values, true)
              toast.success(`Brand of ${account.name} saved`)
              return saved
            }}
            onImage={(role, file) => apiClient.setBrandImage(account.uuid, role, file, true)}
            onRemoveImage={(role) => apiClient.removeBrandImage(account.uuid, role, true)}
            onChange={(brand) => setBranding((current) => current && { ...current, brand })}
            onReload={() => void load()}
            onDirtyChange={setDirty}
            describeError={brandFailure}
          />
        ) : null}
      </PanelContent>
      {dialog}
    </Panel>
  )
}
