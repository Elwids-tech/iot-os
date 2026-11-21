---

description: "Tasks for spec 036, white labeling and custom domains"
---

# Tasks: White Labeling and Custom Domains

**Input**: Design documents from `/specs/036-white-label-custom-domains/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/branding-api.md](contracts/branding-api.md),
[contracts/portal-bootstrap.md](contracts/portal-bootstrap.md),
[quickstart.md](quickstart.md)

**Tests**: included, because the constitution requires them:

- isolation tests for tenant data and for who may use an address (III);
- the OpenAPI drift check and the bootstrap fixture shared by its two readers (IV);
- verification in the rebuilt stack, and on a test deployment for certificates (IX).

API tests run on PostgreSQL only. In a worktree, follow the worktree API test recipe:
copy `vendor`, run `composer install`, and use a throwaway `APP_KEY`.

**Organization**: phases follow the six pull requests in the plan's **Delivery**
section. Each pull request is based on `main`, opened after the one it depends on
merges, and never stacked. Story labels map tasks to the spec's user stories (US1 to
US6).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task).
- **[Story]**: US1 to US6 from [spec.md](spec.md).
- Paths are from the repository root.
- Every verification task takes the stack rebuild lock (`.local/stack-rebuild.lock`)
  before any `docker compose` build and removes it afterwards.
- Fixtures and docs use `example.com`, `example.org`, `.test` and `.localhost` hosts
  only.

---

## Phase 1: Documents (pull request 1)

**Purpose**: merge the spec, plan, tasks and ADR before any code. Merging accepts the
plan.

- [x] T001 Write the spec, research, data model, contracts, quickstart, checklist, plan and tasks in specs/036-white-label-custom-domains/
- [x] T002 [P] Add docs/adr/ADR-050-brands-and-portal-addresses.md, its row in docs/adr/README.md, and the status lines of docs/adr/ADR-026-billing-accounts.md, docs/adr/ADR-047-progressive-web-app-before-native-apps.md and docs/adr/ADR-048-two-step-sign-in-and-passkeys.md
- [x] T003 [P] Add the **White labeling and custom domains** entry under **Control plane** in docs/roadmap.md

**Checkpoint**: pull request 1 merged.

---

## Phase 2: Foundations (pull request 2)

**Purpose**: the tables, image handling and allowances every story needs.

- [x] T004 Add PHP's GD extension with PNG, JPEG and WebP support to deploy/docker/api/Dockerfile (the runtime stage; Composer needs no GD) and deploy/docker/api/Dockerfile.release, and to the API job's PHP extensions in .github/workflows/ci.yml, and assert `gd_info()` reports all three in a Pest test apps/api/tests/Feature/Domain/Branding/ImageSupportTest.php
- [x] T005 Create migration apps/api/database/migrations/2026_11_28_000100_create_brand_assets_table.php: `uuid`, `billing_account_id` FK nullable cascadeOnDelete, `organization_id` FK nullable cascadeOnDelete, a check that exactly one of the two is set, `role` string(16) `logo`|`logo_dark`|`icon`, `content_hash` char(64), `variants` jsonb, `uploaded_by` FK users nullOnDelete, `replaced_at` timestamptz nullable (indexed), timestamps
- [x] T006 Create migration apps/api/database/migrations/2026_11_28_000200_create_brands_table.php: `uuid`, `billing_account_id` FK unique cascadeOnDelete, `product_name` string(40) nullable, `short_name` string(12) nullable, `support_url` string(2048) nullable, `logo_asset_id`/`logo_dark_asset_id`/`icon_asset_id` FKs to brand_assets nullOnDelete, `revision` integer default 1, `updated_by` FK users nullOnDelete, timestamps
- [x] T007 [P] Create migration apps/api/database/migrations/2026_11_28_000300_add_logos_to_organizations.php: `logo_asset_id` and `logo_dark_asset_id` FKs to brand_assets nullOnDelete
- [x] T008 Create the `Branding` domain skeleton (no service provider until something needs one; pull request 3 adds it with the address middleware): routes/api.php required from apps/api/routes/api.php, apps/api/config/branding.php (`addresses_enabled` from `PORTAL_ADDRESSES` default off, `dns_check` from `PORTAL_ADDRESSES_DNS_CHECK` default on, `ask_token` from `PORTAL_ADDRESSES_TOKEN`, `domain` from the deployment domain, the reserved names `app`, `admin`, `api`, `ops`, `mqtt`, `www`, `docs`, `mail` and the `c-` prefix, image limits 1048576 bytes and icon minimum 512), and models Models/Brand.php and Models/BrandAsset.php with `BillingAccount::brand()`, `Organization::logo()` and `Organization::logoDark()`
- [x] T009 Add `Branding`, `CustomDomain` and `HidePoweredBy` (`branding`, `custom_domain`, `hide_powered_by`) to apps/api/app/Domain/Billing/Enums/AllowanceKind.php with `isSwitch()`; default them to 0 in apps/api/config/billing.php; make apps/api/app/Domain/Billing/Services/Allowances.php, the plan allowance request and OverrideAllowanceRequest accept only 0 or 1 for switch kinds and never "unlimited"
- [x] T010 [P] Pest tests apps/api/tests/Feature/Domain/Branding/SwitchAllowancesTest.php: defaults are off; a plan value and an override each turn one on with the right `source`; 2, a negative number and null are refused for switch kinds; existing integer kinds are unchanged
- [x] T011 Implement apps/api/app/Domain/Branding/Services/BrandImages.php (research R2): accept PNG, JPEG or WebP by `finfo` content, at most 1 MB; refuse with `image_type`, `image_too_large`, `image_not_square` (icon not square within 2%), `image_too_small` (icon under 512×512); refuse a logo over 2000×2000; decode and re-encode with GD; store a logo scaled to fit 480×160 as PNG under variant `logo`; store an icon as `512`, `192`, `180`, `64` and a padded `maskable`; write to the private `local` disk; set `content_hash` to the SHA-256 of the re-encoded original; mark the replaced asset's `replaced_at`
- [x] T012 [P] Pest tests apps/api/tests/Feature/Domain/Branding/BrandImagesTest.php for every refusal of T011, that an SVG and an HTML file renamed `.png` are refused, that metadata chunks do not survive re-encoding, and the stored sizes
- [x] T013 Implement `GET /api/v1/brand-assets/{asset}/{variant}` in apps/api/app/Domain/Branding/Http/Controllers/BrandAssetController.php: `{asset}` is the uuid followed by the first 12 characters of the content hash; `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`; 404 when unknown, pruned or the hash part does not match
- [x] T014 [P] Add apps/api/app/Domain/Branding/Console/PruneBrandAssets.php (`branding:prune-assets`, daily at 04:20 UTC in the schedule): delete assets and files whose `replaced_at` is older than a day

**Checkpoint**: migrations run on PostgreSQL; an image can be stored and fetched.

---

## Phase 3: User Story 2 - An end customer sees its own logo (P1) 🎯 MVP (pull request 2)

**Goal**: An Organization Admin uploads the organization's logo and every member sees it
in the navigation, with the fallback of FR-004.

**Independent Test**: quickstart steps 3 and 4.

- [x] T015 [P] [US2] Pest tests apps/api/tests/Feature/Domain/Branding/OrganizationLogoTest.php: upload, replace and delete with `Organization.update`; 403 without it; an admin of one organization cannot change another's logo; a non-member gets 403; the resource's `brand` resolves own logo, then the account's brand logo only when the brand is in effect, then null
- [x] T016 [US2] Implement apps/api/app/Domain/Branding/Services/Brands.php: `for($account)`, `forOrganization($organization)` (FR-004) and `platform()`; a brand is in effect only while the account's `branding` allowance is 1 and `product_name` is set
- [x] T017 [US2] Implement `POST`/`DELETE organizations/{organization}/logo` and `…/logo/dark` (POST: PHP reads a multipart body only on POST) in apps/api/app/Domain/Branding/Http/Controllers/OrganizationLogoController.php behind `ResolveOrganizationContext` and `Organization.update`, recording `organization.logo_changed` through `ActivityLog::record`
- [x] T018 [US2] Add `logo`, `logo_dark` and the resolved `brand { product_name, logo, logo_dark }` to apps/api/app/Domain/Shared/Http/Resources/OrganizationResource.php, eager-loaded where organizations are listed
- [x] T019 [P] [US2] Add `BrandMark` in packages/ui/src/components/brand-mark.tsx (logo for light or dark appearance, else the name with initials) and `ImageField` in packages/ui/src/components/image-field.tsx (pick, preview, replace, remove, limits shown, refusal reason shown), each with a story in apps/storybook
- [x] T020 [P] [US2] Add the logo and brand types and `setOrganizationLogo`/`removeOrganizationLogo` to packages/api-client/src/branding.ts, exported from packages/api-client/src/index.ts, and update the OpenAPI description
- [x] T021 [US2] Add a **Logo** panel to `GeneralSettings` in apps/portal/src/settings/Settings.tsx: editable with `capabilities.manage_administration`, read-only otherwise
- [x] T022 [US2] Show `organization.brand` through `BrandMark` in the sidebar's organization block in apps/portal/src/App.tsx, changing with the organization switcher

**Checkpoint**: quickstart 3 and 4 pass on the platform's address.

---

## Phase 4: User Story 1 (brand) and User Story 6 (allowances) (pull request 2)

**Goal**: An owner sets the account's brand once staff allow it.

**Independent Test**: quickstart steps 1 and 2.

- [x] T023 [P] [US1] Pest tests apps/api/tests/Feature/Domain/Branding/BrandTest.php: an owner reads and edits their account's brand; another account answers 404; `403 branding_not_allowed` while the allowance is off; 409 on a stale `revision`; `product_name` over 40 and `short_name` over 12 characters are refused; `support_url` accepts only `https:` and `mailto:`; staff can edit any account's brand without the allowance; withdrawing the allowance keeps the row and takes the brand out of effect
- [x] T024 [US1] Implement `Brands::update($account, $values, $actor)` with the revision check and `brand.updated`/`brand.image_changed` activity entries, and labels for them and `organization.logo_changed` in apps/api/app/Domain/Audit/Services/ActivityCatalogue.php
- [x] T025 [US1] Implement apps/api/app/Domain/Branding/Http/Controllers/OwnedBrandController.php (`GET billing-accounts/{account}/branding`, `PUT …/brand`, `POST`/`DELETE …/brand/images/{role}`) found through `ownedBillingAccounts()` with 404 otherwise, and PlatformBrandController.php for the same under `admin/` with `can:PlatformAdministration.manage-organizations`; the branding shape of contracts/branding-api.md with `addresses: []` and `addresses_available` from config
- [x] T026 [P] [US1] Add `branding`, `updateBrand`, `setBrandImage`, `removeBrandImage` and their admin twins to packages/api-client/src/branding.ts and the OpenAPI description
- [x] T027 [US1] Add apps/portal/src/billing/BrandingPanel.tsx to apps/portal/src/billing/BillingAccountsPage.tsx: product name, short name, support link, logo, dark logo and icon with `ImageField`, a preview of the sign-in card with `BrandMark`, a discard guard, the 409 conflict message, and the "not part of your plan" state
- [x] T028 [US6] Give apps/admin/src/components/AllowanceOverrideDialog.tsx a switch mode for switch kinds and show the three kinds with their source in the allowances panel of apps/admin/src/pages/BillingAccountPage.tsx; add a **Branding** panel there that edits on the owner's behalf
- [x] T029 [P] [US1] Playwright apps/portal/e2e/branding.spec.ts: the panel is locked without the allowance; set a brand; upload refusals show their reason; an organization logo shows and falls back
- [x] T030 [P] [US1] Write docs/features/branding.md (brands, logos, fallback, image rules, allowances, routes) and add the three allowances to docs/features/billing.md
- [ ] T031 [US1] Verify pull request 2: rebuild the API family, `portal` and `admin`; run quickstart 1 to 4 in the browser pane; `pnpm --filter @iot-os/portal lint` and the admin one pass

**Checkpoint**: pull request 2 merged. Logos work inside the portal on the platform's address.

---

## Phase 5: User Story 1 (address) and User Story 4 (pull request 3)

**Goal**: An account's portal answers on a name under the platform's domain, branded from
the first frame, and only that account's people use it.

**Independent Test**: quickstart steps 5 to 8.

- [ ] T032 Create migration apps/api/database/migrations/2026_11_30_000100_create_portal_addresses_table.php with the columns of data-model.md (`uuid`, `billing_account_id` FK nullable, `kind` string(16) `name`|`domain`, `host` string(253) unique, `state` string(16) `waiting_dns`|`active`|`unreachable`|`suspended`|`lapsed`|`released`, `claim_token` string(32) nullable, `claimed_by`/`suspended_by` FKs users nullOnDelete, `claimed_at`, `activated_at`, `last_checked_at`, `last_reachable_at`, `failed_checks` smallint default 0, `unreachable_since`, `suspended_at`, `released_at`, `redirect_to_id` FK self nullable) and a partial unique index on `(billing_account_id, kind)` where `state` is not `released` or `lapsed`
- [ ] T033 Add Models/PortalAddress.php, Enums/PortalAddressKind.php and Enums/PortalAddressState.php in apps/api/app/Domain/Branding/ with `serves()` (active or unreachable, and the account's allowance on) and `BillingAccount::portalAddresses()`
- [ ] T034 [P] [US1] Pest tests apps/api/tests/Feature/Domain/Branding/PortalAddressNameTest.php: claim and rename a name; `name_taken`, `name_reserved`, labels under 3 or over 40 characters and invalid hostname labels are refused; one live name per account; `409 addresses_unavailable` when the deployment switch is off; a renamed name redirects for 30 days; a released host is held for 30 days; another account's owner gets 404
- [ ] T035 [P] [US4] Pest tests apps/api/tests/Feature/Domain/Branding/PortalAccessTest.php with accounts A and B and people in one, the other and both: on A's address a member of A signs in; a member of both lists only A's organizations in `GET me` and gets `404 not_available_here` for B's; a member of B only gets `403 not_available_here` after a correct password and second step and the unchanged answer after a wrong password; a super administrator reaches only A's organizations; removing the last membership ends the session on the next request; sign-up answers closed; on the platform's hosts every answer is as on `main`
- [ ] T036 Implement apps/api/app/Domain/Branding/Services/PortalAddresses.php: `resolve($host)` cached for 30 seconds and cleared on every change, `claimName`, `suspend`, `restore`, `release`, `mainFor($account)` (FR-016); release an account's addresses when the account is deleted or its last organization leaves; with `portal_address.*` activity entries and catalogue labels
- [ ] T037 Implement apps/api/app/Domain/Branding/Http/Middleware/ApplyPortalAddress.php (research R4) and register it first in the `api` and `web` groups in apps/api/bootstrap/app.php: resolve the address from `Host`, else from the `Origin` or `Referer` host; add the address's origin to the passkey allowed origins for the request; answer `421 address_not_in_use` for API calls on a host that is neither a platform host nor an address that serves
- [ ] T038 [US4] Implement apps/api/app/Domain/Branding/Services/PortalAccess.php (research R8) and call it from apps/api/app/Domain/Authentication/Services/CompleteSignIn.php, Http/Middleware/ResumeKeptSignIn.php, apps/api/app/Domain/Administration/Http/Controllers/PublicOrganizationInvitationController.php, apps/api/app/Domain/Authentication/Http/Resources/AuthenticatedUserResource.php (organization list and `address { kind, host }`) and apps/api/app/Domain/Authorization/Http/Middleware/ResolveOrganizationContext.php
- [ ] T039 [US4] Add apps/api/app/Domain/Branding/Http/Middleware/EnsurePortalAccess.php after authentication in apps/api/bootstrap/app.php: end the session with `403 not_available_here` when the person has no organization left at the address and no platform role
- [ ] T040 [US4] Answer closed on any address in apps/api/app/Domain/SignUp/Http/Controllers/SignUpController.php `show` and apps/api/app/Domain/SignUp/Http/Requests/StartSignUpRequest.php
- [ ] T041 [US1] Implement apps/api/app/Domain/Branding/Services/PortalBootstrap.php and Http/Controllers/PortalBootstrapController.php for `GET /api/v1/portal/runtime-config.js` per contracts/portal-bootstrap.md (JSON encoded with `JSON_HEX_TAG`, `no-store`, `not_in_use` for a host that does not serve), reading `PUBLIC_MAP_STYLE_URL` and `DEPLOY_ENVIRONMENT` added to the API's environment in deploy/compose/compose.app.yml and deploy/release/compose.yml
- [ ] T042 [P] [US1] Pest tests apps/api/tests/Feature/Domain/Branding/PortalBootstrapTest.php: a name address returns the brand, the platform API URL and no admin URL; `powered_by` is null only with `hide_powered_by`; unknown, suspended and released hosts and an account without the allowance return `not_in_use` and no brand; a product name containing `</script>` cannot close the script
- [ ] T043 [US1] Turn deploy/docker/portal/nginx.conf into a template rendered at start (deploy/docker/portal/Dockerfile, deploy/docker/web/runtime-config.sh): a `map` on `$host` against the host of `PUBLIC_PORTAL_URL`; for other hosts proxy `/runtime-config.js` to the API route keeping `Host` and the forwarded headers; the platform's host keeps its static file; add the API upstream variable to both compose files
- [ ] T044 [US1] Make apps/portal/index.html brand-neutral (research R9): empty title, `runtime-config.js` loaded in the head, and an inline bootstrap that sets the title, tab icon, touch icon and a loading mark in `#root` from `window.__IOT_CONFIG__.brand`, falls back to the brand last kept in `localStorage`, uses the platform's name and icons when there is no brand, and shows *This address is not in use* and stops for `not_in_use`
- [ ] T045 [P] [US1] Add typed `brand` and `address` to packages/api-client/src/runtime-config.ts, treat an empty `VITE_API_URL` as the page's origin in apps/portal/src/lib/api.ts, add the fixture apps/portal/src/lib/__fixtures__/runtime-config.branded.js, and Vitest cases for both readers against it
- [ ] T046 [US1] Brand the sign-in pages: `BrandMark`, product name, support link and the **Powered by** line in `Login` in apps/portal/src/App.tsx and the pages of packages/auth/src (TwoStepChallenge, PasswordRecoveryPage, AcceptInvitationPage); hide *New here? Start free* on an address; show *This account cannot sign in at this address* for `403 not_available_here`; take `PageHeader`'s product name from the brand in packages/ui/src/components/page-header.tsx
- [ ] T047 [US4] Show *Not available at this address* for an organization link that answers `404 not_available_here` in apps/portal/src/App.tsx
- [ ] T048 [US1] Add `PUT billing-accounts/{account}/addresses/name` and `DELETE …/addresses/{address}` to apps/api/app/Domain/Branding/Http/Controllers/OwnedPortalAddressController.php (and the admin twins), the `addresses`, `name_suffix` and `main` parts of the branding shape, `api-client` methods and OpenAPI, and apps/portal/src/billing/AddressesPanel.tsx with the name field, state through `Status`, and the "not available on this deployment" state
- [ ] T049 [US1] Add `*.DOMAIN` to `SANCTUM_STATEFUL_DOMAINS` and a matching entry to `cors.allowed_origins_patterns` (apps/api/config/cors.php from a new `CORS_ALLOWED_ORIGIN_PATTERNS`) in deploy/release/compose.yml, only when `PORTAL_ADDRESSES=on`
- [ ] T050 [US1] Implement `GET /api/internal/portal-addresses/ask` in apps/api/app/Domain/Branding/Http/Controllers/PortalAddressAskController.php (token checked with `hash_equals`, at least 32 characters; 200 only for an address that serves) with Pest tests for an unknown host, a suspended host, a waiting domain and a bad token
- [ ] T051 [US1] Make tooling/release/manage.py `render` write `addresses.Caddyfile` (the on-demand catch-all site proxying to `portal:80`) and the global `on_demand_tls { ask … }` block when `PORTAL_ADDRESSES=on`, empty otherwise; import both from deploy/release/Caddyfile; mount the file in deploy/release/compose.yml; add `PORTAL_ADDRESSES` and `PORTAL_ADDRESSES_TOKEN` to deploy/release/environment.example; cover both states in tooling/release/test_release.py; confirm how Caddy 2.10 passes an existing query string to `ask` and move the token into the path if it is dropped (research R7)
- [ ] T052 [P] [US1] Add to deploy/release/checks.json and `smoke` in tooling/release/manage.py: the `ask` route answers 404 for an unknown name; with the switch on, the forwarded host reaches Laravel
- [ ] T053 [P] [US4] Playwright apps/portal/e2e/branded-address.spec.ts on an `acme.localhost` address: branded first paint with no platform name outside **Powered by**; the three sign-in outcomes of quickstart 7; no sign-up link
- [ ] T054 [P] [US1] Docs: addresses and who may sign in where in docs/features/branding.md and docs/features/access.md; the wildcard DNS record, the switch, the weekly certificate limit in docs/ops/release.md; `*.localhost` addresses in docs/dev/local-setup.md; "never build a portal link from `config('app.frontend_url')`" and "`document.title` is set by the bootstrap" in docs/dev/gotchas.md
- [ ] T055 [US1] Verify pull request 3: rebuild the API family and `portal`; quickstart 5 to 8 in the browser pane with a throttled first load recorded 20 times (SC-004); run the existing portal Playwright suite against the `*.localhost` address (SC-006) and against the platform's address (SC-007); `python3 -m pytest tooling/release/test_release.py`

