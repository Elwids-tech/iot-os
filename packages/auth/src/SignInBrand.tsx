import { runtimeBrand } from "@iot-os/api-client"
import { BrandMark } from "@iot-os/ui/components/brand-mark"
import type { ReactNode } from "react"

/**
 * The brand of the address a sign-in page is opened on (spec 036): a billing account's
 * logo or name where the platform shows its own mark. `fallback` is what the page shows
 * on the platform's own address, where nothing changes.
 */
export function SignInMark({ fallback = null }: { fallback?: ReactNode }) {
  const brand = runtimeBrand()
  if (!brand) return <>{fallback}</>
  return (
    <BrandMark
      name={brand.product_name}
      logo={brand.logo ? { url: brand.logo } : null}
      logoDark={brand.logo_dark ? { url: brand.logo_dark } : null}
      size="lg"
      showName
    />
  )
}

/**
 * Under a sign-in card on a billing account's address: its support link, and the small
 * line naming the platform unless the account's plan removes it (FR-008). Nothing on
 * the platform's own address.
 */
export function SignInFooter() {
  const brand = runtimeBrand()
  if (!brand || (!brand.support_url && !brand.powered_by)) return null
  return (
    <footer data-slot="sign-in-footer" className="flex w-full max-w-md flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-meta text-muted-foreground">
      {brand.support_url ? (
        <a
          href={brand.support_url}
          target={brand.support_url.startsWith("mailto:") ? undefined : "_blank"}
          rel="noreferrer"
          className="underline underline-offset-4 hover:text-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center"
        >
          Help
        </a>
      ) : (
        <span />
      )}
      {brand.powered_by ? <span>Powered by {brand.powered_by}</span> : null}
    </footer>
  )
}
