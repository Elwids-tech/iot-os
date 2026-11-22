# Branding API

Routes, shapes and refusal codes of [branding](../features/branding.md): brands, logos,
portal addresses, and what the portal's web server asks the API for on an address.
Decided in [ADR-050](../adr/ADR-050-brands-and-portal-addresses.md).

## Routes

All routes are under `/api/v1`. Errors use the API's usual body, `{ "message", "code" }`.
The OpenAPI document (`contracts/openapi`) and `packages/api-client` carry the same
routes. Image uploads and claims of a name or a domain are limited to 30 a minute.

### Shapes

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
  "url": "https://portal.example.org",    // where the portal opens there
  "state": "waiting_dns",                 // waiting_dns | active | unreachable | suspended | lapsed
  "main": false,
  "claimed_at": "…", "activated_at": null, "last_checked_at": "…",
  "unreachable_since": null, "suspended_at": null,
  // A custom domain also carries:
  "record": { "type": "CNAME", "name": "portal.example.org", "value": "c-7k2m….example.com" },
  "lapses_at": "…",
  "certificate_expires_at": "…",          // as last read from the proxy; null before a read and for a name
  "certificate_expiring": false           // expired, or 14 days or less left: renewal is overdue
}

// Branding (what the owner and admin pages read)
{
  "brand": { … },
  "addresses": [ … ],
  "allowances": { "branding": true, "custom_domain": false, "hide_powered_by": false },
  "addresses_available": true,            // the deployment switch
  "name_suffix": ".example.com",
  "limits": { "image_bytes": 1048576, "types": ["image/png", "image/jpeg", "image/webp"], "icon_min": 512 }   // an icon is at most 2048 × 2048
}
```

### Billing account owners

Found through the caller's owned accounts; any other account answers 404.

| Method and path | Does | Answers |
| --- | --- | --- |
| `GET billing-accounts/{account}/branding` | Reads the shape above | 200 |
| `PUT billing-accounts/{account}/brand` | `product_name`, `short_name`, `support_url`, `revision` | 200 brand · 403 `branding_not_allowed` · 409 `brand_changed` (stale revision) · 422 |
| `POST billing-accounts/{account}/brand/images/{role}` | Multipart `image`; `role` is `logo`, `logo_dark` or `icon`. POST because PHP reads a multipart body only on POST | 200 brand · 403 · 422 `image_type`, `image_too_large`, `image_not_square`, `image_too_small` |
| `DELETE billing-accounts/{account}/brand/images/{role}` | Removes that image | 200 brand |
| `PUT billing-accounts/{account}/addresses/name` | `{ "name": "acme" }`; claims or renames | 200 address · 403 `branding_not_allowed` · 409 `addresses_unavailable`, `name_taken`, `name_reserved`, `suspended` · 422 `name_invalid` |
| `PUT billing-accounts/{account}/addresses/domain` | `{ "host": "portal.example.org" }`. The same host again returns the same claim | 200 address (waiting) · 403 `custom_domain_not_allowed` · 409 `addresses_unavailable`, `host_taken`, `host_held`, `domain_exists` (remove the current domain first) · 422 `host_invalid`, `bare_domain`, `platform_domain` |
| `POST billing-accounts/{account}/addresses/{address}/check` | Checks DNS now; once a minute for each address | 200 address · 429 `checked_recently` |
| `DELETE billing-accounts/{account}/addresses/{address}` | Releases it; sessions there end | 204 · 409 `suspended` |

### Platform staff

Under `admin/`, with `can:PlatformAdministration.manage-organizations`.

| Method and path | Does |
| --- | --- |
| `GET admin/billing-accounts/{account}/branding` | The same shape |
| `PUT`, `POST`, `DELETE` on `admin/billing-accounts/{account}/brand…` and `…/addresses…` | As for owners, without the allowance check |
| `POST admin/portal-addresses/{address}/suspend` · `…/restore` | 200 address as in the list · 404 for a released or lapsed address. Both change nothing when there is nothing to do. Restore checks a custom domain at once: `active` if its record is there, else `waiting_dns` |
| `GET admin/portal-addresses?state=&search=&page=&per_page=` | Paginated list by host, without released addresses. Each address also carries `billing_account { uuid, name }` (null once the account is deleted), `serving` (false while the state serves and the account's allowance is off) and `suspended_by_user_id`. `search` matches the host or the account's name |

The three allowances are edited through the existing
`PUT/DELETE admin/billing-accounts/{account}/allowances/{kind}`, which accepts only 0
or 1 for `branding`, `custom_domain` and `hide_powered_by`.

### Organizations

| Method and path | Permission | Does |
| --- | --- | --- |
| `POST organizations/{organization}/logo` · `…/logo/dark` | `Organization.update` | Multipart `image`; 200 `{ uuid, logo, logo_dark, brand }` |
| `DELETE organizations/{organization}/logo` · `…/logo/dark` | `Organization.update` | 200 `{ uuid, logo, logo_dark, brand }` |

An organization (`OrganizationResource`) carries:

```jsonc
"logo": { "url": "…", "width": 320, "height": 96 },      // the organization's own, or null
"logo_dark": null,
"brand": {                                                // resolved for the shell
  "product_name": "Acme Monitor",                         // null → the platform's name
  "logo": { "url": "…" }, "logo_dark": null
}
```

### Public

| Method and path | Does |
| --- | --- |
| `GET brand-assets/{asset}/{variant}` | The image, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`. `{asset}` is the uuid followed by the first 12 characters of the content hash. 404 when unknown or pruned |

