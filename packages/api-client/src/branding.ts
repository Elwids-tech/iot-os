/**
 * Brands and logos (spec 036, ADR-050). A billing account's brand shows instead of the
 * platform's name while its `branding` allowance is on and it has a product name. An
 * organization shows its own logo, else its account's brand logo.
 */

/** A stored image: where it is and its size in pixels. */
export type BrandImage = { url: string; width: number; height: number }

/** Which image of a brand. */
export type BrandImageRole = "logo" | "logo_dark" | "icon"

/** Which logo of an organization. */
export type OrganizationLogoRole = "logo" | "logo_dark"

/**
 * What the portal shows for an organization: its own logo, else its billing account's
 * brand while that is in effect. A null `product_name` means the platform's name; a null
 * `logo` means the organization's name is shown.
 */
export type ResolvedBrand = {
  product_name: string | null
  logo: BrandImage | null
  logo_dark: BrandImage | null
}

/** An organization's logos after a change: the same members the organization carries. */
export type OrganizationLogos = {
  uuid: string
  logo: BrandImage | null
  logo_dark: BrandImage | null
  brand: ResolvedBrand
}

/**
 * A billing account's brand. Before anything is saved it is empty at `revision` 0.
 * `in_effect` is false while the plan has no branding or the brand has no product name.
 */
export type Brand = {
  product_name: string | null
  short_name: string | null
  support_url: string | null
  logo: BrandImage | null
  logo_dark: BrandImage | null
  icon: BrandImage | null
  in_effect: boolean
  revision: number
}

/** The three are saved together with the `revision` that was read; a brand changed since answers 409 `brand_changed`. */
export type BrandValues = {
  product_name: string | null
  short_name: string | null
  support_url: string | null
  revision: number
}

/** A portal address of a billing account. None exist until addresses are available. */
export type PortalAddress = {
  uuid: string
  kind: "name" | "domain"
  host: string
  state: "waiting_dns" | "active" | "unreachable" | "suspended" | "lapsed"
  main: boolean
}

/** Everything the branding pages read for one billing account. */
export type Branding = {
  brand: Brand
  addresses: PortalAddress[]
  allowances: { branding: boolean; custom_domain: boolean; hide_powered_by: boolean }
  /** Whether this deployment serves portal addresses at all. */
  addresses_available: boolean
  /** What follows a claimed name, such as `.example.com`. */
  name_suffix: string | null
  limits: { image_bytes: number; types: string[]; icon_min: number }
}

/** Why an image was refused (422): the `code` of the error body. */
export type BrandImageRefusal = "image_type" | "image_too_large" | "image_not_square" | "image_too_small"

/**
 * The image rules the API applies by default. A billing account's `Branding.limits` is
 * the source of truth; this is for forms that have no branding to read, such as an
 * organization's logo.
 */
export const defaultBrandImageLimits = { image_bytes: 1048576, types: ["image/png", "image/jpeg", "image/webp"], icon_min: 512 }
