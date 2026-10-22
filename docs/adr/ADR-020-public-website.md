# ADR-020: The Public Website and Developer Docs Are a Static Site Outside the Product

**Status:** Accepted; amended by [ADR-021](ADR-021-developer-docs-only.md)
**Date:** 2026-10-17
**Relates to:** [ADR-001](ADR-001-react-experience-layer.md), [ADR-007](ADR-007-monorepo-and-shadcn-ui.md), [ADR-012](ADR-012-design-system-and-charts.md), [ADR-016](ADR-016-public-api-contract.md)

## Context

The platform is sold as a hosted service. Its customers include hardware engineers
who connect devices and product engineers who build on the integration API and SDK.
Neither group has anything to read outside this repository:

- `docs/` is written for people who work on the code.
- The in-product guides (`apps/api/resources/help`) reach only signed-in portal users.
- The company's current marketing site speaks only to business buyers. It lists
  protocols the platform supports only through a gateway, and it has no privacy
  notice.

The integration API is already fully described by the generated contract
([ADR-016](ADR-016-public-api-contract.md)), but nothing publishes it.

A public site has needs the product apps don't:
- pages that search engines and readers without JavaScript can read
- an inquiry form that keeps working while the platform is down
- docs that describe what customers can use today, not what is merged on `main`

The repository is public, so the site's source can't hold real hosts, private names
or the exact production commit. The full reasoning and alternatives are in
[spec 013](../../specs/013-website-developer-docs/research.md) (R1 to R4).

## Decision

- **One static site** in `apps/website`, built with Astro. Marketing pages sit at the
  root and Starlight docs at `/docs`. Interactive parts (the inquiry form, the mobile
  menu) are React islands using `@iot-os/ui`. Pages use the kit's tokens, type scale
  and controls, and `check-ui` also reads `.astro` files.
- **Hosted on Cloudflare** as a Worker's static assets, outside the product's
  deployment profiles ([ADR-006](ADR-006-deployment-profiles.md)). The marketing
  domain's DNS zone moves to Cloudflare. Permanent redirects for the current site's
  URLs are served from `_redirects`.
- **Deployed by its own workflow**, `website-deploy.yml`: a preview for each pull
  request and production on `main`. This is the repository's first continuous
  deployment, and it covers the site only. Platform releases are unchanged.
- **One server route**, `POST /api/inquiry`, in the same Worker. It stores each
  inquiry in D1 before emailing it to a verified team address, and retries until it
  is delivered. The site never calls the platform. Inquiries are the company's sales
  data, not tenant data.
- **Docs follow the hosted release.** The API reference, event types, agent tools
  and user guides are generated at build time from the commit the hosted service
  runs, and fail closed. That commit is kept out of the public repository:
  - in CI it is the Actions secret `WEBSITE_HOSTED_REF`, which public logs mask
  - locally it lives in `.local/website/website.env`
  - it never appears in built pages

  Only the hosted feature switches (adapters, agent access) are committed, in
  `apps/website/hosted-release.json`. Pages for switched-off or unreleased features
  are not published.
- **Names and hosts come from configuration.** The product name, company name,
  domains and addresses are set in `apps/website/site.config.ts` from deploy-time
  variables, with `example.com` placeholders in the repository. Build checks fail on
  committed real values, private names, capability claims without a docs page or
  reviewed source, and old URLs that don't resolve.

ADR-001 is unchanged: the customer and administration applications stay React
single-page apps. The site is not a product client, and its islands are the same
kit components.

## Consequences

- A new vendor and new secrets: a Cloudflare account and API token, the D1
  database, the verified team address, the hosted commit and the names denylist.
  A Cloudflare outage takes the site down but not the platform, and a platform
  outage leaves the site up.
- Site changes ship from `main` independently of platform releases. Generated
  reference and drafted pages wait until `WEBSITE_HOSTED_REF` points at a commit
  that contains them. The operator updates the secret after each hosted deploy.
- Marketing copy is reviewed like code. A capability claim needs a docs page or an
  entry in the claims list with its source and reviewer.
- Lasting rules live in `docs/dev/website.md` (writing and checks) and
  `docs/ops/website.md` (deploy, inquiries, cutover and rollback), not in the spec.
- The constitution's stack line names the site.
- Moving the site elsewhere (another static host, or the release Compose profile)
  would need a new decision. The inquiry route depends on Cloudflare's D1, email and
  rate-limit bindings.