### What an address changes on other routes

| Route | Change |
| --- | --- |
| `POST login`, two-step and passkey sign-in | On an account's address, after valid credentials: `403 not_available_here` when the person has no organization there and no platform role |
| `POST login` | `403 second_step_elsewhere` after a right password when the person must use two-step and their only second step is a passkey made on another domain |
| Invitation accept | On an account's address: `403 not_available_here` for an invitation to another account's organization or to a platform role; it stays pending |
| `GET organizations/{organization}/context` | Adds `portal_url`: the portal on the main address of the organization's billing account, for links a person copies. Null when the account has no address |
| `GET me` | `organizations` lists only the address's account on an account's address. Adds `address { kind, host }` or null, and `push_devices_elsewhere` |
| Any `organizations/{organization}/…` route | `404 not_available_here` for an organization outside the address's account |
| Any signed-in route but sign-out | `403 not_available_here` once the person has no organization left at the address. A session on the address's own host is ended; one shared with the platform's address is not |
| Any authenticated route | `401` when the session belongs to another address (custom domains) |
| `GET sign-up`, `POST sign-up` | Closed on any address |
| `GET me/passkeys` | Each passkey gains `relying_party_id` and `usable_here` |
| `GET auth/passkeys/options`, confirmation and registration options | The relying party is the request's domain; only its passkeys are offered, excluded or accepted |
| `admin/*`, `agent-authorizations`, `/mcp`, `/oauth/*`, `/.well-known/*`, `stripe/*` | 404 on a custom domain |
| Any API route | `421 address_not_in_use` for a request from, or on, a host under the platform's domain that is neither one of the platform's own nor an address that serves, and for any other host the portal's web server passed on (`X-Portal-Address`) that is not an address that serves |
| Any API route but the bootstrap | 404 on a name's own host: a name calls the platform's API host (development serves it on the name) |

### Internal

| Method and path | Caller | Answers |
| --- | --- | --- |
| `GET /api/internal/portal-addresses/ask?domain={host}&token={token}` | The proxy, before it asks for a certificate | 200 when the host is an address that serves, or a renamed name still sending visitors to the new one (it needs a certificate to redirect); 404 otherwise; 401 on a bad token. Blocked from outside by the proxy like every `/api/internal` route |

### Activity

`brand.updated`, `brand.image_changed`, `organization.logo_changed`,
`portal_address.claimed`, `.suspended`, `.restored`, `.released`, and with custom
domains `.activated`, `.unreachable`, `.recovered`, `.lapsed`. Each carries the actor's `user_id` (null for the
scheduled check), the host or the changed fields, and never image bytes.

