# Contract: Content rules

These rules apply to writers of `apps/website/src/content/docs/docs/` (served at
`/docs`) and the marketing pages. `check-site.mjs` enforces them. Their lasting copy
is `docs/dev/website.md`: the marketing rules arrive in PR 1 and the docs rules in
PR 4, so nothing depends on this spec after it is frozen.

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
- Hosts and addresses come from `site.config.ts` (`<Config key="apiBaseUrl" />` in
  MDX). Samples use `example.com` and `.test`, and documentation IP ranges
  (`192.0.2.0/24`, `203.0.113.0/24`).
- Pages about adapters live under a folder named `adapters/`, and pages about AI
  agents under `agents/`. The feature switches in `hosted-release.json` include or
  exclude those folders.
- Runnable code is imported from `samples/` with `<Code>` rather than pasted, so
  the samples harness runs what readers copy.

## Generated pages

These are never edited in `apps/website`; edit their source.

| Pages | Source at the hosted commit |
| --- | --- |
| `/docs/reference/api/**` | `contracts/openapi/openapi.json`, integration paths, webhooks and referenced components |
| `/docs/developers/events` (event types section) | `IntegrationEvent` and `webhooks.integrationEvent` in the same contract |
| `/docs/developers/agents/tools` (gated) | `contracts/agents/tools.json` |
| `/docs/guides/<slug>` | `apps/api/resources/help/<slug>.md`; `/help/<slug>` links become `/docs/guides/<slug>/` |

## Marketing pages

- Wrap every capability statement in `<Claim doc="/docs/…">` or `<Claim id="…">`.
  Outcome figures (percentages, ranges, multiples) are allowed only inside a
  `<Claim id>` whose entry records `source`, `reviewed_by` and `reviewed_on`.
- Never present Modbus, OPC-UA, BACnet or other protocols as native. They connect
  through a Sparkplug-capable edge gateway.
- Don't call the product open source, mention a repository license, offer
  self-service sign-up or describe self-hosting.
- No customer, prospect or pilot names, logos or quotes.

## Changelog

`src/content/docs/docs/changelog.mdx` has one entry per hosted release that changes
the integration API version (`info.version`), its operations, its event types or the
SDK version. The build fails when:
- the hosted contract's version or the SDK's version has no entry, or
- the operations or event types differ from `apps/website/changelog-baseline.json`.

Add the entry, then refresh the baseline with `check-site changelog --update` in the
same pull request.