**Checkpoint**: pull request 3 merged. Branded sign-in works on a name under the platform's domain.

---

## Phase 6: User Story 3 - An Enterprise uses its own domain (P2) (pull request 4)

**Goal**: An owner claims a domain with one CNAME record and the portal serves there
securely, with its own session and passkeys.

**Independent Test**: quickstart steps 9 to 13.

- [ ] T056 [P] [US3] Pest tests apps/api/tests/Feature/Domain/Branding/PortalAddressDomainTest.php with a fake DNS resolver: claim returns the CNAME record `c-<token>.DOMAIN` and `waiting_dns`; `bare_domain` for two labels, `platform_domain` for a name under the deployment's domain, `host_taken`, `host_held` within 30 days of release, `403 custom_domain_not_allowed`; the right CNAME activates and a wrong or missing one does not; lapse after 7 days; three failed checks mark `unreachable` and one good check restores; **Check now** is limited to once a minute; one live domain per account; the domain is main while active and the name is main while it is unreachable
- [ ] T057 [P] [US3] Pest tests apps/api/tests/Feature/Domain/Branding/CustomDomainSessionTest.php: on a custom domain the session and kept sign-in cookies have no domain attribute; a session started there is refused on the platform's hosts and on another custom domain, and the reverse; `admin/*`, `/mcp` and the application sign-in pages answer 404 there; removing or suspending the address ends its sessions
- [ ] T058 [US3] Add `claimDomain`, `check` and the state transitions of data-model.md to `PortalAddresses`, with the DNS lookup behind an interface (`dns_get_record` in production, a fake in tests, always-found for `*.localhost` when `branding.dns_check` is off)
- [ ] T059 [US3] Add apps/api/app/Domain/Branding/Console/CheckPortalAddresses.php (`branding:check-addresses`, every 2 minutes in the schedule; waiting claims each run, active and unreachable ones every 15 minutes) writing `portal_address.activated`, `.unreachable`, `.recovered` and `.lapsed`
- [ ] T060 [US3] Extend `ApplyPortalAddress` for the domain kind (research R6): set `session.domain` to null, `sanctum.stateful` to the host, and the passkey relying party and allowed origins to the host for the request; answer 404 for admin, agent and application sign-in routes; record `portal_address_id` in the session in `CompleteSignIn`, `ResumeKeptSignIn` and the invitation controller; make `EnsurePortalAccess` answer 401 when the session's address and the request's differ
- [ ] T061 [US3] Extend the nginx template in deploy/docker/portal/nginx.conf: for hosts other than the platform's, proxy `/api/` and `/sanctum/` to the API with buffering off and the API's upload limit, and answer 404 for `/api/internal/` and `/internal/`; return an empty `VITE_API_URL` for the domain kind in `PortalBootstrap`
- [ ] T062 Create migration apps/api/database/migrations/2026_12_02_000100_add_relying_party_id_to_passkeys.php: `relying_party_id` string(253) indexed, filled with the configured relying party for existing rows
- [ ] T063 [US3] Store the relying party when a passkey is made, offer only the request's relying party's passkeys in apps/api/app/Domain/Authentication/Http/Controllers/PasskeySignInController.php `options`, and return `relying_party_id` and `usable_here` from `GET me/passkeys`, with Pest tests apps/api/tests/Feature/Domain/Branding/PasskeyDomainTest.php
- [ ] T064 [US3] Add `PUT …/addresses/domain` and `POST …/addresses/{address}/check` to OwnedPortalAddressController.php and the admin twin, `api-client` methods and OpenAPI
- [ ] T065 [US3] Add **Use your own domain** to apps/portal/src/billing/AddressesPanel.tsx: the host field, the record to add with a copy button, the state with `Status` and `RelativeTime`, **Check now**, **Remove** with a confirmation, the lapse date, and the "not part of your plan" state; add the new statuses to the kit's `statusOf` after checking existing names
- [ ] T066 [US3] Show each passkey's domain on the portal's security page and, on a custom domain, a notice that passkeys from elsewhere do not work here (packages/auth/src and apps/portal/src/account)
- [ ] T067 [P] [US3] Write apps/api/resources/help/branding.md and apps/api/resources/help/custom-domain.md (the CNAME record, the states, passkeys and alerts on a new domain) without naming the product, and add them to apps/api/resources/help/contexts.json
- [ ] T068 [P] [US3] Docs: custom domains, states and passkeys per domain in docs/features/branding.md and docs/features/access.md; per-request configuration and Octane in docs/dev/gotchas.md
- [ ] T069 [US3] Verify pull request 4: rebuild the API family and `portal`; quickstart 9 to 12 with a `portal.acme.localhost` address; run the existing portal Playwright suite against it (SC-006)
- [ ] T070 [US3] Verify on a test deployment with the wildcard record and a real subdomain (quickstart 13): active within 10 minutes of the record (SC-002), a valid certificate, kept sign-in across a browser restart, and no certificate request for an unclaimed name requested twenty times (SC-008)

