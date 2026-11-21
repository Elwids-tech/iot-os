# Contract: Portal Bootstrap per Host

What the portal learns about its host before it starts. The portal's nginx sends these
paths to the API for every host that is not the platform's own portal host; on that
host the static files of today are served unchanged.

| Browser path | API route | Cache |
| --- | --- | --- |
| `/runtime-config.js` | `GET /api/v1/portal/runtime-config.js` | `no-store` |
| `/manifest.webmanifest` | `GET /api/v1/portal/manifest.webmanifest` | `no-cache` |
| `/pwa-64x64.png`, `/pwa-192x192.png`, `/pwa-512x512.png`, `/maskable-icon-512x512.png`, `/apple-touch-icon-180x180.png` | `GET /api/v1/portal/icons/{name}` | `max-age=3600` |

The host is the forwarded `Host`. None of the routes needs a session.

## `runtime-config.js`

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
    "logo": "https://portal.example.org/api/v1/brand-assets/…/logo",
    "logo_dark": null,
    "icon": "/pwa-192x192.png",
    "powered_by": "IoT OS"                  // the platform's name, or null when the line is hidden
  },
  "sign_up": false
};
```

Rules:

- **Unknown, suspended, lapsed or released host, or branding not allowed**: 200 with
  `"address": { "state": "not_in_use" }`, no `brand`, and an empty `VITE_API_URL`. The
  portal shows *This address is not in use* and starts nothing.
- **An address whose brand has no product name yet**: `brand` is null; the portal uses
  the platform's name. This cannot happen through the portal, which asks for the name
  before an address.
- **Unchanged keys** keep their meaning, so a portal that ignores `brand` and
  `address` behaves as today.
- The static file on the platform's host has neither `brand` nor `address`; both
  absent means "the platform's own address".
- Values are JSON-encoded with `JSON_HEX_TAG`, so a product name cannot close the
  script.

The portal's inline bootstrap and `packages/api-client/src/runtime-config.ts` both test
against one fixture, `apps/portal/src/lib/__fixtures__/runtime-config.branded.js`.

## `manifest.webmanifest`

The same manifest the build produces, with these members from the brand:

| Member | Value |
| --- | --- |
| `name` | `product_name` |
| `short_name` | `short_name` |
| `icons` | The five paths above (unchanged paths, branded bytes) |

`id`, `start_url`, `scope`, `display`, colours and `description` are unchanged. For a
host that is not in use: 404.

## Icons

`{name}` is one of the five file names. The API answers the brand icon's matching size
(`64`, `192`, `512`, `maskable`, `180`), or the platform's own file when the brand has
no icon. For a host that is not in use: 404.

## What does not change

- The push body `alert-push.v1` and the service worker: notification icons are the
  fixed paths, and tap targets are relative paths, so both follow the host.
- The admin app's `runtime-config.js`.
