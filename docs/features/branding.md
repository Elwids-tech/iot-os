# Branding

A billing account's own product name, logo and icon instead of the platform's, and an
organization's own logo ([ADR-050](../adr/ADR-050-brands-and-portal-addresses.md);
built from [spec 036](../../specs/036-white-label-custom-domains/spec.md), now frozen).
This page covers brands, logos, the allowances that turn them on, portal addresses
(names under the platform's domain and custom domains), and what follows the brand out
of the portal: mail, links, the installed app and push.

Code: [`app/Domain/Branding`](../../apps/api/app/Domain/Branding)
([`Brands`](../../apps/api/app/Domain/Branding/Services/Brands.php),
[`BrandImages`](../../apps/api/app/Domain/Branding/Services/BrandImages.php),
[`PortalAddresses`](../../apps/api/app/Domain/Branding/Services/PortalAddresses.php),
[`PortalAccess`](../../apps/api/app/Domain/Branding/Services/PortalAccess.php),
[`PortalLinks`](../../apps/api/app/Domain/Branding/Services/PortalLinks.php),
[`MailBrand`](../../apps/api/app/Domain/Branding/Services/MailBrand.php),
[`PortalBootstrap`](../../apps/api/app/Domain/Branding/Services/PortalBootstrap.php)), the kit's
[`BrandMark`](../../packages/ui/src/components/brand-mark.tsx),
[`ImageField`](../../packages/ui/src/components/image-field.tsx) and
[`BrandEditor`](../../packages/ui/src/components/brand-editor.tsx). Routes and shapes
are in the [branding API reference](../reference/branding-api.md).

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
brand's while it is in effect and null otherwise.

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
| `branding` | The account's brand and its portal addresses | In the portal, in mail, on its addresses |
| `custom_domain` | A custom domain for the account. Needs `branding` too | When claiming a domain, and while it serves |
| `hide_powered_by` | Removing the "Powered by" line | On the sign-in pages of its addresses |

Owners do not see them in their list of limits; they read them with their branding
(`GET /api/v1/billing-accounts/{account}/branding`, member `allowances`).

Withdrawing an allowance deletes nothing at first: the brand is kept for as long as the
account exists, and the name and the domain are kept for 30 days and work again the
moment the allowance returns. An address still without its allowance after 30 days is
given up, its owners are mailed, and its host is then held for the account like any
removed address ([what staff see](../ops/release.md#when-an-allowance-is-withdrawn)).

## Portal addresses

A billing account allowed to brand can claim one **name** under the deployment's
domain: `acme` becomes `acme.<domain>`. The portal opened there carries the account's
brand from the first thing drawn, and only that account's people get in. Addresses are
off for a deployment until its operator switches them on
([release guide](../ops/release.md#portal-addresses)); the account's brand still shows
inside the portal at the platform's own address.

- **Claiming.** A name is 3 to 40 letters, numbers and single hyphens. The platform's
  own names (`app`, `admin`, `api`, `ops`, `mqtt`, `www`, `docs`, `mail`) and names
  starting `c-` are reserved. A name serves at once.
- **Renaming** releases the old name, which sends visitors to the new one for 30 days.
- **Removing** stops the address within a minute. A released name is held for 30
  days: nobody else can claim it, and its account can take it back.
- **Suspended** (by platform staff) or **without the allowance**, an address shows
  *This address is not in use* and its owners cannot change it. The name is kept and
  serves again when the allowance returns. Without the allowance the state does not
  change: staff see the address in its own state with `serving` false, and both they
  and the owners see the day it is given up (`releases_at`, 30 days after the scheduled
  check first found the allowance off;
  [`PortalAddresses::sweepAllowances`](../../apps/api/app/Domain/Branding/Services/PortalAddresses.php)).
  An allowance that returns and goes again starts a new 30 days.
- **Restoring** a suspended name serves at once. A restored custom domain is checked
  there and then: it is `active` again, as a new activation, if its record is still in
  place, and `waiting_dns` with a new 7 days if not
  ([`PortalAddresses::restore`](../../apps/api/app/Domain/Branding/Services/PortalAddresses.php)).
- An account's addresses are released when it is deleted or its last organization
  moves away.

### Custom domains

An account with the `custom_domain` allowance (and `branding`) can also serve the
portal on one domain of its own, such as `portal.example.org`
([`PortalAddresses::claimDomain`](../../apps/api/app/Domain/Branding/Services/PortalAddresses.php)).

- **Claiming.** The host must be a subdomain: at least three labels, not an address
  literal and not under the platform's domain (`422 bare_domain`, `host_invalid`,
  `platform_domain`). The claim answers with the DNS record to add: a CNAME from the
  host to `c-<token>.<domain>`, a name only that claim knows. The deployment's wildcard
  record makes that name point at the deployment, so the one record both proves control
  and routes the traffic. An account has one domain at a time
  (`409 domain_exists`); a host another account uses or waits on is `host_taken`.
- **States.**

  | State | Means | Serves |
  | --- | --- | --- |
  | `waiting_dns` | The record has not been found yet. Lapses 7 days after the claim | No |
  | `active` | The record was found. The account's main address | Yes |
  | `unreachable` | Three checks in a row did not find the record. Shows since when | Yes |
  | `suspended` | Stopped by platform staff | No |
  | `lapsed` | The record was never found. Shown until the account asks again | No |

- **Checks.** `branding:check-addresses` runs every two minutes: every waiting domain
  each run, every serving one every 15 minutes. An owner's **Check now** looks at once,
  at most once a minute for each address (`429 checked_recently`). A check only reads
  DNS, through the [`DnsResolver`](../../apps/api/app/Domain/Branding/Contracts/DnsResolver.php)
  contract. One good check brings an unreachable domain back.
- **Main address.** The domain while it is `active`, else the name, else the
  platform's portal address (`PortalAddresses::mainFor`). An unreachable domain keeps
  serving, since its certificate and sessions are still good, but is no longer main.
- **Holding.** A removed domain that had served is held for 30 days against other
  accounts (`host_held`); its own account can ask again at once and gets a new record.
  A request that never found its record, removed or lapsed, holds nothing.
- **A custom domain is its own site.** Browsers send no cookie of the platform's
  domain there, so the portal on a custom domain calls the API on the domain itself:
  the portal's web server proxies `/api/` and `/sanctum/` to the API for every host
  but the platform's own. For such a request the API makes the session and kept
  sign-in cookies host-only and treats only that host as a first-party page. A
  session started there carries the address and its activation, works nowhere else
  (`401`), as does a kept sign-in (`kept_sign_ins.portal_address`), and ends when the domain is removed, suspended or claimed again. The admin
  app, agent connections, application sign-in and payment webhooks answer 404 there.
- **Passkeys belong to the domain they were made on.** On a custom domain the passkey
  relying party is the domain, so a person adds a passkey there to use one there. The
  security page lists where each passkey works. See
  [access](access.md#passkeys).
- **Certificates** are issued by the deployment's proxy on first use, only for a host
  the API says serves ([release guide](../ops/release.md#portal-addresses)). A renamed
  name counts for the 30 days it sends visitors on, since it cannot redirect without
  one.
- **Certificate watch.** The proxy renews a certificate about a month before it
  expires. Each check of a serving domain also asks the proxy, inside the deployment,
  for the certificate it serves under the domain's name
  ([`CertificateReader`](../../apps/api/app/Domain/Branding/Contracts/CertificateReader.php))
  and keeps when it expires. That handshake is also what makes the proxy obtain or
  renew a certificate nobody has visited lately. A read that fails keeps the last
  known date. With 14 days or less left, or once it has expired, the owner sees a
  warning on the domain, staff see **Certificate expiring** beside its state, and the
  release raises `PortalAddressCertificateExpiry`
  ([release guide](../ops/release.md#portal-addresses)). Where there is no proxy to
  ask, as in development, nothing is read.

### What an address shows

The portal is one build for every host. Its page has no name of its own: the first
script it runs is `/runtime-config.js`, and on an address the portal's web server
sends that request to the API (`GET /api/v1/portal/runtime-config.js`), which answers
with the address's brand
([what it answers](../reference/branding-api.md#what-a-host-learns-before-the-portal-starts)).
A small inline script
([`brand-bootstrap.js`](../../apps/portal/src/lib/brand-bootstrap.js)) then names the
tab, sets the tab icon and draws the brand's logo or name while the app loads.

- The sign-in, two-step, forced two-step setup, password reset and invitation pages
  show the brand's logo or name, its support link as **Help**, and a small **Powered by** line naming the
  platform. The `hide_powered_by` allowance removes the line.
- Inside the portal, tab titles end with the brand's product name.
- An address whose brand has no product name yet shows the platform's name. The
  portal asks for the product name before it lets an owner claim a name.
- The installed app is the address's own: its manifest and icons are answered per
  host ([the installed app](#the-installed-app)).
- A brand without an icon keeps the platform's tab icon, touch icon and installed-app
  icons; only its name and logo show. A product name is all a brand needs to take
  effect.
- A host that is not an address that serves gets *This address is not in use*, and
  the app does not start.
- The portal keeps what an address answered in the browser (`iot-runtime-config`) and
  starts from it when the file cannot be fetched, so an address opened offline is not
  mistaken for the platform's. What another host kept is ignored.

### Who gets in

On an account's address ([`PortalAccess`](../../apps/api/app/Domain/Branding/Services/PortalAccess.php)):

- Sign-in succeeds only for people who belong to an organization of that account, and
  for people with a platform role. Anyone else gets *This account cannot sign in at
  this address* (`403 not_available_here`), and only after a right password and
  second step, so the answer tells nobody who has an account.
- The organization list holds only that account's organizations, for members of
  several accounts and for super administrators alike. A link to another account's
  organization answers `404 not_available_here` and the portal says *Not available at
  this address*.
- The rule is checked on every request, so a person who loses their last organization
  under the account is refused on their next one (`403 not_available_here`). On a
  custom domain that request also ends the session, which exists only there. On a name
  the session is the one shared with the platform's address, so it stays and every
  request at the name keeps being refused.
- An invitation is accepted there only into one of the account's organizations.
- Nobody signs up there.

A billing account still grants no access: an address only narrows what a person
reaches. Membership stays the only way into an organization.

### How a request finds its address

[`ApplyPortalAddress`](../../apps/api/app/Domain/Branding/Http/Middleware/ApplyPortalAddress.php)
runs before anything else. A name's portal calls the platform's API host across
origins, so the browser's `Origin` names the address; the session cookie and passkeys
of the platform's domain already cover it. A custom domain's portal calls the API on
the domain itself, so the request's `Host` names the address. The portal's web server
marks every request it passes on for a host that is not the platform's own with
`X-Portal-Address`, so a host the API does not know as a serving address, under the
platform's domain or not, gets `421 address_not_in_use`, which is how a suspended or
removed address stops for pages already open. The lookup is remembered for 30 seconds and cleared on every change. With
addresses off the middleware does nothing.

## What follows the brand

Everything the platform writes for a person about an organization carries the brand of
that organization's billing account, and returns to its **main address**: the custom
domain while that serves, else the name under the platform's domain, else the
platform's portal. With no brand in effect nothing differs from before brands existed.

### Links

[`PortalLinks`](../../apps/api/app/Domain/Branding/Services/PortalLinks.php) is the one
place that decides the host of a link:

| Method | For | Opens on |
| --- | --- | --- |
| `forOrganization` | Alerts, invitations, the welcome, support tickets | The account's main address |
| `forRequest`, or `origin()` then `at()` in queued mail | Password reset, security notices | The address the request came from |
| `platform` | Invoices, payment and usage mail, staff invitations, sign-up | The platform's portal |

Queued mail has no request when a worker builds it. A message that follows the request
keeps `origin()` (the address's host) when it is made and gives it to `at()` when it is
sent; an address that stopped serving in between falls back to the platform's portal.

A link a person copies from a dashboard (**Copy link**, a panel's link, the link in
**Share**) carries the account's main address too, whichever address it was copied at:
the organization's context (`GET organizations/{organization}/context`) answers
`portal_url`, null when the account has no address, and the portal then keeps the
address it is on ([`portal-origin.ts`](../../apps/portal/src/lib/portal-origin.ts)).

Links for AI agents (`Agents\Mcp\PortalUrls`) stay on the platform's portal: agents
connect on the platform's domain.

### Mail

[`MailBrand`](../../apps/api/app/Domain/Branding/Services/MailBrand.php) carries the
product name, a logo and the support link. With a brand:

- the sender's display name is the product name; the sending address stays `MAIL_FROM_ADDRESS`;
- notification mail (invitation, welcome, password reset, security notices) shows the
  logo, or the name, in its header and the support link in its footer, through the
  message templates in `resources/views/mail`;
- the alert and support ticket mails are plain text: their sender and links follow the brand;
- subjects and greetings that named the platform name the product.

The organization's own logo, when it has one, is the header's. Brands are read fresh
for every mail: the worker that sends mail outlives a change to a brand.

Invoices, payment, usage and trial mail keep the platform operator's name and link to
the platform's portal: the operator is the party that bills. So do the platform team's
copy of ticket mail and invitations to administer the platform. Sign-up mail is the
platform's, since sign-up is closed on every address.

Without a brand each mail is byte for byte what Laravel's own templates give
(`BrandedMailTest` compares them).

### Product name in text

`Brands::nameFor($organization)` is the product's name in text written for an
organization: assistant prompts and the comments and README of generated firmware
files. Portal copy takes it from `useProductName()`
([`product-name.ts`](../../apps/portal/src/lib/product-name.ts)), which reads the
organization's brand, then the address's, then `PLATFORM_NAME` in `@iot-os/api-client`,
the one place the web apps spell the platform's name. The portal's lint fails on the
name written anywhere else under `apps/portal/src` or `packages/auth/src`
(`packages/ui/scripts/check-product-name.mjs`).

### The installed app

On an address the portal's web server sends `/manifest.webmanifest` and the five fixed
icon paths (`/pwa-64x64.png`, `/pwa-192x192.png`, `/pwa-512x512.png`,
`/maskable-icon-512x512.png`, `/apple-touch-icon-180x180.png`) to the API
([paths and caching](../reference/branding-api.md#what-a-host-learns-before-the-portal-starts)):

- the manifest is the build's own with `name` and `short_name` from the brand
  (`config/branding.php` keeps a copy of the build's manifest; a test compares it with
  `apps/portal/vite.config.ts`);
- each icon path answers the brand's icon in that size. A brand without an icon gets
  the platform's own file: the API answers `204` with `X-Accel-Redirect`, and the
  web server sends the file from `/platform-files/`, which nothing outside can ask for;
- a host that is not in use gets `404` for both.

Notifications name the same icon paths, so a push on an address shows the brand's icon
with no change to the service worker. The worker does not precache the manifest or
these icons, so a changed brand icon shows without a new release.

### Push

A push device remembers the address it was turned on at
(`push_devices.portal_address_id`; null on the platform's own address). A tap opens on
the address that subscribed, so an alert is pushed only to:

- devices turned on at the platform's own address, which get everything, and
- devices at an address of the alert's organization's billing account.

A person in two accounts therefore gets no push at one account's address for the
other's organization. `GET /api/v1/me` carries `push_devices_elsewhere`: how many
browsers the person has push on in at other addresses. When it is above zero and this
browser has no subscription here, the portal says once per browser that alerts must be
turned on again at this address, with **Turn on alerts**.

## Where people do it

- **Portal → Billing accounts → Branding** (owners): the brand's names and link are a
  draft until **Save**; each image is saved when picked. A preview shows the sign-in
  card and browser tab. A brand changed by someone else answers 409 and the panel
  offers **Reload**. Without the allowance the panel says branding is not part of the
  plan.
- **Portal → Billing accounts → Addresses** (owners): the name, its state, **Change
  address** and **Remove**. The panel says so when addresses are not available on the
  deployment or branding is not part of the plan. **Use your own domain** below it
  takes the host, shows the DNS record with copy buttons, the state, when the request
  lapses or lapsed, **Check now** and **Remove**, and says so when a custom domain is
  not part of the plan, with the day the kept domain is given up.
- **Portal → your user menu → Security**: each passkey shows where it works once a
  person has one from another address, or is on a custom domain.
- **Portal → Settings → General → Organization logo**: upload, replace or remove the
  logo and the dark logo. Read-only without `Organization.update`.
- **Admin → a billing account's page**: the **Allowances** panel lists the three
  switches and overrides them with a switch instead of a number; the **Branding** panel
  edits the brand for the owners, also while branding is off, to prepare it. The plan
  dialog has the three switches too. The **Addresses** panel lists the account's
  addresses with their state and has **Suspend** and **Restore**, and for the owners
  **Claim name**, **Add domain**, **Change name**, **DNS record**, **Check now** and
  **Remove** ([how to](../ops/release.md#changing-an-accounts-addresses-for-its-owners)).
- **Admin → Portal addresses**: every account's addresses (`GET admin/portal-addresses`)
  with the kind, billing account, state and when a custom domain was last checked, a
  **State** filter, a search by address or billing account, and **Suspend** and
  **Restore** ([how to](../ops/release.md#suspending-an-address)). An address whose
  state serves while its account's allowance is off shows **Allowance off** and the day
  it is given up; a lapsed request shows when it lapsed.

## Activity

`brand.updated` (the changed fields) and `brand.image_changed` on the billing account,
`organization.logo_changed` on the organization. None carries image bytes.
`portal_address.claimed`, `.released`, `.suspended` and `.restored` on the billing
account carry the host. A custom domain's checks add `.activated`, `.unreachable`,
`.recovered` and `.lapsed`, recorded with no actor. So is `.released` with the reason
`allowance_withdrawn`, 30 days after an allowance went.

## Mail to owners

The account's owners are mailed when a domain request lapses, when a serving domain's
DNS record goes missing (with the record to put back), and when an address is given up
after 30 days without its allowance
([`PortalAddressMail`](../../apps/api/app/Domain/Branding/Mail/PortalAddressMail.php)).
It is plain text and sent as the platform, like billing mail, once for each time it
happens: the billing notice ledger is keyed by the address and the moment. An owner
without a verified address gets none.

## Settings

Brands and logos need no setting. Portal addresses read, in `config/branding.php`:

| Setting | Meaning |
| --- | --- |
| `PORTAL_ADDRESSES` | `on` serves addresses. Off by default |
| `PORTAL_ADDRESSES_DOMAIN` | The domain names are claimed under: the release's `DOMAIN`, `localhost` in development |
| `PORTAL_ADDRESSES_TOKEN` | What the proxy sends when it asks whether a host may have a certificate |
| `PORTAL_ADDRESSES_DNS_CHECK` | `off` only in development: every custom domain's record counts as found, and a deeper name under the platform's domain (`portal.acme.localhost`) may stand in for a customer's domain |
| `PORTAL_ADDRESSES_CERTIFICATE_PROBE` | The proxy to read custom domains' certificates from, as `host:port`: `caddy:443` in a release. Empty reads nothing |
| `PORTAL_ADDRESSES_SAME_ORIGIN` | Development only: a name's portal calls the API on its own host ([local setup](../dev/local-setup.md#portal-addresses)) |
| `PLATFORM_NAME` | The name in the **Powered by** line. `IoT OS` by default |

The portal image reads `PORTAL_ADDRESSES`, `PORTAL_ADDRESSES_DOMAIN` and
`API_UPSTREAM` to decide which hosts are addresses and where their requests go.

## Where the build differs from the spec folder

The spec folder is history and is not corrected. Where it and this page disagree, this
page and the code are right:

- The 30 days of an address without its allowance start when the scheduled check
  first finds the allowance off, up to two minutes after it went, not at the change
  itself. An address whose allowance was already off when this was built starts its 30
  days at the first check after the upgrade.
- Owners are told of a lapsed request and an unreachable domain by mail only. There is
  no notification inside the portal beyond what the billing page shows.
- Mail templates are in `resources/views/mail`, not `views/vendor`, which neither git
  nor the image build includes. Tests are under `tests/Feature/Domain/Branding`. There
  is no service provider. Images are uploaded with `POST`. Sign-up mail carries the
  platform's name.
