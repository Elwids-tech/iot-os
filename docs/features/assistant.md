# Assistant and help

The portal has one workspace panel for guidance and AI help. Its tabs are **Ask**
(the assistant), **This page** (the guide for the current screen) and **All guides**
(search). It docks as a rail from 1280 px and opens as a sheet below that. Every page
header has **Assistant** beside **Help**, and the sidebar foot has both too; they
open the same panel.

**Ask** follows the page. Where the page has an assistant of its own (the automation
editor) or is a profile page, it opens on that assistant. Everywhere else it opens
on suggestions for the page ([`suggestions.ts`](../../apps/portal/src/assistant/suggestions.ts)):
the work the assistants can do there, the guide's questions about the page, then the
tasks available from any page. The profile assistant and usage help open in the
panel from any page. An automation suggestion opens a new automation, and its example
request waits in that editor's assistant to be edited and sent; the hand-off carries
an id in the navigation state, so only the editor opened for it takes it. The device
onboarding assistant is the Ask tab on **Add device** and every device adapter page
(**Ask the onboarding assistant** on Add device starts a new conversation; an adapter's
page continues its latest one). It keeps one conversation from the first question to
the activated device. Every assistant is a conversation in this panel, never a tab of
its page. **Suggestions** at the top of the Ask tab returns to the list.

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
| `profile` | Device profiles and the Add device wizard; any page through **Create a device profile** | Read the profile schema and authorized profiles, sources and retained facts; ask structured questions; preview and validate a section; apply an approved section ([`ProfileAssistantTools`](../../apps/api/app/Domain/Assistant/Tools/ProfileAssistantTools.php), [`ApplyProfileSection`](../../apps/api/app/Domain/Assistant/Tools/ApplyProfileSection.php)) |
| `automation` | Automation editor; any page through an automation suggestion | Read the node registry, applied configurations, controllable settings and geofences; propose a compiler-validated graph ([`WorkflowAssistantTools`](../../apps/api/app/Domain/Assistant/Tools/WorkflowAssistantTools.php)) |
| `onboarding` | Ask on Add device and device adapter pages; **Ask the assistant** on an adapter's setup checklist | Ask how the device sends data and recommend the path; find adapters and profiles; propose reusing or creating an adapter; draft a missing profile with the profile tools; read samples; run Fetch now read-only; test decoder code; propose decoder, non-secret settings and fixtures; point to the next step ([`OnboardingTools`](../../apps/api/app/Domain/Assistant/Tools/OnboardingTools.php)) |
| `help` | Any page, through **Ask how to use the portal** or a question about the page | No tools; answers only from approved guide excerpts |