**Checkpoint**: pull request 4 merged.

---

## Phase 7: User Story 5 - Emails, alerts and the installed app carry the brand (P3) (pull request 5)

**Goal**: Everything that leaves the portal carries the account's brand and returns to
its main address.

**Independent Test**: quickstart steps 14 to 17.

- [ ] T071 [P] [US5] Pest tests apps/api/tests/Feature/Domain/Branding/PortalLinksTest.php: links for an organization use the account's domain when active, the name when the domain is unreachable or absent, and the platform's address with no address; request-scoped links use the request's address; billing mail uses the platform's; queued mail built with no request still resolves by organization
- [ ] T072 [US5] Implement apps/api/app/Domain/Branding/Services/PortalLinks.php (`forOrganization`, `forRequest`, `platform`) and Services/MailBrand.php (name, logo URL, support link) (research R11)
- [ ] T073 [US5] Replace `config('app.frontend_url')` and hard-coded product names with `PortalLinks` and `MailBrand` in OrganizationInvitationNotification.php, OrganizationWelcomeNotification.php (apps/api/app/Domain/Administration/Notifications), PasswordResetNotification.php, SecurityChanged.php (Authentication/Notifications), RequireTwoStep.php, SignUpConfirmation.php, SignUpAccountExists.php, SignUpWelcome.php (SignUp/Notifications), AlertEmail.php (Automation/Mail) and TicketActivityMail.php (Support/Mail); set the sender's display name to the brand's name and keep the sending address; leave the billing mailables and DeliverNotificationEmail.php on `platform()`
- [ ] T074 [US5] Publish Laravel's mail templates to apps/api/resources/views/vendor/mail with a header that shows the brand's logo or name and a footer with the support link, and pass the name and links to the text views in apps/api/resources/views/automation and apps/api/resources/views/support
- [ ] T075 [P] [US5] Pest tests apps/api/tests/Feature/Domain/Branding/BrandedMailTest.php: for an organization under a branded account each mail of T073 has the brand's sender name, no platform name and links to the main address; for an unbranded account each is byte-for-byte as on `main`; invoices and payment mail keep the operator's name (FR-034)
- [ ] T076 [US5] Implement `GET /api/v1/portal/manifest.webmanifest` and `GET /api/v1/portal/icons/{name}` in PortalBootstrapController.php per contracts/portal-bootstrap.md (the built manifest's other members unchanged; the platform's own file when the brand has no icon; 404 when not in use) and route `/manifest.webmanifest` and the five icon paths to them in deploy/docker/portal/nginx.conf, with Pest tests
- [ ] T077 Create migration apps/api/database/migrations/2026_12_04_000100_add_portal_address_to_push_devices.php: `portal_address_id` FK nullable nullOnDelete
- [ ] T078 [US5] Set `portal_address_id` when a push device registers; skip a device whose address belongs to a different account than the alert's organization in the alert fan-out (apps/api/app/Domain/Notifications); add `push_devices_elsewhere` to `GET me`; Pest tests apps/api/tests/Feature/Domain/Branding/PushAddressTest.php for the filter in both directions and for devices on the platform's address still receiving everything
- [ ] T079 [US5] Show a one-time notice in the portal when `push_devices_elsewhere` is above zero and this origin has no subscription, with one tap to turn alerts on (apps/portal/src/pwa and apps/portal/src/notifications)
- [ ] T080 [P] [US5] Take the product name from the brand in apps/portal/src/profiles/FirmwareSection.tsx, apps/portal/src/devices/DeviceOnboarding.tsx, apps/portal/src/devices/GatewayFirmwareDialog.tsx, apps/portal/src/devices/ConnectionKit.tsx and packages/auth/src/AcceptInvitationPage.tsx, and in the assistant prompts (apps/api/app/Domain/Assistant/Agents) and firmware text (apps/api/app/Domain/Firmware/Services) for the organization in scope
- [ ] T081 [P] [US5] Add a portal lint check that fails on the platform's name as a string literal under apps/portal/src and packages/auth/src (in packages/ui/scripts/check-ui.mjs or beside it), so FR-009 stays true
- [ ] T082 [P] [US5] Docs: what follows the brand in docs/features/branding.md; the installed app's name and icon per address and turning push on again in docs/features/portal-on-phones.md; the bootstrap object in docs/reference
- [ ] T083 [US5] Verify pull request 5: rebuild the API family and `portal`; quickstart 14 to 17 with the local mail catcher and a real push in Chrome; check SC-003 by searching every captured mail, the manifest and the sign-in pages for the platform's name

