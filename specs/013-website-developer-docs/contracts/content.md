# Contract: Content rules

These rules apply to writers of `apps/docs/src/content/docs/docs/` (served at
`/docs`). `check-docs.mjs` enforces them. Their lasting copy is
`docs/dev/docs-site.md`, written in PR 1, so nothing depends on this spec after it is
frozen. The marketing site's content rules moved to the website repository
([ADR-021](../../../docs/adr/ADR-021-developer-docs-only.md)).

## Hand-written docs pages

```yaml
---
title: Connect your first device
description: Register a simulated Sparkplug device and see its readings in the portal.
draft: true        # optional: unreleased behaviour, left out of production builds
---
```

- Describe the hosted service as the hosted release runs it. Write for someone
  outside the company: no repository paths, internal class names or ADR jargon. Link
  to the portal screen by name, using `portalUrl` for links.
- Don't describe self-hosting, call the product open source or name a repository
  license. Use no customer, prospect or pilot names.
- Hosts and addresses come from `docs.config.ts` (`<Config key="apiBaseUrl" />` in
  MDX). Samples use `example.com` and `.test`, and documentation IP ranges
  (`192.0.2.0/24`, `203.0.113.0/24`).
- Pages about adapters live under a folder named `adapters/`, and pages about AI
  agents under `agents/`. The feature switches in `hosted-release.json` include or
  exclude those folders.
- Runnable code is imported from `samples/` with `<Code>` rather than pasted, so
  the samples harness runs what readers copy.

## Landing page

`src/content/docs/index.mdx`, served at the root of the platform domain:
- one sentence on what the platform is, and the company that runs it
- actions for sign-in and each published quickstart, and the API reference; never a
  draft page
- link cards to hardware, developers and user guides, and a link to the company
  website
- no industry products, outcome figures, customers or testimonials. Every
  capability it mentions links to a docs page

## Generated pages

These are never edited in `apps/docs`; edit their source.

| Pages | Source at the hosted commit |
| --- | --- |
| `/docs/reference/api/**` | `contracts/openapi/openapi.json`, integration paths, webhooks and referenced components |
| `/docs/developers/events` (event types section) | `IntegrationEvent` and `webhooks.integrationEvent` in the same contract |
| `/docs/developers/agents/tools` (gated) | `contracts/agents/tools.json` |
| `/docs/guides/<slug>` | `apps/api/resources/help/<slug>.md`; `/help/<slug>` links become `/docs/guides/<slug>/` |

## Changelog

`src/content/docs/docs/changelog.mdx` has one entry per hosted release that changes
the integration API version (`info.version`), its operations, its event types or the
SDK version. The build fails when:
- the hosted contract's version or the SDK's version has no entry, or
- the operations or event types differ from `apps/docs/changelog-baseline.json`.

Add the entry, then refresh the baseline with `check-docs changelog --update` in the
same pull request.
