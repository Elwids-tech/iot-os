# Contract: Docs configuration

`apps/docs/docs.config.ts` exports one object. It is the only place in
`apps/docs/src` where these values may appear (FR-004). The real values are GitHub
Actions variables in the deploy workflow. For local builds they go in
`.local/docs/docs.env`, which `docs.config.ts` loads with `process.loadEnvFile` when
the file exists. Committed defaults are placeholders (FR-005).

| Key | Environment variable | Placeholder default | Used for |
| --- | --- | --- | --- |
| `productName` | `PUBLIC_DOCS_PRODUCT_NAME` | `IoT OS` | Every mention of the product |
| `companyName` | `PUBLIC_DOCS_COMPANY_NAME` | `Example Company` | Footer, titles |
| `siteUrl` | `PUBLIC_DOCS_SITE_URL` | `https://platform.example.com` | The platform domain's root: `site` for canonical URLs and the sitemap. The docs are under `/docs/`, which is also the SDK's `homepage` |
| `marketingUrl` | `PUBLIC_DOCS_MARKETING_URL` | `https://www.example.com` | Header link to the marketing site (FR-002) |
| `contactUrl` | `PUBLIC_DOCS_CONTACT_URL` | `https://www.example.com/contact` | **Report a problem with this page** (FR-017) |
| `portalUrl` | `PUBLIC_DOCS_PORTAL_URL` | `https://app.example.com` | **Sign in**, portal links in guides |
| `apiBaseUrl` | `PUBLIC_DOCS_API_BASE_URL` | `https://api.example.com` | API reference `servers`, samples |
| `brokerHost` | `PUBLIC_DOCS_BROKER_HOST` | `mqtt.example.com` | Hardware docs (the connection kit carries the real value per device) |

Build and CI only:

| Secret | Purpose |
| --- | --- |
| `DOCS_HOSTED_REF` | The hosted commit the generated docs come from. A secret so it is masked in public logs; locally in `.local/docs/docs.env`. Never printed or written to `dist` |
| `DOCS_DENYLIST` | Newline-separated names for the `names` check; locally `.local/docs/denylist.txt` |

The `literals` check reads the effective values (real values in CI, placeholders in
forks). It fails when any value appears in `src/` outside `docs.config.ts`.
`productName` matches only as a whole phrase that is not part of a package name, so
specifiers such as `@iot-os/ui` are not flagged.

The `rename` check (SC-005) builds once with
`PUBLIC_DOCS_PRODUCT_NAME="Renamed Product"` and fails if the default name appears
anywhere in the built text.
