# Research: White Labeling and Custom Domains

Each entry gives the decision, why, and what was rejected. Code references are to
`main` at `d7d4269c`.

## What the code does today

- The release proxy (`deploy/release/Caddyfile`, Caddy 2.10.2) lists `app.`, `admin.`,
  `api.` and `ops.` under `DOMAIN`. Nothing uses on-demand certificates. The dev stack
  has no proxy: the portal's nginx answers on port 5173 and the API on 8001.
- The portal's nginx (`deploy/docker/portal/nginx.conf`) has `server_name _` and
  serves a static `runtime-config.js` written once at container start by
  `deploy/docker/web/runtime-config.sh`. `apps/portal/index.html` loads it at line 31.
- The API takes every host from the environment: `FRONTEND_URL`, `SESSION_DOMAIN`
  (`.DOMAIN`), `SANCTUM_STATEFUL_DOMAINS`, `CORS_ALLOWED_ORIGINS`, `PASSKEYS_RP_ID`.
  No code reads the request's `Host` or `Origin`, apart from Sanctum's own stateful
  check.
- The release API runs php-fpm behind nginx (`api-web`). Octane (ADR-038) is proposed
  and not installed, so changing configuration during a request is safe today.
- `CompleteSignIn` is "the one place a person's session starts", with two exceptions
  that call the guard directly: `ResumeKeptSignIn` and
  `PublicOrganizationInvitationController`.
- `ResolveOrganizationContext` lets a person into an organization when they are a
  member or a super administrator. `AuthenticatedUserResource` lists a person's
  organizations for the switcher.
- The passkeys table stores no relying party. The package reads the relying party and
  allowed origins from configuration on each call.
- Allowances are integers only (`AllowanceKind`, `billing_plan_allowances.value`,
  `billing_allowance_overrides.value`); there are no on/off allowances.
- About 15 mail builders take the portal's address from `config('app.frontend_url')`.
  Four of them and the sender name hard-code a product name. There is no mail theme;
  notifications use Laravel's stock template.
- The portal has no logo and no loading markup. Its sign-in page is `Login` in
  `apps/portal/src/App.tsx`. Its title, manifest and icons are fixed in the build.
  `packages/ui`'s `PageHeader` builds tab titles from `document.title`.
- Push payloads carry relative paths, so a tap already opens on the origin that
  subscribed. Push devices do not record that origin.
- Uploads exist for support tickets and the assistant: private `local` disk, content
  type checked with `finfo`, served through a route with `nosniff`. Nothing re-encodes
  images, and the API image has no image extension.
- No portal page edits an organization; **Settings → General** holds its time zone.

## R1. Where the brand lives

**Decision**: A `brands` row per billing account (at most one) and logo columns on
`organizations`. Uploaded images are `brand_assets` rows.

**Why**: The billing account is the only record that stands for the Enterprise
(ADR-026), and ADR-050 lets it carry a brand. A separate table keeps `billing_accounts`
about billing, and gives colours a home later.

**Rejected**: Columns on `billing_accounts` (mixes billing with presentation). A brand
that several accounts share (nobody asked, and it blurs who may edit it).

## R2. Images

**Decision**: PNG, JPEG and WebP only, up to 1 MB. Each upload is decoded and
re-encoded with PHP's GD, which is added to both API images. The logo is scaled to fit
480×160 and kept as PNG. The square icon must be at least 512×512 and is stored at
512, 192, 180 and 64 pixels, plus a padded 512 maskable copy. Files go on the private
`local` disk and are served by a public route, named by content hash, with a year-long
cache and `nosniff`.

**Why**: Re-encoding drops anything that is not pixels, which meets FR-007 without a
sanitiser. The sizes are the ones the installed app and notifications already use.
Logos are public by nature, since the sign-in page shows them.

**Rejected**: SVG (needs a sanitiser the project does not have; one mistake is script
on the sign-in page). The `public` disk (its URL is the API's host, and the files
would be listed by path rather than hash). Resizing in the browser (the server cannot
trust it).

## R3. Allowances that are switches

