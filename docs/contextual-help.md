# Contextual Help

The tenant portal's **Help** button opens a docked panel on desktop and a sheet on smaller screens. **This page** shows the current section/tab guide. **All guides** searches the approved library. **Ask Help** answers usage questions with guide-heading citations when enabled. Explicitly opened articles and conversations survive navigation; organization switching clears private panel drafts. Help does not send resource identifiers, editable forms, telemetry, credentials, or workflow definitions automatically.

## Maintaining articles

Approved English Markdown articles live in `apps/api/resources/help`. JSON front matter (between `---` lines) contains `slug`, `title`, `summary`, `section`, `contexts`, `keywords`, `required_capabilities`, integer `revision`, and suggested `questions`. JSON makes metadata parsing independent of a YAML runtime dependency. Each guide contains Purpose, Before you start, Steps, Expected result, Troubleshooting, and Related guides headings. Related links use `/help/{slug}#heading` and open within the panel.

When changing user-facing behavior, update the relevant guide in the same change, check its UI labels and expected outcome, and increment its revision. Add newly supported page contexts to `contexts.json` and the portal resolver or the page header's `helpContext`. Do not copy operational runbooks or provider credentials into this library. Revisions are authored integers, not generated timestamps. Stored answers become unavailable when a cited guide revision or viewing access changes.

From `apps/api`, run `rtk proxy php artisan help:validate`. API development and release container builds run the validator automatically. It checks required metadata/headings, unique article and heading identifiers, allowed capabilities, context coverage, and internal links. `HelpTest` evaluates two representative search questions per section, authorization, citations, scope isolation, cancellation, failure, budgets, and recovery. Portal browser tests cover panel interactions, unsaved workflow/assistant drafts, search, mobile accessibility, and organization switching.

## API and access

Authenticated organization routes:

- `GET /api/v1/organizations/{organization}/help/page?context={key}`
- `GET /api/v1/organizations/{organization}/help/articles?query={text}`
- `GET /api/v1/organizations/{organization}/help/articles/{slug}`

Help conversations use the existing Assistant routes with `scope=help` for settings, creation, and history. Messages contain only `request_id`, `text`, and `page_context`. Uploads, authoring targets, execution evidence, proposals, and approval decisions are unavailable to Help. Personal ownership and organization membership apply to conversations. Article viewing capabilities are applied before search/retrieval and rechecked in the worker and when returning stored answers.

Each run stores its validated page context, retrieved article/heading/revision references, and a validated answer with citations. Laravel AI produces a structured answer; unverified output is never streamed or exposed. The agent has no tools, attachments, remembered SDK authoring state, or live-data access. Server-side retrieval supplies bounded approved excerpts. Unsupported answers and invalid citations return a guide-based fallback.

## AI rollout and operation

Guides and search are always available to authorized users. `IOT_HELP_AI_ENABLED=false` is the default. After content/retrieval, regression, and browser checks pass, set `IOT_HELP_AI_ENABLED=true` in the local Compose environment and recreate `api` and `assistant-worker`. Help additionally requires the existing `IOT_ASSISTANT_ENABLED`, server-side provider key, model, and shared budget allowance. No browser key or new vector service is needed.

The existing queue, run reservation, cancellation, recovery, and deletion mechanisms apply. A stopped in-flight provider call is discarded on completion. Provider failures without usage are conservatively charged against the reserved allowance. These estimates are application controls, not provider-enforced billing caps. Help completion logs contain context, latency, supported status, and estimated cost; retrieval misses and failures are recorded without logging raw questions or guide excerpts.

`HelpRetrieval` is the replacement boundary for a future semantic index. Add vectors only after a measured retrieval gap justifies them, maintaining the same authorization and revision checks. Current retrieval weights title, keywords, headings, and body matches and boosts current-page guidance.

Production deployment is separate from local verification. The default production flag remains disabled until release evaluation is accepted.
