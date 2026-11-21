# Implementation Plan: White Labeling and Custom Domains

**Branch**: `spec/036-white-label-custom-domains` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/036-white-label-custom-domains/spec.md`

## Summary

A billing account gets a brand (product name, logo, square icon, support link) and up
to two portal addresses: a name under the deployment's domain and one custom domain.
Each organization gets its own logo. The portal stays one build that runs on any host
and learns its brand from `runtime-config.js`, which the API answers per host before
anything is drawn.

- An address under the platform's domain keeps calling `api.DOMAIN`, so the existing
  session cookie and passkeys work there unchanged.
- A custom domain is proven with one CNAME record, gets its certificate on demand, and
  serves the API on its own host so cookies are first-party.
- On an account's address only that account's people get in and they reach only its
  organizations.
- Mail, links, the installed app and push follow the brand.
- Branding, a custom domain and removing the **Powered by** line are allowances, all
  off by default. The operator switches portal addresses on per deployment.

[ADR-050](../../docs/adr/ADR-050-brands-and-portal-addresses.md) amends ADR-026 (a
billing account now carries presentation), ADR-047 (the manifest follows the host) and
ADR-048 (the passkey relying party follows the domain).

## Technical Context

**Language/Version**: PHP 8.4 with Laravel 13 (API); TypeScript with React 19 (portal,
admin, `packages/api-client`, `packages/auth`, `packages/ui`); nginx configuration for
the portal image; Caddy 2.10 configuration and Python for the release tooling.

**Primary Dependencies**: All existing: Sanctum, Fortify with `laravel/passkeys`,
`spatie/laravel-activitylog`, vite-plugin-pwa. One addition: PHP's bundled GD extension
in both API images, for re-encoding images (R2). No new packages.

**Storage**: PostgreSQL 17. New tables `brands`, `brand_assets` and
`portal_addresses`; new columns on `organizations`, `passkeys` and `push_devices`
([data-model.md](data-model.md)). Image files on the private `local` disk, which the
release already keeps in `${STATE_DIR}/app`. Address lookups are cached for 30 seconds.

**Testing**:

- Pest feature tests on PostgreSQL/TimescaleDB (never SQLite).
- Vitest for `api-client` and the portal's brand bootstrap.
- Playwright: portal `e2e/branding.spec.ts` and `e2e/branded-address.spec.ts`, admin
  `e2e/branding.spec.ts`; the existing portal suite run once more against a
  `*.localhost` address (SC-006).
- `tooling/release/test_release.py` for the rendered proxy file and the new checks.

**Target Platform**: the single-node Docker Compose release and the dev stack, in
current Chrome, Safari, Firefox and Edge, plus the installed portal on iOS and Android.

**Project Type**: web service and web apps in the monorepo, plus release tooling.

**Performance Goals**: The per-host `runtime-config.js` answers in under 50 ms from a
warm cache, since it blocks the first paint. A custom domain serves within 10 minutes
of its record appearing (SC-002). A suspended address shows as not in use within a
minute (FR-017).

**Constraints**:

- A deployment that brands nothing behaves exactly as today (FR-040). The platform's
  own portal host keeps its static `runtime-config.js`.
- No outside services beyond the certificate authority Caddy already uses.
- A deployment with no route to a public authority leaves addresses switched off.
- About 50 new names a week under one deployment's domain (R7).
- The repository is public: fixtures and docs use `example.com`, `example.org` and
  `.test` hosts only.

**Scale/Scope**: Tens of brands and addresses per deployment. Six pull requests.

## Constitution Check

*Checked before research and again after the design. Both pass.*

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. Brands, addresses, access and links are all decided in the Laravel API. The proxy only asks the API whether a host is known. The Go runtime, adapters and broker are untouched. |
| II. Immutable versions | Pass. Nothing versioned changes. A brand is plain editable settings, like an organization's time zone. |
| III. Tenant isolation | Pass, and tightened. A billing account still grants no access: a brand and an address only narrow what a person sees. Membership stays the only way into an organization. Tests prove: a person outside an account gets no session on its address; a member of two accounts reaches only the address's account there; a super administrator on an address reaches only that account's organizations; a session from a custom domain is refused elsewhere and the reverse; one owner cannot read or edit another account's brand or address; an Organization Admin cannot change another organization's logo; an unknown host gets no brand and no certificate. |
| IV. Contracts first | Pass. [contracts/branding-api.md](contracts/branding-api.md) and [contracts/portal-bootstrap.md](contracts/portal-bootstrap.md) are the route contracts. OpenAPI and `packages/api-client` change in the pull request that adds each route. The push body is unchanged (R10, R12). The bootstrap object is read by the portal's inline script and by `api-client`'s `runtime-config.ts`; both test against one fixture. Users are referred to by integer `user_id`. |
| V. AI proposes | Pass. No AI tool edits a brand or an address. The assistant's prompts take the product name from the brand so it does not name the platform on a branded address; it stays off by default. |
| VI. Show uncertainty | Pass. An address shows its real state (waiting for DNS, active, not reachable, suspended, lapsed) with when it last changed and when it was last checked. A failed check is "not reachable since", never "active". The Branding section says when addresses are not available on this deployment. |
| VII. Durable, idempotent messaging | Pass. DNS checks are scheduled, idempotent and bounded (a claim lapses after 7 days). Mail and push stay queued after commit; each job resolves its brand and link when it runs. No new stream or ledger. |
| VIII. One design system | Pass. Branding uses `Panel`, `TextField`, `Field`, `SwitchField` and `Alert`; the address list in the admin app uses `CollectionPage` with `DataTable`; address states come from `statusOf`/`Status` with new kit statuses checked against existing names; times use `RelativeTime`. Two new kit components, `BrandMark` and `ImageField`, each get a story. `check-ui` passes. |
| IX. Verified where it runs | Pass. PostgreSQL CI. Each pull request rebuilds its containers and runs its [quickstart](quickstart.md) steps in the browser pane. Custom domains and certificates are also checked on a test deployment with real DNS before the pilot (R16), since the dev stack has no proxy. |

## Decisions

The full reasoning, with rejected alternatives, is in [research.md](research.md).

| Decision | Chosen | Research |
| --- | --- | --- |
| Where the brand lives | `brands` per billing account; logo columns on `organizations` | R1 |
| Images | PNG, JPEG, WebP up to 1 MB, re-encoded with GD; no SVG | R2 |
| Allowances | Three switch kinds on the existing allowance tables | R3 |
| Finding the address | `Host` for custom domains, `Origin` for names under the platform's domain | R4 |
| Names under the platform's domain | Keep `api.DOMAIN`; wildcard stateful and CORS pattern; one shared session | R5 |
| Custom domains | Same-host API through the portal's nginx; per-request cookie and passkey settings | R6 |
| Certificates | One on-demand catch-all site in Caddy behind an `ask` endpoint and a deployment switch | R7 |
| Who gets in | One `PortalAccess` service, checked at every session start and on every request | R8 |
| Brand before first paint | Per-host `runtime-config.js` from the API; brand-neutral `index.html` | R9 |
| Installed app and icons | Per-host manifest and the five fixed icon paths | R10 |
| Links and mail | `PortalLinks` and `MailBrand`; published mail theme | R11 |
| Push | Devices record their address; fan-out skips other accounts' addresses | R12 |
| Passkeys | `relying_party_id` per passkey | R13 |
| Proving a domain | One CNAME to a claim-specific target; no bare domains | R14 |
| Sign-up | Closed on every address | R15 |
| Local checks | `*.localhost` as custom domains in dev; real DNS on a test deployment | R16 |
| Where logos are edited | **Settings → General** and the billing account pages | R17 |

## Design

### Brand and logos (API, new `Domain/Branding`)

A new domain keeps presentation out of `Billing`, which owns accounts and money, and
`Authentication`, which owns sign-in. It calls both.

- **Models**: `Brand`, `BrandAsset`, `PortalAddress`. `BillingAccount::brand()` and
  `::portalAddresses()`; `Organization::logo()` and `::logoDark()`.
- **`Brands`** service: `for($account)`, `update($account, $values, $actor)`,
  `forOrganization($organization)` (the fallback of FR-004) and `platform()`.
- **`BrandImages`** service: validates with `finfo`, decodes and re-encodes with GD,
  writes the sizes of R2 and returns a `BrandAsset`. Replaced assets are deleted a day
  later by a scheduled prune, so cached pages keep working.
- **Allowances**: `AllowanceKind` gains `Branding`, `CustomDomain` and `HidePoweredBy`
  with `isSwitch()`. `Allowances` and the plan and override requests accept only 0 or
  1 for them.
- **Routes** ([contract](contracts/branding-api.md)):
  - owner: `GET/PUT billing-accounts/{account}/brand`, image upload and delete, found
    through `ownedBillingAccounts()` and answering 404 otherwise, as the other owner
    controllers do;
  - admin: the same under `admin/billing-accounts/{account}`, with
    `can:MANAGE_ORGANIZATIONS`;
  - organization: `PUT/DELETE organizations/{organization}/logo[/dark]` with
    `Organization.update`;
  - public: `GET brand-assets/{asset}/{variant}`.
- **Resources**: `OrganizationResource` gains `logo` and `brand` (the resolved logo
  URLs and product name for the shell). `OwnedBillingAccountResource` and the admin
  one gain `brand`, `addresses` and the three allowances.
- **Activity**: `brand.updated`, `brand.image_changed`, `organization.logo_changed`,
  `portal_address.*` (claimed, activated, unreachable, recovered, suspended, restored,
  released, lapsed), with catalogue labels. Account-level entries are recorded without
  an organization, as billing entries are.

### Addresses and the request (API)

- **`PortalAddresses`** service: `resolve($host)` (cached), `claimName`, `claimDomain`,
  `check`, `suspend`, `restore`, `release`, `mainFor($account)`. A reserved list in
  `config/branding.php` covers `app`, `admin`, `api`, `ops`, `mqtt`, `www`, `docs`,
  `mail` and names starting `c-`.
- **`ApplyPortalAddress`** middleware (R4, R6): first in the `api` and `web` groups.
  It sets the request's address and, on a custom domain, the per-request session,
  stateful and passkey settings. It answers 404 for admin, agent and application
  sign-in routes on a custom domain, and `421 address_not_in_use` for any API call on
  a host that is not an active address or a platform host.
- **`PortalAccess`** service (R8), called from:
  - `CompleteSignIn` (refuses with `403 not_available_here` after credentials, and
    records the address in the session on a custom domain);
  - `ResumeKeptSignIn` and `PublicOrganizationInvitationController`;
  - `AuthenticatedUserResource` (the organization list);
  - `ResolveOrganizationContext` (404 `not_available_here` for an organization outside
    the address's account);
  - `EnsurePortalAccess`, after authentication: ends the session when the person has
    no organization left at this address, or when the session's address does not
    match the request's.
- **Passkeys** (R13): the migration adds and fills `relying_party_id`.
  `PasskeySignInController::options` filters by it. `me/passkeys` returns it.
- **DNS checks** (R14): `CheckPortalAddresses` command, every 2 minutes, picks waiting
  claims and, every 15 minutes, active ones. `POST …/addresses/{address}/check` runs
  one now.
- **Internal**: `GET api/internal/portal-addresses/ask` with the
  `PORTAL_ADDRESSES_TOKEN`, checked with `hash_equals` like the other internal routes.
- **Deployment switch**: `branding.addresses_enabled` (`PORTAL_ADDRESSES`), off by
  default. When off, claims are refused with `409 addresses_unavailable` and the
  resources say so.
- **Sign-up** (R15): closed on any address.

### Bootstrap, manifest and icons (API and portal image)

- `GET api/v1/portal/runtime-config.js`, `GET api/v1/portal/manifest.webmanifest` and
  `GET api/v1/portal/icons/{name}` ([contract](contracts/portal-bootstrap.md)). The
  API gains `PUBLIC_MAP_STYLE_URL` and `DEPLOY_ENVIRONMENT`, which only the web images
  had.
- **`deploy/docker/portal/nginx.conf`** becomes a template. A `map` on `$host`
  compares it with the platform's portal host (from `PUBLIC_PORTAL_URL`). For other
  hosts it proxies to the API, keeping `Host` and the forwarded headers:
  - `/runtime-config.js`, `/manifest.webmanifest` and the five icon paths, rewritten
    to the routes above;
  - `/api/` and `/sanctum/` (custom domains use them), with buffering off for streamed
    responses and the API's upload limit;
  - `/api/internal/` and `/internal/` answer 404.
- `TrustDeploymentProxies` already trusts the private network; the release check adds
  that the forwarded host reaches Laravel.

### Portal (`apps/portal`, `packages/ui`, `packages/auth`, `packages/api-client`)

- **`index.html`**: an empty title and the inline bootstrap of R9. It sets the title,
  icons and a loading mark from `window.__IOT_CONFIG__.brand`, falls back to the last
  brand kept in `localStorage` when the file cannot be fetched, and shows *This
  address is not in use* when told so.
- **`api-client`**: `runtime-config.ts` gains typed `brand` and `address`; an empty
  `VITE_API_URL` means the page's own origin. New methods for the routes above, in
  `src/branding.ts`.
- **`packages/ui`**: `BrandMark` (logo for light or dark appearance, or the name with
  initials) and `ImageField` (pick, preview, replace, remove, with the limits shown).
  `PageHeader` takes the product name from the brand.
- **Sign-in** (`Login` in `App.tsx`, and the pages in `packages/auth`): `BrandMark`
  replaces the chip icon, the heading uses the product name, **Help** opens the
  support link, the **Powered by** line shows unless hidden, and *New here? Start
  free* is absent on an address. A `403 not_available_here` shows *This account cannot
  sign in at this address*.
- **Shell**: the sidebar's organization block shows `organization.brand.logo` through
  `BrandMark`. A link to an organization outside the address's account shows *Not
  available at this address*.
- **Settings → General**: a **Logo** panel (R17).
- **Billing account page**: a **Branding** panel with name, support link, logo, dark
  logo and icon, a preview of the sign-in card, and an **Addresses** panel: the name
  under the platform's domain, **Use your own domain** with the record to add, state,
  **Check now** and **Remove**. Both panels explain themselves when the allowance or
  the deployment switch is off.
- **Security page**: each passkey shows its domain; on a custom domain a notice says
  passkeys from elsewhere do not work here.
- **Push**: a one-time notice when the person has push devices at other addresses and
  none here.
- **Copy**: the four hard-coded product names in the firmware and onboarding pages and
  the one in `AcceptInvitationPage` come from the brand.

### Admin (`apps/admin`)

- **Billing account page**: the allowances panel shows the three switches (through
  `AllowanceOverrideDialog`'s switch mode); a **Branding** panel and an **Addresses**
  panel edit on the owner's behalf, with **Suspend** and **Restore**.
- **Portal addresses** page in the organizations group: `CollectionPage` with
  `DataTable`: **Address**, **Kind**, **Billing account**, **State** (`Status`),
  **Last checked** (`RelativeTime`), with a state filter and search.
- The admin app itself is never branded.

### What leaves the portal (API)

- **`PortalLinks`** and **`MailBrand`** (R11) replace `config('app.frontend_url')` and
  the hard-coded names in the builders the research lists: invitations, welcome,
  password reset, security notices, sign-up mail, alert mail, ticket mail and the
  two-step redirect. Billing mail and staff mail use `platform()`.
- **Mail theme**: `resources/views/vendor/mail` published, with a header that shows
  the brand's logo or name. The alert and ticket text views take the name and links.
- **Push** (R12): `push_devices.portal_address_id`, the fan-out filter, and
  `me.push_devices_elsewhere`.
- **Assistant and firmware text**: the product name comes from `Brands` for the
  organization in scope.

### Release and operations

- **`deploy/release/Caddyfile`** imports a generated `addresses.Caddyfile`.
  `manage.py render` writes the on-demand site and the global `on_demand_tls { ask … }`
  block when `PORTAL_ADDRESSES=on`, and empty files otherwise.
- **`deploy/release/compose.yml`**: `PORTAL_ADDRESSES`, `PORTAL_ADDRESSES_TOKEN`,
  the wildcard stateful domain and CORS pattern, the API's map style and environment
  values, the portal's API upstream, and GD in `Dockerfile.release`.
- **`checks.json` and `manage.py smoke`**: the `ask` endpoint answers 404 for an
  unknown name; with the switch on, a test name serves a certificate and the branded
  bootstrap.
- **Docs**: `docs/ops/release.md` gains the wildcard DNS record, the switch, the
  weekly limit and how to suspend an address; `docs/ops/pilot.md` gets the pilot's
  record through the private inventory only.

### Documentation

- `docs/features/branding.md` (new): brands, logos, addresses, states, who may sign in
  where, what follows the brand, and the routes.
- `docs/features/access.md`: sign-in on an address, passkeys per domain.
- `docs/features/billing.md`: the three allowances.
- `docs/features/portal-on-phones.md`: the installed app's name and icon per address,
  and turning push on again.
- `docs/reference`: the bootstrap object.
- `apps/api/resources/help/branding.md` and `custom-domain.md`: for owners, with the
  DNS record explained. They never name the product.
- `docs/dev/gotchas.md`: per-request configuration and Octane; never build a portal
  link from `config('app.frontend_url')`; `document.title` is set by the bootstrap.
- `docs/dev/local-setup.md`: `*.localhost` addresses in the dev stack.

## Project Structure

### Documentation (this feature)

```text
specs/036-white-label-custom-domains/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── branding-api.md
│   └── portal-bootstrap.md
├── checklists/requirements.md
└── tasks.md                      # /speckit-tasks
```

### Source Code (repository root)

```text
apps/api/
├── app/Domain/Branding/
│   ├── BrandingServiceProvider.php
│   ├── routes/api.php
│   ├── Models/{Brand,BrandAsset,PortalAddress}.php
│   ├── Enums/{PortalAddressKind,PortalAddressState}.php
│   ├── Services/{Brands,BrandImages,PortalAddresses,PortalAccess,PortalLinks,MailBrand,PortalBootstrap}.php
│   ├── Http/Middleware/{ApplyPortalAddress,EnsurePortalAccess}.php
│   ├── Http/Controllers/{OwnedBrandController,PlatformBrandController,OrganizationLogoController,
│   │     OwnedPortalAddressController,PlatformPortalAddressController,BrandAssetController,
│   │     PortalBootstrapController,PortalAddressAskController}.php
│   ├── Http/Requests/*.php, Http/Resources/*.php
│   └── Console/{CheckPortalAddresses,PruneBrandAssets}.php
├── app/Domain/Billing/{Enums/AllowanceKind.php,Services/Allowances.php,Http/...}   # switch kinds
├── app/Domain/Authentication/{Services/CompleteSignIn.php,Http/Middleware/ResumeKeptSignIn.php,
│     Http/Controllers/PasskeySignInController.php,Http/Resources/AuthenticatedUserResource.php}
├── app/Domain/Authorization/Http/Middleware/ResolveOrganizationContext.php
├── app/Domain/Notifications/…                # push device address, fan-out filter
├── app/Domain/{Administration,Automation,Support,SignUp}/…   # PortalLinks and MailBrand
├── bootstrap/app.php, config/{branding,billing,cors}.php
├── database/migrations/2026_11_28_0001xx_*.php
├── resources/views/vendor/mail/**, resources/help/{branding,custom-domain}.md
└── tests/Feature/Branding/*.php
packages/api-client/src/{index.ts,branding.ts,runtime-config.ts}
packages/ui/src/components/{brand-mark,image-field,page-header}.tsx (+ stories)
packages/auth/src/*.tsx
apps/portal/{index.html,vite.config.ts,src/App.tsx,src/settings/Settings.tsx,
             src/billing/{BillingAccountsPage,BrandingPanel,AddressesPanel}.tsx,e2e/*.spec.ts}
apps/admin/src/pages/{BillingAccountPage,PortalAddressesPage}.tsx, src/components/AllowanceOverrideDialog.tsx
deploy/docker/{portal/nginx.conf,portal/Dockerfile,api/Dockerfile,api/Dockerfile.release}
deploy/compose/compose.app.yml
deploy/release/{Caddyfile,compose.yml,checks.json,environment.example}
tooling/release/{manage.py,test_release.py}
docs/{features/branding.md,features/access.md,ops/release.md,dev/gotchas.md,adr/ADR-050-…}
```

**Structure Decision**: The existing monorepo layout. A new `Branding` domain sits
beside `Billing` and `Authentication` and is called by them at the few points listed.

## Delivery

Each pull request is based on `main` and opened after the one it depends on merges.
None is stacked.

1. **Documents**: this folder, ADR-050 and its index row, the status lines of ADR-026,
   ADR-047 and ADR-048, and the roadmap entry.
2. **Brands and logos** (US2, the brand half of US1, the allowances of US6), after 1:
   - **Contents**: `brands`, `brand_assets` and the organization logo columns; GD in
     the API images; `Brands` and `BrandImages`; the three switch allowances and their
     admin dialog; the owner, admin, organization and asset routes; `BrandMark` and
     `ImageField` with stories; the **Branding** panels (name, link, images, preview);
     the **Logo** panel; the logo in the shell; activity entries; OpenAPI and
     `api-client`; `docs/features/branding.md` (first part) and the billing doc.
   - **Verify**: rebuild the API family, `portal` and `admin`; quickstart 1 to 4.
   - **Result on its own**: end customers see their logo, and an Enterprise's logo
     shows inside the portal, on the platform's address.
3. **Addresses under the platform's domain** (the rest of US1, US4), after 2:
   - **Contents**: `portal_addresses` (name kind); `PortalAddresses`,
     `ApplyPortalAddress`, `PortalAccess` and `EnsurePortalAccess`; the bootstrap
     route, the nginx template and the brand-neutral `index.html`; branded sign-in
     pages and the **Powered by** line; the wildcard stateful domain and CORS pattern;
     the passkey origin for the request; sign-up closed on an address; the deployment
     switch, the `ask` route, the generated Caddy file and release checks; the
     **Addresses** panel (name only); the access doc and the release doc.
   - **Verify**: rebuild the API family and `portal`; quickstart 5 to 8 with a
     `*.localhost` address; `test_release.py`; the existing portal suite on that
     address.
4. **Custom domains** (US3), after 3:
   - **Contents**: the domain kind, claim, DNS check command and states; same-host API
     through nginx; per-request session, stateful and passkey settings; the session's
     address; `passkeys.relying_party_id` and the security page; kept sign-in on a
     custom domain; **Use your own domain** in the **Addresses** panel; the owner help
     guides.
   - **Verify**: rebuild the API family and `portal`; quickstart 9 to 12 locally, then
     13 on a test deployment with a real domain and certificate.
5. **Mail, links, the installed app and push** (US5), after 3, alongside 4:
   - **Contents**: `PortalLinks` and `MailBrand` in every builder; the mail theme; the
     per-host manifest and icons; `push_devices.portal_address_id`, the fan-out filter
     and the turn-on-again notice; product names from the brand in the assistant,
     firmware text and portal copy; the phones doc.
   - **Verify**: rebuild the API family and `portal`; quickstart 14 to 17 with the
     local mail catcher and a real push in Chrome.
6. **Staff control** (the rest of US6), after 4:
   - **Contents**: the **Portal addresses** list, **Suspend** and **Restore**, staff
     editing of a brand and addresses, `e2e/branding.spec.ts` in the admin app, and
     the operations notes.
   - **Verify**: rebuild the API family and `admin`; quickstart 18 and 19.

Nothing reaches the pilot without the owner's approval. When it ships:

- `PORTAL_ADDRESSES` stays off until the wildcard DNS record exists and pull request 3
  is live; the three allowances stay off for every account until staff turn them on.
- The first custom domain on the pilot is one the owner controls, checked end to end
  (certificate, sign-in, kept sign-in, a passkey, a push) before any customer's.
- Real iPhone and Android checks of the installed app's name and icon join the open
  phone checks of spec 033.

## Complexity Tracking

No constitution principle is broken. Principle III is narrowed, not widened: an
address limits what a person reaches. ADR-026, ADR-047 and ADR-048 change through
ADR-050.

| Addition | Why it is needed | Simpler alternative rejected because |
| --- | --- | --- |
| Configuration set per request on a custom domain (R6) | Cookies and passkeys must belong to the customer's host | A second API host per customer doubles the DNS records and certificates each customer must manage |
| Proxy rules in the portal's nginx (R6, R9, R10) | The dev stack has no Caddy, and the rules must be the same in both | Rules in Caddy only would leave the feature untestable locally |