**Checkpoint**: pull request 5 merged.

---

## Phase 8: User Story 6 - Platform staff control branding and addresses (P3) and polish (pull request 6)

**Goal**: Staff see every address, suspend and restore one, and edit on an owner's behalf.

**Independent Test**: quickstart steps 18 and 19.

- [ ] T084 [P] [US6] Pest tests apps/api/tests/Feature/Domain/Branding/PlatformPortalAddressTest.php: the list is refused to organization members and owners; filter and search; suspend makes `ask` answer 404 and the bootstrap answer `not_in_use` within the cache time and ends sessions there; an owner cannot restore or delete a suspended address (`409 suspended`); restore rechecks and returns to the earlier state; withdrawing `branding` behaves as suspended for every address without changing states, and restoring it brings them back
- [ ] T085 [US6] Implement apps/api/app/Domain/Branding/Http/Controllers/PlatformPortalAddressController.php (`GET admin/portal-addresses`, `POST …/suspend`, `POST …/restore`) with `api-client` methods and OpenAPI
- [ ] T086 [US6] Add apps/admin/src/pages/PortalAddressesPage.tsx in the organizations group (`CollectionPage` with `DataTable`: **Address**, **Kind**, **Billing account**, **State** through `Status`, **Last checked** through `RelativeTime`, a state filter and search), its route in apps/admin/src/App.tsx and navigation in apps/admin/src/layout/AdminLayout.tsx
- [ ] T087 [US6] Add an **Addresses** panel with **Suspend** and **Restore** to apps/admin/src/pages/BillingAccountPage.tsx
- [ ] T088 [P] [US6] Playwright apps/admin/e2e/branding.spec.ts: turn the allowances on, edit a brand for an owner, suspend and restore an address
- [ ] T089 [P] [US6] Add how to suspend an address, what a withdrawn allowance does and the first-domain checklist to docs/ops/release.md; put the pilot's wildcard record in the private operations inventory only
- [ ] T090 [US6] Verify pull request 6: rebuild the API family and `admin`; quickstart 18 and 19
- [ ] T091 Check the installed app's name and icon and a push on a real iPhone and Android phone from a branded address, alongside the open phone checks of spec 033
- [ ] T092 Run `/speckit-converge`, move lasting behaviour to docs/features/branding.md, and freeze this folder when the last pull request merges

