# ADR-021: The Marketing Website Leaves This Repository; Developer Docs Stay on GitHub Pages

**Status:** Accepted
**Date:** 2026-10-18
**Amends:** [ADR-020](ADR-020-public-website.md)
**Relates to:** [ADR-012](ADR-012-design-system-and-charts.md), [ADR-016](ADR-016-public-api-contract.md)

## Context

ADR-020 put the marketing website and the developer docs into one static site,
`apps/website`, deployed to Cloudflare with a Worker for demo inquiries. Before any
of it was built, the company decided differently:

- **The marketing website replaces the current company site entirely.** It is built
  around the industries the company builds solutions for and the way it works with
  customers. That is company content, with its own contributors and release pace,
  and it says nothing about how the platform behaves. It will live in a separate,
  private repository.
- **The developer docs belong next to the code.** They are generated from this
  repository's API contract, help guides and agent tool catalogue at the hosted
  commit, and their samples run against the local stack. Moving them out would mean
  fetching sources across repositories and losing those checks on every pull request.

Once the marketing site leaves, the docs need no server code: no form, no inquiry
storage, no redirects from an old site. Static hosting is enough.

## Decision

- **Marketing moves out.** The marketing pages, the inquiry form and its Worker and
  storage, the claims list, the redirects from the current site and the cutover all
  leave this repository and its constitution. They are planned in the website
  repository. This repository only links to the marketing site through a configured
  URL.
- **Docs stay.** The developer docs are a static Astro and Starlight site in
  `apps/docs`, served at a docs subdomain. They keep these parts of ADR-020:
  - reference generated from the hosted commit, which stays out of the repository as
    the Actions secret `DOCS_HOSTED_REF`
  - committed hosted feature switches
  - names and hosts from deploy-time configuration
  - the build checks: configured literals, private names, switched-off features, the
    generated reference and the changelog
  - kit tokens and controls, with React islands only for interactive parts
- **GitHub Pages instead of Cloudflare.** `.github/workflows/docs-deploy.yml`
  publishes the docs to GitHub Pages, with the docs subdomain pointed at it by a
  CNAME record. A static site needs nothing more, and this keeps a new vendor and its
  secrets out of the platform repository.
- **Feedback goes to the marketing site.** Each docs page's "Report a problem" link
  opens the marketing site's contact page with the page address, so docs feedback
  reaches the same team inbox.

## Consequences

- This repository needs no Cloudflare account, D1 database, email binding or DNS
  zone move. The deploy workflow needs `pages: write` and `id-token: write`, plus the
  hosted-commit secret.
- GitHub Pages can't serve server-side redirects. A published site may not exceed
  1 GB, bandwidth has a soft limit of 100 GB a month, and a deployment times out
  after 10 minutes. The 10-builds-an-hour limit doesn't apply to a custom Actions
  workflow. All of this is fine for docs; moving the docs elsewhere would need a new
  decision.
- The constitution's stack line describes the docs site instead of the website.
- Spec 013 is rescoped to developer docs and SDK publishing. It had no
  implementation pull requests, so the spec is revised in place. Its earlier
  research on the website (hosting, inquiry storage, privacy, cutover) is kept as
  input for the website repository.
- The marketing site is not governed by this repository's constitution or Spec Kit.
  Claims it makes about the platform should still link to these docs.
