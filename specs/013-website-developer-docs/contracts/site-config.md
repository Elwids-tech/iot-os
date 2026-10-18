# Contract: Site configuration

`apps/website/site.config.ts` exports one object. It is the only place in
`apps/website/src` where these values may appear (FR-003). The real values are GitHub
Actions variables or secrets in the deploy workflow. For local builds they go in
`.local/website/website.env`, which `site.config.ts` loads with `process.loadEnvFile`
when the file exists. Committed defaults are placeholders (FR-004).

| Key | Environment variable | Placeholder default | Used for |
| --- | --- | --- | --- |
| `productName` | `PUBLIC_SITE_PRODUCT_NAME` | `IoT OS` | Every mention of the product |
| `companyName` | `PUBLIC_SITE_COMPANY_NAME` | `Example Company` | Footer, privacy notice, titles |
| `siteUrl` | `PUBLIC_SITE_URL` | `https://www.example.com` | Canonical URLs, sitemap, `Origin` check |
| `docsUrl` | `PUBLIC_SITE_DOCS_URL` | `https://www.example.com/docs` | Links from the SDK README and emails |
| `portalUrl` | `PUBLIC_SITE_PORTAL_URL` | `https://app.example.com` | **Sign in**, portal links in guides |
| `apiBaseUrl` | `PUBLIC_SITE_API_BASE_URL` | `https://api.example.com` | API reference `servers`, samples |
| `brokerHost` | `PUBLIC_SITE_BROKER_HOST` | `mqtt.example.com` | Hardware docs (the connection kit carries the real value per device) |
| `contactAddress` | `PUBLIC_SITE_CONTACT_ADDRESS` | `hello@example.com` | Footer, form fallback, 503 body |

Worker-only settings, which never reach the browser bundle:

| Setting | Source | Purpose |
| --- | --- | --- |
| `TEAM_MAIL` binding `destination_address` | Secret `WEBSITE_TEAM_ADDRESS`, written into the deploy-time Wrangler config | Where inquiries go |
| `MAIL_FROM` | Variable | Sender on the marketing domain |
| `SITE_URL` | Same as `PUBLIC_SITE_URL` | `Origin` check |

Build and CI only:

| Secret | Purpose |
| --- | --- |
| `WEBSITE_HOSTED_REF` | The hosted commit the generated docs come from. A secret so it is masked in public logs; locally in `.local/website/website.env`. Never printed or written to `dist` |
| `WEBSITE_DENYLIST` | Newline-separated names for the `names` check; locally `.local/website/denylist.txt` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Deploys and D1 migrations |
| `WEBSITE_D1_DATABASE_ID` | The production D1 database, written into the deploy-time Wrangler configuration |

The local Worker uses `wrangler.jsonc` placeholders (`SITE_URL` is
`http://localhost:8787`). Test flags are passed on the command line
(`wrangler dev --var MAIL_FAIL:1`), so no `.dev.vars` file is needed.

The `literals` check reads the effective values (real values in CI, placeholders in
forks). It fails when any value appears in `src/` outside `site.config.ts`.
`productName` matches only as a whole phrase that is not part of a package name, so
specifiers such as `@iot-os/ui` are not flagged.

The `rename` check (SC-007) builds once with
`PUBLIC_SITE_PRODUCT_NAME="Renamed Product"` and fails if the default name appears
anywhere in the built text.
