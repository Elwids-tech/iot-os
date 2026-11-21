import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError, type PortalAddress } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog"
import { Button } from "@iot-os/ui/components/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@iot-os/ui/components/field"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@iot-os/ui/components/input-group"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { ExternalLinkIcon, LockIcon } from "lucide-react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { errorMessage, RequestError } from "../components/forms"
import { useUnsavedContribution } from "../lib/unsaved"
import { brandingKey } from "./BrandingPanel"

/** What the API says about a name, as one sentence under the field. */
function nameError(error: unknown): string {
  if (error instanceof ApiError) {
    const payload = error.payload as { code?: string; message?: string } | null
    if (payload?.code === "name_taken") return "This name is taken. Choose another."
    if (payload?.code === "name_reserved") return "This name is reserved. Choose another."
    if (payload?.message) return payload.message
  }
  return errorMessage(error)
}

/**
 * The billing account's portal addresses (spec 036 US1): a name under the platform's
 * domain where its people open the portal under its brand. Says why when the plan or
 * the deployment does not offer addresses.
 */
export function AddressesPanel({ accountUuid }: { accountUuid: string }) {
  const client = useQueryClient()
  const branding = useQuery({ queryKey: brandingKey(accountUuid), queryFn: () => api.branding(accountUuid) })
  const data = branding.data
  const current = data?.addresses.find((address) => address.kind === "name") ?? null
  const suffix = data?.name_suffix ?? ""
  const held = current ? current.host.slice(0, current.host.length - suffix.length) : ""
  const [name, setName] = useState("")
  const [removing, setRemoving] = useState<PortalAddress | null>(null)
  // The field follows the saved name until someone types in it.
  useEffect(() => setName(held), [held])
  const dirty = name.trim().toLowerCase() !== held
  useUnsavedContribution(dirty)

  const refresh = () => client.invalidateQueries({ queryKey: brandingKey(accountUuid) })
  const claim = useMutation({
    mutationFn: () => api.claimPortalName(accountUuid, name.trim()),
    onSuccess: async (address) => {
      toast.success(current ? `Address changed to ${address.host}` : `${address.host} is ready`)
      await refresh()
    },
  })
  const release = useMutation({
    mutationFn: (address: PortalAddress) => api.releasePortalAddress(accountUuid, address.uuid),
    onSuccess: async (_, address) => {
      toast.success(`${address.host} removed`)
      setRemoving(null)
      await refresh()
    },
  })

  const allowed = data?.allowances.branding ?? false
  const available = data?.addresses_available ?? false
  const named = Boolean(data?.brand.product_name)
  const suspended = current?.state === "suspended"
  const locked = !allowed || !available || !named || suspended

  return (
    <Panel aria-labelledby="billing-addresses">
      <PanelHeader>
        <PanelTitle id="billing-addresses">Addresses</PanelTitle>
        <PanelDescription>
          Where your people open the portal under your brand. Only people in this billing account's organizations can sign in there.
        </PanelDescription>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        <RequestError error={branding.error} />
        {branding.isPending ? <Skeleton className="h-24 w-full" /> : null}
        {data && !available ? (
          <Alert>
            <LockIcon />
            <AlertTitle>Addresses are not available on this deployment</AlertTitle>
            <AlertDescription>Your brand still shows inside the portal at its usual address.</AlertDescription>
          </Alert>
        ) : null}
        {data && available && !allowed ? (
          <Alert>
            <LockIcon />
            <AlertTitle>Addresses come with branding, which is not part of your plan</AlertTitle>
            <AlertDescription>
              Contact the platform operator to add it.{current ? " The address saved earlier is kept and works again once branding is back." : ""}
            </AlertDescription>
          </Alert>
        ) : null}
        {suspended ? (
          <Alert variant="destructive">
            <LockIcon />
            <AlertTitle>This address is suspended</AlertTitle>
            <AlertDescription>It does not open the portal, and cannot be changed or removed. Contact the platform operator.</AlertDescription>
          </Alert>
        ) : null}
        {data && available && (allowed || current) ? (
          <form
            className="flex max-w-xl flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!locked && dirty && name.trim()) claim.mutate()
            }}
          >
            {current ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <a href={current.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-medium underline underline-offset-4">
                  <span className="truncate">{current.host}</span>
                  <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
                </a>
                <Status value={current.state} domain="portal_address" />
                {current.claimed_at ? (
                  <span className="text-meta text-muted-foreground">
                    Claimed <RelativeTime at={current.claimed_at} />
                  </span>
                ) : null}
              </div>
            ) : null}
            <Field data-invalid={claim.isError} data-disabled={locked}>
              <FieldLabel htmlFor="portal-address-name">{current ? "Change the name" : "Name"}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="portal-address-name"
                  value={name}
                  onChange={(event) => {
                    claim.reset()
                    setName(event.target.value)
                  }}
                  placeholder="acme"
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={40}
                  disabled={locked}
                  aria-invalid={claim.isError}
                  aria-describedby="portal-address-name-help"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{suffix}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription id="portal-address-name-help">
                {!named && allowed
                  ? "Save a product name in Branding first: the address shows it on its sign-in page."
                  : current
                    ? "3 to 40 letters, numbers and hyphens. The old name sends people to the new one for 30 days."
                    : "3 to 40 letters, numbers and hyphens."}
              </FieldDescription>
              {claim.isError ? <FieldError>{nameError(claim.error)}</FieldError> : null}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={locked || !dirty || !name.trim() || claim.isPending}>
                {claim.isPending ? "Saving…" : current ? "Change address" : "Claim address"}
              </Button>
              {current ? (
                <Button type="button" variant="outline" disabled={suspended} onClick={() => setRemoving(current)}>
                  Remove
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
      </PanelContent>
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && !release.isPending && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.host}?</AlertDialogTitle>
            <AlertDialogDescription>
              The portal stops opening there within a minute, and people signed in there are signed out of it. The name is held
              for 30 days, so nobody else can take it and you can claim it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <RequestError error={release.error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={release.isPending}>Keep address</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={release.isPending}
              onClick={(event) => {
                event.preventDefault()
                if (removing) release.mutate(removing)
              }}
            >
              {release.isPending ? "Removing…" : "Remove address"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  )
}