**Decision**: Three new `AllowanceKind` values: `branding`, `custom_domain` and
`hide_powered_by`. They use the existing integer columns with 1 for allowed and 0 for
not. The defaults in `config/billing.php` are 0. `AllowanceKind::isSwitch()` tells the
resolver, the plan editor and `AllowanceOverrideDialog` to show a switch instead of a
number and to reject other values.

**Why**: Plans, overrides, notes, sources and the admin panel all exist for
allowances. A switch is a small variation on them.

**Rejected**: A separate "features" table (a second mechanism for the same question).
Booleans on the brand row set by staff (no plan could carry them).

## R4. How a request finds its address

**Decision**: A `PortalAddresses` service resolves a host to an address, cached for
30 seconds. An `ApplyPortalAddress` middleware runs first in the `api` and `web`
groups and sets the request's address:

- If the request's `Host` is a custom domain, that is the address.
- Otherwise, if the `Origin` (or else `Referer`) host is an address under the
  platform's domain, that is the address.
- Otherwise the request is on the platform's own hosts.

**Why**: A custom domain serves the API on its own host, so `Host` is authoritative
and cannot be forged past the proxy. An address under the platform's domain calls
`api.DOMAIN` across origins, so the browser always sends `Origin`.

**Rejected**: A header the portal sets (anyone can set it). Routing on the
`X-Organization-UUID` header (the API has never trusted it).

## R5. Addresses under the platform's domain

**Decision**: `<name>.DOMAIN` keeps calling `api.DOMAIN`. The release adds
`*.DOMAIN` to Sanctum's stateful list (it accepts wildcards) and a pattern to
`cors.allowed_origins_patterns`. The session cookie on `.DOMAIN` and the passkey
relying party `DOMAIN` already cover the name. The middleware adds the address's
origin to the passkey allowed origins for the request.

One session therefore covers `app.DOMAIN` and every `<name>.DOMAIN`. The host limit
(R8) is applied on each request, not only at sign-in.

**Why**: Sign-in, kept sign-in and passkeys work unchanged, as ADR-050 says. Serving
the API on the same host here too would send the `.DOMAIN` cookies and the host's own
cookies together under the same names.

**Rejected**: Same-host API with renamed cookies (the CSRF cookie's name is fixed in
the framework and in `api-client`). One wildcard certificate (needs a DNS provider
plugin in Caddy; see R7).

## R6. Custom domains

**Decision**: On a custom domain the portal calls the API on its own origin. The
portal's nginx proxies `/api/` and `/sanctum/` to the API for any host that is not the
platform's portal host, and refuses `/api/internal/` and `/internal/`. The middleware
then sets, for that request only:

- `session.domain` to null, so cookies are host-only;
- `sanctum.stateful` to the host;
- the passkey relying party to the host and the allowed origins to its origin.

Admin routes, the agent endpoint and the application sign-in pages answer 404 on a
custom domain. A session started there records the address and is refused anywhere
else; a session from the platform's domain is refused there.

**Why**: Browsers block third-party cookies, so the API must be first-party. Putting
the proxy rules in the portal's nginx, not in Caddy, gives the dev stack (which has no
Caddy) the same behaviour. Per-request configuration is safe on php-fpm.
`KeptSignInCookie` already reads its settings on each call.

**Rejected**: A second API host per customer (`api.portal.example.org`: two records
and two certificates per customer). `SameSite=None` cookies on `api.DOMAIN` (blocked
as third-party in Safari and soon elsewhere).

**Risk**: When ADR-038 lands, Octane resets configuration between requests from the
base repository, which fits this design. The Octane pull request must test it; a note
goes in `docs/dev/gotchas.md`.

## R7. Certificates and the proxy

**Decision**: One new catch-all site in the Caddyfile, used only when the operator
switches portal addresses on (`PORTAL_ADDRESSES=on`). It uses on-demand certificates
with an `ask` endpoint and proxies everything to `portal:80`:

- `ask` calls `GET /api/internal/portal-addresses/ask?domain=…` on `api-web` over the
  private network, with a token in the query. It answers 200 only for an address that
  is active, and 404 otherwise.
- The named sites (`app.`, `admin.`, `api.`, `ops.`) are more specific and still win.
- `manage.py render` writes the site into a generated `addresses.Caddyfile`, empty
  when the switch is off, the same way it writes `legacy.Caddyfile`.

Names under the platform's domain get their certificates the same way, one each.

**Why**: Caddy already terminates TLS and renews certificates. The `ask` gate is what
FR-014 and SC-008 require. No new service is added.

**Rejected**: A wildcard certificate for `*.DOMAIN` (needs a custom Caddy build with a
DNS provider module, and the provider differs per deployment). Rendering one site per
address from `manage.py` (needs a reload on every change, and staff action).

**Limits to document**: The public certificate authority allows about 50 new
certificates a week for names under one registered domain, so a deployment can add
about 50 branded names under its own domain a week. Custom domains are not affected.
A deployment with no route to a public authority leaves the switch off; brands and
logos still work on the platform's own address.

**To verify in the first address pull request**: that Caddy 2.10 keeps an existing
query string when it adds `domain` to the `ask` URL. If it does not, the token moves
into the path.

## R8. Who may use an address

**Decision**: One `PortalAccess` service answers "may this person use this address"
and "which organizations may they reach here":

- On the platform's hosts: as today.
- On an account's address: organizations under that account that the person belongs
  to; for a super administrator, all of that account's organizations. A person with a
  platform role and none of those is admitted and sees none.

It is called from `CompleteSignIn`, `ResumeKeptSignIn`, the invitation controller,
`AuthenticatedUserResource`, `ResolveOrganizationContext` and a small middleware that
ends the session with `403 not_available_here` when the person has no organization
left there. The refusal at sign-in comes after the password and second step (FR-022).

**Why**: One rule in one service, used by every way a session starts or continues.

