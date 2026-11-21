# Branding

A billing account's own product name, logo and icon instead of the platform's, and an
organization's own logo ([spec 036](../../specs/036-white-label-custom-domains/spec.md),
[ADR-050](../adr/ADR-050-brands-and-portal-addresses.md)). This page covers what is
built: brands, logos and the allowances that turn them on. Portal addresses, custom
domains, branded mail and the branded installed app are later pull requests of the
same spec.

Code: [`app/Domain/Branding`](../../apps/api/app/Domain/Branding)
([`Brands`](../../apps/api/app/Domain/Branding/Services/Brands.php),
[`BrandImages`](../../apps/api/app/Domain/Branding/Services/BrandImages.php)), the kit's
[`BrandMark`](../../packages/ui/src/components/brand-mark.tsx),
[`ImageField`](../../packages/ui/src/components/image-field.tsx) and
[`BrandEditor`](../../packages/ui/src/components/brand-editor.tsx). Routes and shapes
are in the [branding contract](../../specs/036-white-label-custom-domains/contracts/branding-api.md).

## Who shows what

| Thing | Belongs to | Set by | Needs |
| --- | --- | --- | --- |
| Brand: product name (up to 40 characters), short name (up to 12), support link, logo, dark logo, icon | Billing account | Its owners, or platform staff for them | The `branding` allowance for owners |
| Logo and dark logo | Organization | People with `Organization.update` | Nothing |

A brand is **in effect** only while the account's `branding` allowance is on and it has
a product name. Turning the allowance off keeps the saved brand and takes it out of
effect; turning it back on shows it again.

What the portal shows for an organization (`Brands::forOrganization`, the `brand`
member of the organization in `GET /api/v1/me` and the organization context):

1. the organization's own logo, with its own dark logo or none;
2. else the logo and dark logo of its billing account's brand, while that is in effect;
3. else no logo: the sidebar shows the organization's initial and name, as before.

An organization's own logo is never mixed with its account's dark logo. The logo stays
with the organization when it moves to another billing account. `product_name` is the
brand's while it is in effect and null otherwise; nothing reads it for page titles yet.

## Images

- PNG, JPEG or WebP, told by content, never by name. At most 1 MB. SVG is never
  accepted.
- A logo is at most 2000 × 2000 pixels and is scaled down to fit 480 × 160.
- An icon is square within 2%, at least 512 × 512 and at most 2048 × 2048. It is stored
  as `512`, `192` and `64`, and as `180` and `maskable` on a white background (iOS
  shows transparency as black; a maskable icon must fill its square).
- Every image is decoded and re-encoded as PNG with GD, so metadata and anything that
  is not pixels is dropped. The API images install GD with PNG, JPEG and WebP.
- Refusals answer 422 with `code`: `image_type`, `image_too_large`, `image_not_square`
  or `image_too_small`.
- Files are on the private `local` disk under `branding/<asset uuid>/`. They are served
  only by `GET /api/v1/brand-assets/{asset}/{variant}`, public because a sign-in page
  shows a brand before anyone signs in. `{asset}` is the uuid followed by the first 12
  characters of the content hash, so the response is cached for a year and a changed
  image has a new address.
- A replaced or removed image is still served for a day, for pages already open, then
  `branding:prune-assets` (daily, 04:20 UTC) deletes it and its files. The same run
  removes files whose billing account or organization was deleted.
- Images are uploaded with `POST`: PHP reads a multipart body only on POST.

## Allowances

Three [allowance kinds](billing.md#plans-and-allowances) are switches, 1 for on and 0
for off, never unlimited, and off unless a plan or an override turns them on:

| Kind | Turns on | Used |
| --- | --- | --- |
| `branding` | The account's brand and, later, its portal addresses | Now |
| `custom_domain` | A custom domain for the account | From the custom-domain pull request |
| `hide_powered_by` | Removing the "Powered by" line | From the address pull request |

Owners do not see them in their list of limits; they read them with their branding
(`GET /api/v1/billing-accounts/{account}/branding`, member `allowances`).

## Where people do it

- **Portal → Billing accounts → Branding** (owners): the brand's names and link are a
  draft until **Save**; each image is saved when picked. A preview shows the sign-in
  card and browser tab. A brand changed by someone else answers 409 and the panel
  offers **Reload**. Without the allowance the panel says branding is not part of the
  plan.
- **Portal → Settings → General → Organization logo**: upload, replace or remove the
  logo and the dark logo. Read-only without `Organization.update`.
- **Admin → a billing account's page**: the **Allowances** panel lists the three
  switches and overrides them with a switch instead of a number; the **Branding** panel
  edits the brand for the owners, also while branding is off, to prepare it. The plan
  dialog has the three switches too.

## Activity

`brand.updated` (the changed fields) and `brand.image_changed` on the billing account,
`organization.logo_changed` on the organization. None carries image bytes.

## Settings

`config/branding.php` reads `PORTAL_ADDRESSES`, `PORTAL_ADDRESSES_DNS_CHECK`,
`PORTAL_ADDRESSES_TOKEN` and `PORTAL_ADDRESSES_DOMAIN`. Nothing uses them yet: they
belong to portal addresses. Brands and logos need no setting.
