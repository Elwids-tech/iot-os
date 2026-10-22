# Docs site: publishing

The landing page and developer docs (`apps/docs`,
[dev/docs-site](../dev/docs-site.md)) are published to GitHub Pages at the root of the
platform's domain by [`.github/workflows/docs-deploy.yml`](../../.github/workflows/docs-deploy.yml)
([ADR-021](../adr/ADR-021-developer-docs-only.md)). Concrete domains and the hosted
commit live in GitHub settings and the private operations inventory, never in the
repository.

## First setup

1. **Pages:** in the repository's Settings → Pages, set the source to **GitHub
   Actions**.
2. **Verify the domain** for the organization (Organization settings → Pages → Add a
   domain). This adds a TXT record, and stops any other Pages site from claiming the
   domain.
3. **DNS**, at the platform domain's DNS provider:
   - Replace the registrar's parking or forwarding on the root (`@`) with GitHub
     Pages' A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and
     `185.199.111.153`. Add AAAA records `2606:50c0:8000::153` to `2606:50c0:8003::153`
     if the provider supports them.
   - Point `www` at the organization's `github.io` host with a CNAME.
   - **Leave every other record alone**: the portal, API, broker and ops subdomains
     keep pointing at the hosted service. Check they still answer afterwards.
4. **Custom domain:** set it to the root domain in Settings → Pages. Once the
   certificate is issued, tick **Enforce HTTPS**.
5. **Variables** (Settings → Secrets and variables → Actions → Variables):
   `PUBLIC_DOCS_PRODUCT_NAME`, `PUBLIC_DOCS_COMPANY_NAME`,
   `PUBLIC_DOCS_COMPANY_TAGLINE`, `PUBLIC_DOCS_SITE_URL`, `PUBLIC_DOCS_MARKETING_URL`,
   `PUBLIC_DOCS_CONTACT_URL`, `PUBLIC_DOCS_PORTAL_URL`, `PUBLIC_DOCS_API_BASE_URL`,
   `PUBLIC_DOCS_BROKER_HOST`, and `DOCS_PAGES_ENABLED=true` once the steps above are
   done. The deploy workflow does nothing until then.
6. **Secrets:**
   - `DOCS_HOSTED_REF`: the full commit the hosted service runs
   - `DOCS_DENYLIST`: private names the build must never publish, one per line

   Secrets are masked in public logs. Never paste the commit into issues or pull
   requests.

The CI `docs` job uses the same variables and secrets. Without the hosted commit it
builds from the working tree and says so.

## After each hosted deploy

1. Update the hosted commit: `gh secret set DOCS_HOSTED_REF`, and the same value in
   your `.local/docs/docs.env`.
2. List the drafts that are now released:

   ```bash
   pnpm --filter @iot-os/docs exec node scripts/check-docs.mjs drafts
   ```

3. Remove `draft: true` from those pages in a pull request. If a feature was switched
   on or off in the hosted service, change `apps/docs/hosted-release.json` in the same
   pull request. If the contract changed, add a changelog entry and refresh the
   baseline.
4. If nothing needs a pull request, publish with **Run workflow** on *Docs deploy*.

## When a deploy fails

The build runs every check before anything is uploaded, so a failure leaves the
published version online. Read the failing check in the job log (dev/docs-site lists
how to fix each one), fix it on `main`, and run the workflow again. To put back an
earlier version, revert the change on `main` and run the workflow.

## Privacy

The site sets no cookies and loads nothing from other origins. GitHub Pages, as the
host, keeps request logs; the company website's privacy notice should say the docs are
hosted there.