**Rejected**: Filtering only in the portal (the API would still answer). Checking only
at sign-in (FR-023, and R5's shared session, need it on every request).

## R9. The brand before the portal starts

**Decision**: The portal's nginx sends `/runtime-config.js` to the API for any host
that is not the platform's portal host. `GET /api/v1/portal/runtime-config.js` returns
the same object as today plus `brand` and `address`. For an unknown, suspended or
released host it returns `address: { state: "not_in_use" }` and no brand.

`index.html` becomes brand-neutral: an empty title, and a small inline script right
after `runtime-config.js` that sets the title, the tab icon, the touch icon and a
loading mark (logo and name) inside `#root` before React loads. With no brand it uses
the platform's name and icons, so the platform's address looks as it does now. With
`not_in_use` it shows that message and stops.

**Why**: `runtime-config.js` already loads synchronously before the app, so the brand
is known before anything is drawn (FR-006, SC-004). The service worker already leaves
that file out of its cache. The shell stays one build for every host.

**Rejected**: Fetching the brand from React (the platform's name would show first).
Building a portal image per brand. Rewriting `index.html` in the proxy.

**Note**: The static files of the portal shell are the same on every host and hold no
data, so an address that is not in use still serves them; it shows only the message.
The spec's FR-017 was reworded to say so.

## R10. The installed app and icons

**Decision**: For hosts that are not the platform's portal host, nginx also sends
`/manifest.webmanifest` and the five fixed icon paths (`/pwa-64x64.png`,
`/pwa-192x192.png`, `/pwa-512x512.png`, `/maskable-icon-512x512.png`,
`/apple-touch-icon-180x180.png`) to the API, which answers from the brand, or from the
platform's own files when the brand has no icon.

**Why**: The worker's notification code and the manifest name those paths. Answering
them per host brands the installed app and every notification with no change to the
worker.

**Rejected**: Icon URLs in the push payload (a contract change for something the host
already decides).

## R11. Links and mail

**Decision**: A `PortalLinks` service replaces `config('app.frontend_url')` in every
builder:

- `forOrganization($organization, $path)`: the main address of the organization's
  account (FR-016), skipping an address that is not reachable.
- `forRequest($path)`: the address the request came from, for mail with no
  organization (password reset, sign-up, security notices).
- `platform($path)`: for billing mail and staff mail.

A `MailBrand` value (name, logo URL, support link) comes from the same two paths. The
mail sender's display name is the brand's name; the address stays `mail.from`.
Laravel's mail templates are published once and given a header that shows the logo or
the name. Text-only mailables take the name and links only. Hard-coded product names
in notifications and subjects become the brand's name, which is the platform's name
when there is no brand.

**Why**: One place decides the host and the name, for the organization or for the
request (FR-028 to FR-030).

**Rejected**: Changing `app.frontend_url` per request (queued mail has no request).

## R12. Push

**Decision**: `push_devices` gains a nullable `portal_address_id`, set from the
request when a device registers. The alert fan-out skips a device whose address
belongs to a different account than the alert's organization. `GET me` reports how
many push devices the person has at other addresses, so the portal can say once that
alerts must be turned on again here (FR-032).

**Why**: A tap opens on the origin that subscribed (R10's paths are relative). Without
the filter, a person in two accounts would get a push at one Enterprise's address for
the other's organization, which they cannot open there.

**Rejected**: Sending everywhere and failing on tap.

## R13. Passkeys per domain

**Decision**: `passkeys` gains `relying_party_id`, filled with the deployment's
current value for existing rows. Sign-in options offer only passkeys for the
request's relying party. The security page lists each passkey with its domain, and on
a custom domain says that passkeys from elsewhere do not work here.

**Why**: FR-026 and ADR-050. A passkey is bound to its relying party by the browser;
the column lets the portal say which is which.

**Rejected**: Related-origin requests (not in Firefox; ADR-050).

## R14. Proving a custom domain

**Decision**: The owner adds one record: a CNAME from their name to a target unique to
the claim, `c-<token>.DOMAIN`. The platform checks with `dns_get_record` that the CNAME
is exactly that target. A bare domain cannot hold a CNAME and is refused.

- Checks run every 2 minutes while waiting and every 15 minutes once active.
  **Check now** is limited to once a minute.
- Three failed checks in a row mark an active address not reachable; one good check
  restores it.
- A claim lapses after 7 days without the record. A released name is held for 30 days.

The operator adds one wildcard record, `*.DOMAIN`, which covers both the branded names
and the claim targets.

**Why**: The record both points the name at the deployment and proves that the
claimant, not a previous holder with a stale record, controls it. One record, as the
spec's story 3 says.

**Rejected**: A plain CNAME to a shared target (a stale record from a former customer
could be claimed by another account). CNAME plus TXT (two records for the same proof).
Bare domains through address records (the deployment's address may change).

## R15. Sign-up, invitations, and what stays on the platform's hosts

**Decision**: `SignUpController::show` and `StartSignUpRequest` answer closed on any
address (FR-024). Invitation links come from `PortalLinks::forOrganization`. Admin
routes, agent access, application sign-in and device hosts are untouched; on a custom
domain they are not reachable at all (R6).

## R16. Checking it locally

**Decision**: The dev stack treats `*.localhost` names as custom domains when
`PORTAL_ADDRESSES_DNS_CHECK=off` (dev only), so `acme.localhost:5173` exercises the
same-host path with no proxy and no DNS. Names under the platform's domain are covered
by Pest tests on the resolver, CORS and access rules, and by the release check on a
test deployment with real DNS, before the pilot.

**Why**: Browsers resolve `*.localhost` to the loopback address without a hosts file.
Whether `acme.localhost` and `localhost` count as one site for cookies differs between
browsers, so the cross-origin path is not trusted to a local check.

## R17. Where the organization's logo is edited

**Decision**: **Settings → General** gains a **Logo** panel, shown to people with
`Organization.update` and read-only to others. The billing account's **Branding**
section sits on the portal's billing account page and the admin app's billing account
page.

**Why**: No organization page exists, and General already holds the organization's
time zone. `Organization.update` is what "may change the organization" means in the
permission catalogue.
