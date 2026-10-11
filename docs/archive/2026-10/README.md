# Archive, October 2026

**Unmaintained.** Nothing in this directory describes the current system, and
links inside these files may be broken. Read [the current docs](../../README.md)
instead.

These files are the planning and delivery records from the first build of IoT OS
(August to October 2026), written slice by slice during pilot and demo delivery.
They were moved here unchanged when the docs were restructured on 2026-10-11.
They are kept because they record why things were built the way they were: the
original target architecture, draft contracts, task plans with their acceptance
criteria, and verification evidence. When one of them disagrees with the code or
with [docs/](../../README.md), the code and the current docs win.

| Path | What it was |
| --- | --- |
| `docs/c4-architecture.md` | The first architecture baseline. It describes a system that was never built (Go public API, ClickHouse, Airflow). Superseded by [architecture/overview.md](../../architecture/overview.md). |
| `docs/staging-monitoring-email-setup.md` | Domain, DNS and email plan for the October 2026 staging launch. The result is in [ops/pilot.md](../../ops/pilot.md). |
| `plan/README.md`, `plan/architecture/` | The accepted target architecture of August 2026. Its still-true principles are in [architecture/overview.md](../../architecture/overview.md); its decisions are in [adr/](../../adr/README.md). |
| `plan/contracts/` | Draft canonical-ingestion and definition-activation contracts. Neither was built as drafted; see [ADR-014](../../adr/ADR-014-control-plane-data-plane-http-integration.md) and the contract READMEs under `contracts/`. |
| `plan/roadmap/` | Phase 1 roadmap, monorepo plan, definition of ready/done and scaling options. Open items moved to [roadmap.md](../../roadmap.md). |
| `plan/tasks/` | One plan per delivery slice, including the design-system rollout and the UI/UX audit. Durable behaviour moved to [features/](../../README.md#features); open items moved to [roadmap.md](../../roadmap.md). |
| `deploy/release/VERIFICATION.md` | Local and remote release verification evidence from September and October 2026. |

Do not update these files. Record new decisions as ADRs and new work as specs.
