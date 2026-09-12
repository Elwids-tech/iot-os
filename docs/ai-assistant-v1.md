# AI assistant v1

Status: implemented and locally verified on 2026-09-08. Scope is a personal assistant in the tenant portal, with device-profile authoring as its first capability.

## Experience

Open **Assistant** from the portal header. The desktop panel stays open across navigation; mobile uses a sheet. Start a new profile conversation or open a profile and choose **Improve the profile I’m viewing**. Each conversation has one fixed target and belongs to its creator and organization. Switching organization cannot retarget an existing conversation.

Describe the device, paste sample data, or attach documentation. Required questions come first, followed by questions needed for requested features and optional details. Question cards offer suggestions, free text, **I don’t know yet**, and optional **Skip for now**. The agent asks up to three related questions at a time. Extracted source facts retain provenance and uncertainty so subsequent sections can use the same documentation without repeated file processing.

The assistant prepares one section at a time: identity, parameters, groups, or calculations. **Review section** opens structured fields, a comparison with existing values, evidence, validation diagnostics, and read-only JSON describing the proposed changes. Edited fields must be validated again, producing a new immutable proposal. Unresolved evidence needs explicit confirmation or correction. Closing a review preserves unsaved review fields in this signed-in session.

**Save this section** applies the exact reviewed proposal to the profile draft. Saving is blocked while a workspace form has unsaved changes. Existing forms are not reset by an assistant save; profile queries are marked stale and reload on normal navigation. **Review & publish** opens the existing publication workflow. Conversation text such as “yes” does not grant tool approval.

Optional freshness settings describe reporting expectations. They do not create offline alarms. Rule-engine design, React Flow, new alarm templates, device activation, broker connections, device commands, and publication are outside the assistant’s tools.

## Authorization and consistency

- Every endpoint checks the current user, organization membership, and device-profile capabilities. Conversations and files also require creator ownership. Worker tools repeat authorization at execution time.
- Proposals hold the original snapshot, changes, evidence, diagnostics, target revision, and content hash. Unsupported fields are rejected. Existing domain request rules, configuration validation, calculation evaluation, and profile authoring services remain authoritative.
- Preview writes are simulated inside a rolled-back transaction. They do not save a profile or advance its revision.
- Approval applies the section atomically and idempotently under database locks. The native Laravel AI approval continuation returns that saved result. A provider failure after saving cannot cause a second save or erase the audit entry.
- Stale revisions and superseded proposals cannot save. Conversation deletion keeps approved profile changes and their audit records.
- Runs have idempotency keys and an atomic queued-to-running claim. Cancellation prevents further tool execution; deletion and another response wait until an in-flight run settles. Requests recover reservations older than five minutes; `php artisan assistant:recover` also performs that recovery.

## API and MCP boundary

The authenticated REST base is `/api/v1/organizations/{organization}/assistant`. It exposes settings, personal conversation history and deletion, messages, private source upload/download, cursor-based events, section previews, proposal decisions, and cancellation. The portal uses the shared `@iot-os/api-client` contracts.

Laravel AI uses two server tools:

| Tool | Operations |
| --- | --- |
| `ProfileAssistantTools` | Schema, current/authorized profiles, sources, retained source facts, questions, section preview, validation, calculation samples |
| `ApplyProfileSection` | Apply one explicitly approved proposal with its content hash |

The action dispatcher and domain services form a shared authorization boundary suitable for a later MCP adapter. There is **no external MCP endpoint** in v1. Future MCP access must establish the same authenticated actor and organization; accepting a model-supplied user or organization is insufficient.

The application rebuilds remembered tool turns from their typed calls when resuming. This avoids Laravel AI 0.11.2 replaying a prior tool result without its call when a multi-step reasoning response pauses for approval. Regression tests include encrypted reasoning blocks and verify that every result follows its call.

## Files and retention

Supported: PDF (including scans), PNG, JPEG, WebP, text, Markdown, JSON, and CSV. Limits: 10 MiB per file, five selected files per message, 25 MiB combined, and 100 PDF pages. Content MIME must match the extension. PDFs must be readable and unlocked. Select only relevant pages for best cost and accuracy.

Files are private, named with generated IDs, and served through authorized downloads. The API and assistant worker share the `assistant-private` volume. Container builds exclude private storage and environment files. Text samples are supplied as bounded excerpts; PDF/image inputs use Laravel AI attachments. Historical binary attachments are omitted from subsequent requests; retained facts provide continuity, and sources can be selected again when needed.