The telemetry viewer's **AI troubleshoot** is a separate one-shot request on one
captured sample ([devices](devices.md#telemetry-viewer)).

### Device onboarding assistant

Spec 020 replaced the adapter assistant with one assistant for onboarding any device
([`OnboardingAssistant`](../../apps/api/app/Domain/Assistant/Agents/OnboardingAssistant.php)).
It asks how the device sends data, with choices, then recommends a path:

- **Direct** (the device speaks Sparkplug B) or **gateway**: it explains and opens
  **Add device** in that mode. It creates nothing.
- **Adapter**: it picks the source (devices publish to the tenant broker, vendor MQTT
  broker, webhook, or polling a vendor API), reuses an adapter that fits or proposes a
  new draft, and drafts the device profile in the same conversation when none fits.

On an adapter it reads captured samples and attached documents, may run **Fetch now**
itself (read-only, within the adapter's 6-a-minute limit), tests decoder code against
samples, and proposes one change at a time: decoder, non-secret source settings and
fixtures together. A proposal is a card in the chat; **Review** opens its code,
settings and samples beside the current draft. Applying a proposal saves one draft
revision, and applying a new adapter opens its workbench beside the panel. Credentials and
webhook secrets go in the form, never the chat; the assistant never sees them and
does not repeat text that looks like one. Running the gating test, deploying,
activating devices and resetting a cursor stay with the person; the assistant offers
a button to the step instead. Existing adapter conversations continue as onboarding
conversations (`scope=adapter` is accepted as an alias for one release).

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
is copied into the node, so later boundary edits do not update it. A draft can be as
large as a workflow (262,144 characters). The model sees each geometry as a reference
with its point count and bounds, which the server swaps back for the draft's
coordinates when it validates a proposal, and at most 30,000 characters of draft
(`assistant.max_draft_characters`). Other limits: six recent exchanges, no file uploads.

The editor keeps a binding to the configuration it was saved with, but a proposal must
use each device's current configuration. The assistant is told which draft bindings are
outdated, and a preview with one names the binding role, so the model refreshes it from
the device first. A draft whose device was deleted is refused with the binding's role;
rebind it in the editor. Each new automation has its own conversation; once saved, its
conversation continues when the automation is reopened.

Models copy values loosely, so the preview completes bindings the way the editor writes
them ([`WorkflowProposalService`](../../apps/api/app/Domain/Assistant/Services/WorkflowProposalService.php)):
whole numbers sent as `"1"` or `1.0` become integers, UUIDs are lower-cased, a missing
configuration and generation become the device's applied ones (only when what is present
matches them), and a missing `fresh_seconds` takes the editor's 120. An outdated binding's
message shows what the draft had beside the current values, because the model sometimes
mistypes a character of a UUID. The runtime compiler names the binding field it rejects.
Refused tool calls are logged as "Automation assistant tool refused" with their messages.

"Email me when…" is the most common request. There is no email node: the assistant builds
one `action.alert.v1` whose condition clears (a hysteresis for "and again when it drops
below…"), and recipients are chosen in the automation's notification settings. The editor
links there as **Alert email** once a saved draft raises alerts, and so does the activation
review.

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

The provider is OpenAI or Anthropic. Super administrators choose it in the admin app
(**AI assistant**, spec 010): the provider and model, an API key per provider, and the
daily and per-reply limits, with a **Test connection** button that sends one short
request without saving. Saved settings apply to the next reply, with no restart.
Keys are stored encrypted with the application key, are never returned (only their
last four characters), and are redacted from provider errors and logs. Every change
records an `assistant.settings.updated` or `assistant.provider_key.removed` audit
event without the key.

Until something is saved, the server environment applies. Configure it on the server
only (root `.env` for Compose, `apps/api/.env` for host processes); never in a `VITE_`
variable:

```dotenv
IOT_ASSISTANT_ENABLED=true
IOT_ASSISTANT_PROVIDER=openai        # or anthropic
IOT_ASSISTANT_MODEL=                 # empty: the provider's default model
OPENAI_API_KEY=...
OPENAI_STORE=false
ANTHROPIC_API_KEY=
IOT_ASSISTANT_DAILY_BUDGET_USD=0.50
IOT_ASSISTANT_RUN_BUDGET_USD=0.04
IOT_HELP_AI_ENABLED=false
```

`IOT_ASSISTANT_ENABLED` and `IOT_HELP_AI_ENABLED` stay in the environment; the admin
page says when the assistant is switched off. Saved keys fall back to the
environment key when removed, and the active provider's only key cannot be removed.

- The selectable models and their prices per million tokens are listed in
  [`config/assistant.php`](../../apps/api/config/assistant.php): OpenAI GPT-5.4 mini,
  and Anthropic Claude Opus 5.5 (the Anthropic default), Sonnet 5.5 and Haiku 5.5.
  Adding a model means adding it there with its prices. Each run is priced with the
  model that served it; a model set in `IOT_ASSISTANT_MODEL` that is not listed is
  priced at the provider's most expensive listed model.
- Each agent sends only its provider's request options: OpenAI gets low reasoning
  effort, no parallel tool calls and `store=false`; Anthropic gets effort `low`,
  no parallel tool use and room for thinking tokens (`max_tokens` 8000).
- Runs go through the `assistant` database queue and `assistant-worker`
  (180 s retry window, 120 s timeout), with idempotency keys, cancellation and
  recovery of stuck reservations (`php artisan assistant:recover`, scheduled every
  minute).
- The server reserves the per-reply limit before queueing and records reported usage
  afterwards. These are **application guards, not provider billing caps**; keep
  provider-side limits. Unknown usage after a failure is charged at the reservation.
  The budget is one shared daily allowance, not per organization.
- `store=false` disables OpenAI Responses API storage; it does not imply zero provider
  retention. Selected content is sent to the provider, and the portal names it.

There is no MCP endpoint. A future one must establish the same authenticated actor
and organization as the REST API.

## API

`/api/v1/organizations/{organization}/assistant`: `settings`; `conversations`
(list, create with `scope`, read, delete); `conversations/{c}/messages`, `events`
(cursor-based stream), `sources` (upload and download), `proposals` and
`proposals/{p}/decision`, `runs/{r}/cancel`.
`/api/v1/organizations/{organization}/help`: `page?context=`, `articles?query=`,
`articles/{slug}`.
`settings` includes `provider` (`id`, `label`).
`/api/v1/admin/assistant-settings` (super administrators): `GET`, `PUT` (with
`revision`; 409 when stale), `DELETE keys/{provider}`, `POST test` (6 a minute).
