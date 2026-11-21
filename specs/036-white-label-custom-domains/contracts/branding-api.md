# Contract: Branding API

All routes are under `/api/v1`. Errors use the API's usual body, `{ "message", "code" }`.
OpenAPI and `packages/api-client` change in the pull request that adds each route.

## Shapes

```jsonc
// Brand
{
  "product_name": "Acme Monitor",        // null until set
  "short_name": "Acme",
  "support_url": "https://support.example.org",
  "logo": { "url": "https://api.example.com/api/v1/brand-assets/…/logo", "width": 480, "height": 120 },
  "logo_dark": null,
  "icon": { "url": "…/512", "width": 512, "height": 512 },
  "in_effect": true,                      // allowance on and a product name set
  "revision": 4                           // 0 before anything is saved
}

// Address
{
  "uuid": "…",
  "kind": "domain",                       // "name" | "domain"
  "host": "portal.example.org",
  "state": "waiting_dns",                 // waiting_dns | active | unreachable | suspended | lapsed
  "main": false,
  "record": { "type": "CNAME", "name": "portal.example.org", "value": "c-7k2m….example.com" },   // domain only
  "claimed_at": "…", "activated_at": null, "last_checked_at": "…",
  "unreachable_since": null, "lapses_at": "…"
}

// Branding (what the owner and admin pages read)
{
  "brand": { … },
  "addresses": [ … ],
  "allowances": { "branding": true, "custom_domain": false, "hide_powered_by": false },
  "addresses_available": true,            // the deployment switch
  "name_suffix": ".example.com",
  "limits": { "image_bytes": 1048576, "types": ["image/png", "image/jpeg", "image/webp"], "icon_min": 512 }
}
```

## Billing account owners

Found through the caller's owned accounts; any other account answers 404.

| Method and path | Does | Answers |
| --- | --- | --- |
| `GET billing-accounts/{account}/branding` | Reads the shape above | 200 |
| `PUT billing-accounts/{account}/brand` | `product_name`, `short_name`, `support_url`, `revision` | 200 brand · 403 `branding_not_allowed` · 409 `brand_changed` (stale revision) · 422 |
| `POST billing-accounts/{account}/brand/images/{role}` | Multipart `image`; `role` is `logo`, `logo_dark` or `icon`. POST because PHP reads a multipart body only on POST | 200 brand · 403 · 422 `image_type`, `image_too_large`, `image_not_square`, `image_too_small` |
| `DELETE billing-accounts/{account}/brand/images/{role}` | Removes that image | 200 brand |
| `PUT billing-accounts/{account}/addresses/name` | `{ "name": "acme" }`; claims or renames | 200 address · 403 · 409 `addresses_unavailable`, `name_taken`, `name_reserved` · 422 |
| `PUT billing-accounts/{account}/addresses/domain` | `{ "host": "portal.example.org" }` | 200 address (waiting) · 403 `custom_domain_not_allowed` · 409 `addresses_unavailable`, `host_taken`, `host_held` · 422 `bare_domain`, `platform_domain` |
| `POST billing-accounts/{account}/addresses/{address}/check` | Checks DNS now; once a minute | 200 address · 429 |
| `DELETE billing-accounts/{account}/addresses/{address}` | Releases it; sessions there end | 204 · 409 `suspended` |

## Platform staff

Under `admin/`, with `can:PlatformAdministration.manage-organizations`.

| Method and path | Does |
| --- | --- |
| `GET admin/billing-accounts/{account}/branding` | The same shape |
| `PUT`, `POST`, `DELETE` on `admin/billing-accounts/{account}/brand…` and `…/addresses…` | As for owners, without the allowance check |
| `POST admin/portal-addresses/{address}/suspend` · `…/restore` | 200 address |
| `GET admin/portal-addresses?state=&search=&page=` | Paginated list with `billing_account { uuid, name }` |

The three allowances are edited through the existing
`PUT/DELETE admin/billing-accounts/{account}/allowances/{kind}`, which accepts only 0
or 1 for `branding`, `custom_domain` and `hide_powered_by`.

## Organizations

| Method and path | Permission | Does |
| --- | --- | --- |
| `POST organizations/{organization}/logo` · `…/logo/dark` | `Organization.update` | Multipart `image`; 200 `{ uuid, logo, logo_dark, brand }` |
| `DELETE organizations/{organization}/logo` · `…/logo/dark` | `Organization.update` | 200 `{ uuid, logo, logo_dark, brand }` |

`OrganizationResource` gains:

```jsonc
"logo": { "url": "…", "width": 320, "height": 96 },      // the organization's own, or null
"logo_dark": null,
"brand": {                                                // resolved for the shell (FR-004)
  "product_name": "Acme Monitor",                         // null → the platform's name
  "logo": { "url": "…" }, "logo_dark": null
}
```

## Public

| Method and path | Does |
| --- | --- |
| `GET brand-assets/{asset}/{variant}` | The image, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`. `{asset}` is the uuid followed by the first 12 characters of the content hash. 404 when unknown or pruned |

## Changes to existing routes

| Route | Change |
| --- | --- |
| `POST login`, two-step and passkey sign-in, invitation accept | On an account's address, after valid credentials: `403 not_available_here` when the person has no organization there and no platform role |
| `GET me` | `organizations` lists only the address's account on an account's address. Adds `push_devices_elsewhere` (integer) and `address { kind, host }` or null |
| Any `organizations/{organization}/…` route | `404 not_available_here` for an organization outside the address's account |
| Any authenticated route | `401` when the session belongs to another address (custom domains) |
| `GET sign-up`, `POST sign-up` | Closed on any address |
| `GET me/passkeys` | Each passkey gains `relying_party_id` and `usable_here` |
| `GET auth/passkeys/options` | Offers only passkeys of the request's relying party |
| `admin/*`, `/mcp`, application sign-in pages | 404 on a custom domain |
| Any API route | `421 address_not_in_use` on a host that is neither a platform host nor an address that serves |

## Internal

| Method and path | Caller | Answers |
| --- | --- | --- |
| `GET /api/internal/portal-addresses/ask?domain={host}&token={token}` | The proxy, before it asks for a certificate | 200 when the host is an address that serves; 404 otherwise; 401 on a bad token. Blocked from outside by the proxy like every `/api/internal` route |

## Activity

`brand.updated`, `brand.image_changed`, `organization.logo_changed`,
`portal_address.claimed`, `.activated`, `.unreachable`, `.recovered`, `.suspended`,
`.restored`, `.released`, `.lapsed`. Each carries the actor's `user_id` (null for the
scheduled check), the host or the changed fields, and never image bytes.