Conversations and uploads stay until their creator deletes the conversation. The provider is configured with `store=false`; this disables Responses API storage and does not imply zero provider abuse-monitoring retention. Selected source content is sent to OpenAI. Files, tool results, and quoted text are treated as evidence, not instructions.

## Local setup and cost controls

Use the existing ignored root `.env` for Compose, and `apps/api/.env` for host-side development. Never commit a key or put it in a `VITE_` variable.

```dotenv
OPENAI_API_KEY=your-server-side-key
OPENAI_STORE=false
IOT_ASSISTANT_ENABLED=true
IOT_ASSISTANT_MODEL=gpt-5.4-mini-2026-03-17
IOT_ASSISTANT_DAILY_BUDGET_USD=0.50
IOT_ASSISTANT_RUN_BUDGET_USD=0.04
```

The default model uses low reasoning effort, at most five tool steps, and 1,800 output tokens per step. Automatic SDK conversation-title generation is disabled. Costs are estimates using $0.75 per million input tokens and $4.50 per million output tokens, conservatively counting cached input at the normal rate. Update the estimator when changing models.

The server reserves an allowance before queueing and records reported usage afterward. These are application budget guards, **not a provider-enforced hard billing cap**: usage arrives at the end of a response, attachments can increase input tokens, and interrupted requests can lack complete usage. Keep provider-side limits in place and use small source excerpts. Unknown usage after a worker interruption is conservatively charged against the reservation.

The dedicated database `assistant` queue has a 180-second retry window and a 120-second worker timeout. Existing synchronous jobs retain their previous behavior. Run the existing Compose overlays with `api assistant-worker portal admin` to rebuild this feature. The API image includes `pdfinfo`, matching PHP upload limits, and `pcntl` for worker timeouts.

## Verification

Backend tests fake AI or the OpenAI HTTP transport; no credit is used by automated tests. Coverage includes creator/tenant isolation, revoked access, hash and revision checks, preview rollback, approval idempotency, section authoring, referenced-input protection, retained facts, private uploads/deletion, cancellation, budgets, stale-worker recovery, native approval, and provider failure after a save.

Frontend tests check streamed-event deduplication and evidence handling. Browser verification uses a separate tab and a synthetic bench-test profile; it must cover navigation persistence, structured questions, editable review, read-only JSON, unsaved-form protection, saved draft markers, desktop/mobile rendering, and the separate publication path.

Local verification does not deploy this feature to production.

### Local verification results — 2026-09-08

- Full API suite: **95 tests, 953 assertions passed**. Frontend: **10 tests passed**. PHP style checks, TypeScript builds, and whitespace checks passed.
- Rebuilt and recreated `api`, `assistant-worker`, `portal`, and `admin` using the existing Devices Compose overlays. Databases, runtime, broker, and simulator state were preserved.
- Verified the served portal at `http://localhost:5173` at 1600×1000 and 390×844. The assistant panel and review dialog had no Axe accessibility violations in the checked states. Fixed an inherited input-group selector that dimmed an enabled composer when its Send button was disabled.
- Verified an unsent message survives navigation; a workspace form's unsaved edit blocks assistant saving and remains intact; edited review fields survive closing/reopening; revalidation returns a new reviewable proposal; JSON is read-only; and the review dialog remains usable when switching viewport size.
- Live OpenAI smoke test used a synthetic one-page scanned PDF. The agent extracted the exact identity and retained 11 source facts, collected required parameter answers, saved a temperature measurement, and successfully resumed after approving an edited category proposal. The reasoning/tool replay defect discovered during this test has a mocked regression test.
- Conservative estimated OpenAI usage for all live testing: **$0.049219**. No AI runs remained active. This is estimated usage, not a provider balance reading.
- Deleted the temporary conversation and its uploads through the UI. Confirmed zero remaining test conversation/source/SDK-message records and private files; the three approved profile audits remained.
- The clearly named **Assistant QA Temperature Probe** remains in Acme Manufacturing as draft revision 3 for inspection. It has one Celsius measurement, no writable command, no reporting freshness configuration, and no alarm templates. Nothing was published or activated.

The default history view returns the 100 most recently updated conversations. File extraction quality and model suggestions still require the user's review; the live test establishes the scanned-PDF path, not accuracy for every vendor document.
