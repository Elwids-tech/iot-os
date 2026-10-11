# Spec-driven development

New features are specified, planned and broken into tasks with
[GitHub Spec Kit](https://github.com/github/spec-kit) before they are built. Bug
fixes and chores that change no behaviour or contract skip it.

## Where things live

| Path | What it is |
| --- | --- |
| [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) | The principles every plan is checked against |
| `.specify/templates/`, `.specify/scripts/` | Spec Kit templates and helper scripts (managed by the CLI) |
| `specs/NNN-short-name/` | One folder per feature: `spec.md`, `plan.md`, `tasks.md`, and `research.md`, `data-model.md`, `contracts/`, `quickstart.md` when needed |
| `.claude/skills/speckit-*`, `.agents/skills/speckit-*` | The commands for Claude Code and Codex |

## Workflow

Run these in Claude Code as `/speckit-<name>` or in Codex as `$speckit-<name>`:

1. `specify` — describe the outcome and the boundaries that must not change
   (existing APIs, permissions, contracts). Creates `specs/NNN-name/spec.md`.
2. `clarify` — answer the open questions before planning.
3. `plan` — the design, checked against the constitution. Reuse existing domains,
   the design system and test conventions; record any principle you must break in
   the plan's Complexity Tracking table.
4. `tasks`, then `analyze` — an ordered task list and a consistency check across the
   spec, plan and tasks.
5. `implement` — build it, then `converge` to find gaps; repeat until it reports
   none.

The active feature is recorded in `.specify/feature.json` (ignored, per checkout), not
derived from the git branch, so branch names stay free-form.

## After merge

Specs are history. Once a feature's pull request merges, its `specs/` folder is
frozen. Move lasting behaviour into [`docs/features`](../features) or
[`docs/reference`](../reference) in the same pull request, and record any decision as
an [ADR](../adr/README.md). A later change to the feature gets a new spec.

Candidate specs are listed under **Next** in the [roadmap](../roadmap.md); the first
is the OpenAPI description of the public and integration APIs.

## Upgrading Spec Kit

The project was initialised with Spec Kit 1.1.3 from the tagged source. Upgrade
deliberately, review the diff to `.specify/` and the skills, and keep the
constitution:

```bash
uvx --from git+https://github.com/github/spec-kit.git@v1.1.3 specify integration upgrade --force
```

Replace the tag with the new release. `specify integration install <key>` adds
another agent.
