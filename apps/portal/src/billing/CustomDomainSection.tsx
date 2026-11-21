import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ApiError, type Branding, type PortalAddress } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { CopyButton } from "@iot-os/ui/components/copy-text"
import { Field, FieldDescription, FieldError, FieldLabel } from "@iot-os/ui/components/field"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Input } from "@iot-os/ui/components/input"
import { Status } from "@iot-os/ui/components/status-mark"
import { formatDay } from "@iot-os/ui/lib/invoices"
import { ExternalLinkIcon, LockIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { errorMessage } from "../components/forms"
import { useUnsavedContribution } from "../lib/unsaved"
import { brandingKey } from "./BrandingPanel"

/** What the API says about a domain or a check, as one sentence. */
function refusal(error: unknown): string {
  if (error instanceof ApiError) {
    const payload = error.payload as { code?: string; message?: string } | null
    if (payload?.code === "checked_recently") return "Checked a moment ago. Try again in a minute."
    if (payload?.message) return payload.message
  }
  return errorMessage(error)
}

/**
 * The billing account's own domain (spec 036 US3): the owner enters a subdomain, adds
 * the DNS record shown, and the portal serves there once the record is found.
 */
export function CustomDomainSection({
  accountUuid,
  branding,
  onRemove,
}: {
  accountUuid: string
  branding: Branding
  onRemove: (address: PortalAddress) => void
}) {
  const client = useQueryClient()
  const domain = branding.addresses.find((address) => address.kind === "domain") ?? null
  const live = domain && domain.state !== "lapsed" ? domain : null
  const allowed = branding.allowances.branding && branding.allowances.custom_domain
  const named = Boolean(branding.brand.product_name)
  const [host, setHost] = useState("")
  useUnsavedContribution(!live && host.trim() !== "")

  const refresh = () => client.invalidateQueries({ queryKey: brandingKey(accountUuid) })
  const claim = useMutation({
    mutationFn: () => api.claimPortalDomain(accountUuid, host.trim()),
    onSuccess: async (address) => {
      toast.success(`Add the DNS record for ${address.host}`)
      setHost("")
      await refresh()
    },
  })
  const check = useMutation({
    mutationFn: (address: PortalAddress) => api.checkPortalAddress(accountUuid, address.uuid),
    onSuccess: async (address) => {
      if (address.state === "active") toast.success(`${address.host} is active`)
      else toast.message("The DNS record was not found yet", { description: "DNS changes can take a while to spread. We keep checking." })
      await refresh()
    },
  })

  return (
    <section aria-labelledby="billing-own-domain" className="flex max-w-xl flex-col gap-4 border-t pt-4">
      <div className="flex flex-col gap-1">
        <h3 id="billing-own-domain" className="text-heading">
          Use your own domain
        </h3>
        <p className="text-meta text-muted-foreground">
          Serve the portal on a subdomain of your own, such as portal.example.org. The certificate is issued and renewed for you.
        </p>
      </div>

      {!allowed && !live ? (
        <Alert>
          <LockIcon />
          <AlertTitle>Your own domain is not part of your plan</AlertTitle>
          <AlertDescription>Contact the platform operator to add it.</AlertDescription>
        </Alert>
      ) : null}
      {!allowed && live ? (
        <Alert>
          <LockIcon />
          <AlertTitle>Your own domain is no longer part of your plan</AlertTitle>
          <AlertDescription>The portal does not open at {live.host} now. The domain is kept and works again once it is back.</AlertDescription>
        </Alert>
      ) : null}

      {live ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={live.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-medium underline underline-offset-4">
              <span className="truncate">{live.host}</span>
              <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
            </a>
            <Status value={live.state} domain="portal_address" />
            {live.main ? <Badge variant="secondary">Main address</Badge> : null}
            {live.last_checked_at ? (
              <span className="text-meta text-muted-foreground">
                Checked <RelativeTime at={live.last_checked_at} />
              </span>
            ) : null}
          </div>

          {live.state === "waiting_dns" ? (
            <p className="text-sm">
              Add this record where you manage DNS for the domain. The portal opens there once we find it
              {live.lapses_at ? `; the request lapses on ${formatDay(live.lapses_at)} if we do not.` : "."}
            </p>
          ) : null}
          {live.state === "unreachable" ? (
            <Alert>
              <TriangleAlertIcon />
              <AlertTitle>
                The DNS record has been missing since {live.unreachable_since ? <RelativeTime at={live.unreachable_since} /> : "the last check"}
              </AlertTitle>
              <AlertDescription>
                The portal still opens at {live.host} for now, and links in emails use your other address. Put the record below back to
                recover.
              </AlertDescription>
            </Alert>
          ) : null}
          {live.state === "suspended" ? (
            <Alert variant="destructive">
              <LockIcon />
              <AlertTitle>This domain is suspended</AlertTitle>
              <AlertDescription>It does not open the portal, and cannot be checked or removed. Contact the platform operator.</AlertDescription>
            </Alert>
          ) : null}

          {live.record ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 rounded-md border bg-muted/40 p-3 text-sm" aria-label="DNS record">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-mono">{live.record.type}</dd>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 font-mono break-all">{live.record.name}</span>
                <CopyButton value={live.record.name} label="record name" />
              </dd>
              <dt className="text-muted-foreground">Value</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 font-mono break-all">{live.record.value}</span>
                <CopyButton value={live.record.value} label="record value" />
              </dd>
            </dl>
          ) : null}

          {check.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {refusal(check.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={live.state === "suspended" || check.isPending} onClick={() => check.mutate(live)}>
              {check.isPending ? "Checking…" : "Check now"}
            </Button>
            <Button type="button" variant="outline" disabled={live.state === "suspended"} onClick={() => onRemove(live)}>
              Remove
            </Button>
          </div>
        </>
      ) : allowed ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (named && host.trim()) claim.mutate()
          }}
        >
          {domain?.state === "lapsed" ? (
            <Alert>
              <TriangleAlertIcon />
              <AlertTitle>The request for {domain.host} lapsed</AlertTitle>
              <AlertDescription>Its DNS record was not found within 7 days. Add the domain again to get a new record.</AlertDescription>
            </Alert>
          ) : null}
          <Field data-invalid={claim.isError} data-disabled={!named}>
            <FieldLabel htmlFor="portal-address-domain">Domain</FieldLabel>
            <Input
              id="portal-address-domain"
              value={host}
              onChange={(event) => {
                claim.reset()
                setHost(event.target.value)
              }}
              placeholder="portal.example.org"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              maxLength={253}
              disabled={!named}
              aria-invalid={claim.isError}
              aria-describedby="portal-address-domain-help"
            />
            <FieldDescription id="portal-address-domain-help">
              {named
                ? "A subdomain you control. A bare domain such as example.org cannot be used. Next you add one DNS record to show it is yours."
                : "Save a product name in Branding first: the domain shows it on its sign-in page."}
            </FieldDescription>
            {claim.isError ? <FieldError>{refusal(claim.error)}</FieldError> : null}
          </Field>
          <div>
            <Button type="submit" disabled={!named || !host.trim() || claim.isPending}>
              {claim.isPending ? "Adding…" : "Add domain"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