**Checkpoint**: pull request 6 merged. The feature is complete.

---

## Dependencies & Execution Order

- **Pull request 1** (T001–T003) first.
- **Pull request 2** (T004–T031) after 1: foundations, US2, the brand half of US1 and
  the allowances of US6.
- **Pull request 3** (T032–T055) after 2: addresses under the platform's domain and US4.
- **Pull requests 4** (T056–T070) **and 5** (T071–T083) after 3, in parallel. Both
  edit deploy/docker/portal/nginx.conf and `PortalBootstrap`; whichever merges second
  rebases.
- **Pull request 6** (T084–T092) after 4.

Within pull request 2: T004–T009 first; T011 before T013; the tests T010, T012, T015
and T023 in parallel; T019 and T020 before the portal tasks T021, T022 and T027.

Within pull request 3: T032, T033 and T036 before T037; T037 before T038–T041; T043 and
T044 together, since the portal cannot start on an address without both; T051 after
T050.

## Parallel Example: pull request 3

```text
Tests together: T034, T035, T042
API together after T037: T038+T039 (access), T041 (bootstrap), T050 (ask)
Portal together after T041: T044, T045, T046
```

## Implementation Strategy

- **MVP**: pull requests 1 and 2 put end-customer and Enterprise logos inside the
  portal on the platform's address (US2). Nothing about hosts changes yet.
- **Then**: 3 gives branded sign-in on a name under the platform's domain (US1, US4);
  4 adds the Enterprise's own domain (US3); 5 brands what leaves the portal (US5);
  6 gives staff the list and the switch-off (US6).
- The deployment switch and the three allowances are off by default, so each pull
  request can merge and ship without changing anything for existing accounts.
- Nothing ships to the pilot without the owner's approval.
