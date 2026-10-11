# Assistant and help

The portal has one workspace panel for guidance and AI help. Its tabs are **Ask**
(the assistant for the current page), **This page** (the guide for the current
screen) and **All guides** (search). It docks as a rail from 1280 px and opens as a
sheet below that. The sidebar **Assistant** control and the page **Help** button
open the same panel.

The platform works fully without AI. Guides and search always work; AI features
are off until configured.

Code: Laravel [`Domain/Assistant`](../../apps/api/app/Domain/Assistant) (agents,
tools, runs) and [`Domain/Help`](../../apps/api/app/Domain/Help); portal
[`src/assistant`](../../apps/portal/src/assistant), [`src/help`](../../apps/portal/src/help);
guides [`apps/api/resources/help`](../../apps/api/resources/help).

## Safety rules

These hold for every assistant surface:

- **Authorization first.** Every endpoint checks the user, organization membership
  and the feature's permissions; tools re-check at execution time in the worker.
  Conversations are private to their creator and organization and keep one fixed
  target. Switching organization cannot retarget a conversation.
- **Proposals, not writes.** The assistant prepares a proposal (with its base
  revision and content hash). A person reviews structured fields, a comparison,
  evidence, validation and read-only JSON, then applies it. Typing "yes" in the
  conversation does not approve anything. Stale or superseded proposals cannot be
  applied.
- **Never live actions.** No assistant tool publishes a profile, activates a
  device, deploys a workflow or adapter, changes broker settings or sends a device
  command.
- **Evidence is data.** Uploaded files, tool results and quoted text are treated
  as evidence, never instructions. Device credentials and secrets are never in the
  model context.

## Surfaces

| Scope | Where | Tools |
| --- | --- | --- |
| `profile` | Device profiles, Add device wizard | Read the profile schema and authorized profiles, sources and retained facts; ask structured questions; preview and validate a section; apply an approved section ([`ProfileAssistantTools`](../../apps/api/app/Domain/Assistant/Tools/ProfileAssistantTools.php), [`ApplyProfileSection`](../../apps/api/app/Domain/Assistant/Tools/ApplyProfileSection.php)) |
| `automation` | Automation editor | Read the node registry, applied configurations, controllable settings and geofences; propose a compiler-validated graph ([`WorkflowAssistantTools`](../../apps/api/app/Domain/Assistant/Tools/WorkflowAssistantTools.php)) |
| `adapter` | Device adapter workbench | Propose decoder revisions from documentation and samples ([`AdapterAssistantTools`](../../apps/api/app/Domain/Assistant/Tools/AdapterAssistantTools.php)) |
| `help` | Every other page, or **Usage help** | No tools; answers only from approved guide excerpts |

The telemetry viewer's **AI troubleshoot** is a separate one-shot request on one
captured sample ([devices](devices.md#telemetry-viewer)).

### Device profile assistant

Describe the device, paste sample data or attach documentation. The assistant asks
required questions first (up to three at a time, with suggestions, free text, "I
don't know yet" and "Skip for now"), keeps extracted facts with their provenance,
and prepares one section at a time: identity, parameters, groups or calculations.
**Review section** opens the proposal; edited fields are revalidated into a new
proposal. **Save this section** applies the exact reviewed proposal to the draft,
atomically and idempotently. It is blocked while a form on the page has unsaved
changes. Publishing stays in the normal publication flow.

Files: PDF (including scans), PNG, JPEG, WebP, text, Markdown, JSON and CSV; 10 MiB
per file, five per message, 25 MiB combined, 100 PDF pages. Files are private,
served through authorized downloads, and kept until the creator deletes the
conversation.

### Automation assistant

Requires `Workflow.manage` and the organization's DAG automation preview. Each
request includes the current graph, unsaved edits included. The result is a
**Review proposed workflow** card; **Use this draft** only changes the editor's
local, undoable graph. If the editor changed meanwhile, the old proposal cannot
replace it. Command settings in a proposal need `Device.command`. Geofence geometry
is copied into the node, so later boundary edits do not update it. Limits: 30,000
characters of draft context, six recent exchanges, no file uploads.

**Explain this execution** (Execution timeline) opens a conversation on one
recorded evaluation. The server fetches the evidence through the authorized
timeline API and stores a snapshot with the run; client-supplied facts are never
trusted. Citations open the exact step, action or evaluation. Evidence over 60,000
characters is refused rather than trimmed.

### Help

Guides are Markdown files with JSON front matter in
[`apps/api/resources/help`](../../apps/api/resources/help) (`slug`, `title`,
`section`, `contexts`, `required_capabilities`, integer `revision`, suggested
questions) and fixed headings (Purpose, Before you start, Steps, Expected result,
Troubleshooting, Related guides). Page contexts map to guides in
[`contexts.json`](../../apps/api/resources/help/contexts.json) and the page header's
`helpContext`. When you change user-facing behaviour, update the guide in the same
change and bump its revision; run `php artisan help:validate` (also run by API image
builds).

AI answers (`IOT_HELP_AI_ENABLED=true`, plus the assistant settings below) use
server-side retrieval of approved excerpts filtered by the viewer's capabilities,
return a structured answer with citations to guide headings, and fall back to a
guide-based answer when unsupported. Help never sends resource identifiers, forms,
telemetry or credentials.

## Configuration and cost

Configure on the server only (root `.env` for Compose, `apps/api/.env` for host
processes); never in a `VITE_` variable:

```dotenv
OPENAI_API_KEY=...
OPENAI_STORE=false
IOT_ASSISTANT_ENABLED=true
IOT_ASSISTANT_MODEL=gpt-5.4-mini-2026-03-17
IOT_ASSISTANT_DAILY_BUDGET_USD=0.50
IOT_ASSISTANT_RUN_BUDGET_USD=0.04
IOT_HELP_AI_ENABLED=false
```

- Runs go through the `assistant` database queue and `assistant-worker`
  (180 s retry window, 120 s timeout), with idempotency keys, cancellation and
  recovery of stuck reservations (`php artisan assistant:recover`, scheduled every
  minute).
- The server reserves the run budget before queueing and records reported usage
  afterwards. These are **application guards, not provider billing caps**; keep
  provider-side limits. Unknown usage after a failure is charged at the reservation.
  Cost estimates assume the configured model's price; update the estimator when
  changing models. The budget is one shared daily allowance, not per organization.
- `store=false` disables Responses API storage; it does not imply zero provider
  retention. Selected content is sent to the provider.

There is no MCP endpoint. A future one must establish the same authenticated actor
and organization as the REST API.

## API

`/api/v1/organizations/{organization}/assistant`: `settings`; `conversations`
(list, create with `scope`, read, delete); `conversations/{c}/messages`, `events`
(cursor-based stream), `sources` (upload and download), `proposals` and
`proposals/{p}/decision`, `runs/{r}/cancel`.
`/api/v1/organizations/{organization}/help`: `page?context=`, `articles?query=`,
`articles/{slug}`.
