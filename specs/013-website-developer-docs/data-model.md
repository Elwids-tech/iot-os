# Data Model: Developer Documentation and SDK Publishing

Nothing is stored at runtime. Everything here is build-time configuration or content
in the repository. The website's inquiry, claim and redirect entities moved to the
website repository with the marketing site
([ADR-021](../../docs/adr/ADR-021-developer-docs-only.md)).

## Docs configuration

`apps/docs/docs.config.ts`. Each value reads an environment variable at build time
and falls back to a placeholder. Full list: [contracts/docs-config.md](contracts/docs-config.md).

| Field | Rule |
| --- | --- |
| `productName`, `companyName` | Non-empty. The only place either name is written in `src/` (`literals` check) |
| `siteUrl` | Absolute `https` URL of the platform domain's root, with no path; the landing page is `/` and the docs are under `/docs/` |
| `marketingUrl`, `contactUrl`, `portalUrl`, `apiBaseUrl` | Absolute `https` URLs; placeholders use `example.com` |
| `brokerHost` | Hostname only, shown in hardware docs |

## Hosted release record

Two parts, kept apart so the production commit never appears in public
([research R4](research.md#r4-docs-follow-the-hosted-release)).

| Part | Where | Rule |
| --- | --- | --- |
| Hosted commit | `DOCS_HOSTED_REF`: Actions secret in CI; `.local/docs/docs.env` locally | Full 40-character SHA on `main`; must exist in the clone. Never printed, never written to `.sources/meta.json` or `dist` |
| `schema_version` | `apps/docs/hosted-release.json` | `hosted-release.v1` ([schema](contracts/hosted-release.schema.json)) |
| `features.adapters`, `features.agent_access` | Same file | Booleans; `false` excludes the gated docs folders |

The commit is updated after each hosted deploy. The switches change by pull request.
The `drafts` check lists drafts that the new commit contains.

## Changelog baseline

`apps/docs/changelog-baseline.json`: `operations` (sorted `METHOD /path` strings
under `/integration/v1`) and `event_types` (sorted `IntegrationEventType` values), as
of the latest changelog entry. `check-docs changelog` fails when the hosted
contract's lists differ, until a changelog entry is added and the baseline refreshed
with `--update`.

## Docs page

Front matter on hand-written pages ([contracts/content.md](contracts/content.md)).

| Field | Rule |
| --- | --- |
| `title`, `description` | Required (Starlight) |
| `draft` | `true` means unreleased; left out of production builds |
| Folder | `…/adapters/**` and `…/agents/**` are gated by the matching feature switch |

Generated user guide pages add `help_revision` (integer ≥ 1, from the guide's
`revision`) and `requires` (from `required_capabilities`), and are never committed.
