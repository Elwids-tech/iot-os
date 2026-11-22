import { useCallback, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError, PLATFORM_NAME, type Brand, type Branding } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { BrandEditor, type BrandEditorFailure } from "@iot-os/ui/components/brand-editor"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { LockIcon } from "lucide-react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { errorMessage, RequestError } from "../components/forms"
import { useUnsavedContribution } from "../lib/unsaved"

export const brandingKey = (account: string) => ["owned-billing-account-branding", account]

/** What a failed brand request means for the editor: field errors, a newer brand, or a message. */
export function brandFailure(error: unknown): BrandEditorFailure {
  if (error instanceof ApiError) {
    const payload = error.payload as { message?: string; code?: string; errors?: Record<string, string[]> } | null
    if (error.status === 409 && payload?.code === "brand_changed") return { conflict: true, message: payload.message ?? "" }
    if (error.status === 403 && payload?.code === "branding_not_allowed")
      return { message: "Branding is no longer part of this billing account's plan." }
    if (error.status === 422 && payload?.errors)
      return { fields: payload.errors, message: Object.values(payload.errors).flat()[0] ?? errorMessage(error) }
  }
  return { message: errorMessage(error) }
}

/**
 * The billing account's brand (spec 036 US1): its owners replace the platform's name and
 * logo for every organization under the account. Without the plan's branding it says so
 * and nothing can be changed.
 */
export function BrandingPanel({ accountUuid, accountName }: { accountUuid: string; accountName: string }) {
  const client = useQueryClient()
  const branding = useQuery({ queryKey: brandingKey(accountUuid), queryFn: () => api.branding(accountUuid) })
  const [dirty, setDirty] = useState(false)
  useUnsavedContribution(dirty)
  const set = useCallback(
    (brand: Brand) => {
      client.setQueryData<Branding>(brandingKey(accountUuid), (current) => current && { ...current, brand })
      // Organizations show the brand's logo and name: read them again.
      void client.invalidateQueries({ queryKey: ["session"] })
    },
    [client, accountUuid],
  )
  const allowed = branding.data?.allowances.branding ?? false
  const brand = branding.data?.brand

  return (
    <Panel aria-labelledby="billing-branding">
      <PanelHeader>
        <PanelTitle id="billing-branding">Branding</PanelTitle>
        <PanelDescription>
          Your product name and logo instead of the platform's, for every organization of {accountName}.
          {brand && allowed ? (
            <StatusMark tone={brand.in_effect ? "good" : "muted"} className="ml-2">
              {brand.in_effect ? "Shown" : "Not shown until it has a product name"}
            </StatusMark>
          ) : null}
        </PanelDescription>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        <RequestError error={branding.error} />
        {branding.isPending ? <Skeleton className="h-40 w-full" /> : null}
        {branding.data && !allowed ? (
          <Alert>
            <LockIcon />
            <AlertTitle>Branding is not part of your plan</AlertTitle>
            <AlertDescription>
              Contact the platform operator to add it.
              {branding.data.brand.revision > 0 ? " The brand saved earlier is kept and shows again once branding is back." : ""}
            </AlertDescription>
          </Alert>
        ) : null}
        {branding.data && (allowed || branding.data.brand.revision > 0) ? (
          <BrandEditor
            // A different account is a different draft.
            key={accountUuid}
            brand={branding.data.brand}
            limits={branding.data.limits}
            platformName={PLATFORM_NAME}
            disabled={!allowed}
            onSave={async (values) => {
              const saved = await api.updateBrand(accountUuid, values)
              toast.success("Brand saved")
              return saved
            }}
            onImage={(role, file) => api.setBrandImage(accountUuid, role, file)}
            onRemoveImage={(role) => api.removeBrandImage(accountUuid, role)}
            onChange={set}
            onReload={() => void branding.refetch()}
            onDirtyChange={setDirty}
            describeError={brandFailure}
          />
        ) : null}
      </PanelContent>
    </Panel>
  )
}