## What a host learns before the portal starts

What the portal learns about its host before it starts. The portal's nginx sends these
paths to the API for every host that is not the platform's own portal host; on that
host the static files of today are served unchanged.

| Browser path | API route | Cache |
| --- | --- | --- |
| `/runtime-config.js` | `GET /api/v1/portal/runtime-config.js` | `no-store` |
| `/manifest.webmanifest` | `GET /api/v1/portal/manifest.webmanifest` | `no-cache` |
| `/pwa-64x64.png`, `/pwa-192x192.png`, `/pwa-512x512.png`, `/maskable-icon-512x512.png`, `/apple-touch-icon-180x180.png` | `GET /api/v1/portal/icons/{name}` | `max-age=3600` |

The host is the forwarded `Host`. None of the routes needs a session.

### `runtime-config.js`

`Content-Type: application/javascript`. One statement:

```js
window.__IOT_CONFIG__ = {
  "VITE_API_URL": "",                        // "" = this origin (custom domain); "https://api.example.com" for a name under the platform's domain
  "VITE_PORTAL_URL": "https://portal.example.org",
  "VITE_ADMIN_URL": "",                      // never given on an address
  "VITE_MAP_STYLE_URL": "…",
  "environment": "production",
  "address": { "kind": "domain", "host": "portal.example.org", "state": "active" },
  "brand": {
    "product_name": "Acme Monitor",
    "short_name": "Acme",
    "support_url": "https://support.example.org",
    "logo": "/api/v1/brand-assets/…/logo",  // on the API's origin: absolute when VITE_API_URL is
    "logo_dark": null,
    "icon": "/api/v1/brand-assets/…/192",   // the tab icon, or null
    "touch_icon": "/api/v1/brand-assets/…/180",
    "powered_by": "IoT OS"                  // the platform's name, or null when the line is hidden
  },
  "sign_up": false
};
```

Rules:

- **Unknown, suspended, lapsed or released host, or branding not allowed**: 200 with
  `"address": { "state": "not_in_use" }`, no `brand`, and every URL empty. The portal
  shows *This address is not in use* and starts nothing.
- **A renamed name, for 30 days**: `"address": { "state": "moved", "to": "https://new-name.example.com" }`.
  The portal goes there, keeping the path.
- **An address whose brand has no product name yet**: `brand` is null; the portal uses
  the platform's name. This cannot happen through the portal, which asks for the name
  before an address.
- **Unchanged keys** keep their meaning, so a portal that ignores `brand` and
  `address` behaves as today.
- The static file on the platform's host has neither `brand` nor `address`; both
  absent means "the platform's own address".
- Values are JSON-encoded with `JSON_HEX_TAG`, so a product name cannot close the
  script.
- The portal keeps an address's object in `localStorage` (`iot-runtime-config`) and
  starts from it when the file cannot be fetched, so an address opened offline is not
  mistaken for the platform's.

The portal's inline bootstrap (`apps/portal/src/lib/brand-bootstrap.js`) and
`packages/api-client/src/runtime-config.ts` both test against one fixture,
`apps/portal/src/lib/__fixtures__/runtime-config.branded.js`.

### `manifest.webmanifest`

The same manifest the build produces, with these members from the brand:

| Member | Value |
| --- | --- |
| `name` | `product_name` |
| `short_name` | `short_name` |
| `icons` | The five paths above (unchanged paths, branded bytes) |

`id`, `start_url`, `scope`, `display`, colours and `description` are unchanged. For a
host that is not in use: 404.

### Icons

`{name}` is one of the five file names. The API answers the brand icon's matching size
(`64`, `192`, `512`, `maskable`, `180`). When the brand has no icon it answers `204`
with `X-Accel-Redirect: /platform-files/{name}`, and the portal's nginx sends the
platform's own file from that internal location. For a host that is not in use: 404.

The service worker does not precache the manifest or the five icons, so they are
always the host's.

### What does not change

- The push body `alert-push.v1` and the service worker: notification icons are the
  fixed paths, and tap targets are relative paths, so both follow the host.
- The admin app's `runtime-config.js`.
