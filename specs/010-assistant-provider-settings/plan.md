# Implementation Plan: Assistant Provider Settings in Admin

**Branch**: `feat/assistant-provider-settings` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/010-assistant-provider-settings/spec.md`

## Summary

One service, `AssistantProvider`, becomes the only place the assistant learns which
provider, model, key and spend limits to use. It reads the saved platform settings
first and the environment second, builds a Laravel AI provider on demand with the
resolved key (`Ai::build`), prices usage by model, and redacts keys. Every call site
that hard-coded `Lab::OpenAI`, `config('assistant.model')` or the OpenAI key goes
through it.

A second service, `AssistantSettings`, serves the admin endpoints: inspect, save under a
revision, remove a saved key, and test a connection. The admin app gains an **AI
assistant** page for super administrators.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13; TypeScript, React 19

**Primary Dependencies**: `laravel/ai` 1.2.1 (OpenAI and Anthropic gateways, on-demand
providers), Laravel encrypted casts, `@iot-os/ui` (`Panel`, `ChoiceCard`, `Select`,
`Field`, `AlertDialog`)

**Storage**: PostgreSQL 17; two new tables

**Testing**: PHPUnit on PostgreSQL in CI (and locally against a throwaway
`timescale/timescaledb:2.29.2-pg17`), providers faked with `Http::fake`; Playwright with
a mocked API for admin; a manual run against Anthropic in the local stack

**Target Platform**: API, assistant worker, admin and portal (pilot release profile)

**Project Type**: web application

**Scale/Scope**: 1 migration, 2 models, 2 services, 1 controller, 1 resource, 1 admin page

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. Laravel alone talks to AI providers; the runtime is untouched. |
| II. Immutable versions | Pass. Nothing versioned is touched. |
| III. Tenant isolation | Pass. Settings are platform-wide and super-administrator only; no tenant data is read or written. The portal settings responses gain only the provider's name. |
| IV. Contracts first | Pass. New endpoints have typed resources and no pending schemas; `packages/api-client` gains the calls; no user uuid is exposed (ADR-013). |
| V. AI proposes | Pass. The assistant's switch stays `IOT_ASSISTANT_ENABLED` (default off); the tools, approvals and permission re-checks are unchanged. |
| VI. Show uncertainty | Pass. Key status says where a key comes from; a failed test shows the provider's message rather than a guess. |
| VII. Durable messaging | Pass. No events are emitted. |
| VIII. One design system | Pass. Kit `Panel`, `ChoiceCard` in a `RadioGroup`, `Select`, `Field`, `AlertDialog`; no new kit component. |
| IX. Verified where it runs | Pass. PostgreSQL CI, rebuilt `api`, workers, `admin` and `portal`, a Claude reply in the running portal. |

No ADR changes: ADR-002 assigns AI orchestration to Laravel without naming a provider,
and encrypted columns are already how adapter, webhook and Sparkplug secrets are stored.

## Design

### Configuration (`config/assistant.php`)

- `provider` from `IOT_ASSISTANT_PROVIDER` (default `openai`); `model` from
  `IOT_ASSISTANT_MODEL` (default none, meaning the provider's default model).
- `providers.<id>`: `label`, `default_model`, and `models.<model id>` with `label`,
  `input_usd_per_million`, `output_usd_per_million` and an optional `long_context`
  price (`above_input_tokens`, prices) for Haiku 5.5 above 100K input tokens.
  - OpenAI: `gpt-5.4-mini-2026-03-17` ($0.75 / $4.50).
  - Anthropic: `claude-opus-5-5` ($4 / $20, default), `claude-sonnet-5-5` ($2 / $10),
    `claude-haiku-5-5` ($0.10 / $0.50; $0.50 / $2.50 above 100K input tokens).
- `config/ai.php` already defines both providers with `OPENAI_API_KEY` and
  `ANTHROPIC_API_KEY`.

### Storage

- `assistant_settings`: `id`, `scope_key` (unique, always `platform`), `provider`,
  `model`, `daily_budget_usd`, `run_budget_usd` (nullable; null means "use the
  environment"), `revision`, `updated_by` (nullable FK to users, null on delete),
  timestamps.
- `assistant_provider_keys`: `id`, `provider` (unique), `api_key` (text, `encrypted`
  cast), `updated_by`, timestamps.

### Runtime resolution (`App\Domain\Assistant\Services\AssistantProvider`)

- `provider()`, `model()`, `key(?string $provider)`, `dailyBudget()`, `runBudget()`:
  saved value, else environment. The saved model belongs to the saved provider; an
  environment model applies only to the environment provider.
- `configured()`: `assistant.enabled` and a key for the active provider. Replaces the
  six `filled(config('ai.providers.openai.key'))` checks in `AssistantController`.
- `textProvider(?string $provider, ?string $key)`: `Ai::build([...config("ai.providers.$provider"), 'key' => $key])->name()`.
  On-demand providers are flushed between queue jobs by Laravel AI, and the name hashes
  the configuration, so a new key gives a new client. Agent fakes still apply.
- `cost(array $usage, ?string $model)`: the existing input/output token arithmetic with
  the model's prices; unlisted models use the provider's most expensive listed price.
- `redact(string $message)`: removes every saved and environment key.
- `options(string $driver, array $openAi, bool $tools)`: provider options per driver.
  OpenAI keeps today's `reasoning`, `parallel_tool_calls` and `store`. Anthropic gets
  `output_config.effort = low`, `max_tokens` of at least 8000 (thinking counts against
  it), and for agents with tools `tool_choice: {type: auto, disable_parallel_tool_use: true}`.

Call sites: `RunAssistant` (help and streamed runs, cost with the model it started
with, redaction), `TelemetryDiagnosis`, `AssistantBudget::reserve` (limits) and
`::cost` (delegates), `Operations` (daily-limit gauge), and the four agents'
`providerOptions` (`AdapterAssistant` gains `HasProviderOptions`).

### Admin API (`AssistantSettingsController`, Assistant routes)

All under `auth:sanctum`, `v1/admin/assistant-settings`, each `abort_unless($user->is_super_admin, 403)`.

- `GET` → `AssistantSettingsResource`: `enabled`, `help_enabled`, `provider`, `model`,
  `daily_budget_usd`, `run_budget_usd`, `sources` (`saved` or `environment` for each),
  `revision`, `today` (`spent_usd`, `reserved_usd`), `providers[]` (`id`, `label`,
  `default_model`, `models[]` with prices, `key` with `source` `saved` /
  `environment` / `none`, `last_four`, `updated_at`).
- `PUT` with `provider`, `model`, `daily_budget_usd`, `run_budget_usd`, `revision`, and
  optional `api_key` for that provider. One transaction: insert-or-ignore the platform
  row, lock it, 409 on a stale revision, validate that the provider has a key after the
  save (422), write, bump the revision when anything changed, and record
  `assistant.settings.updated` (before and after values, `key_replaced` provider).
- `DELETE keys/{provider}`: 422 when that provider is active and has no environment
  key; otherwise delete and record `assistant.provider_key.removed`.
- `POST test` with `provider`, `model`, optional `api_key` (`throttle:6,1`): one
  `agent()` prompt ("Reply with OK"), 20 s timeout, on the built provider; returns
  `ok`, `latency_ms` and a redacted `error`. Not charged to the allowance.

`/me` gains `capabilities.manage_assistant` (super administrators).

### Portal

The four assistant `settings` responses gain `provider: {id, label}` from
`AssistantProvider`. `AssistantPanel` and `WorkflowAssistant` name it in their notices.

### Admin app

`pages/AssistantPage.tsx` at `/settings/assistant`, in the settings group of the
sidebar, routed only when `manage_assistant`. Panels:

1. **Provider**: `ChoiceCard`s in a `RadioGroup`, each with its key status; an alert
   when the assistant is switched off on the server.
2. **Model**: `Select` of the chosen provider's models with prices; an estimate for a
   large reply (15K input, 2K output tokens) and a warning above the per-reply limit.
3. **API key**: status, a password `Input` for a new key, **Test connection**, and
   **Remove saved key** behind an `AlertDialog`.
4. **Spend limits**: daily and per-reply limits; today's spend.

Save and Discard edits at the end, the discard guard, and the Retention page's 409
"Load saved settings" recovery.

### Release

`deploy/release/compose.yml`, `deploy/compose/compose.app.yml` and
`deploy/release/environment.example` pass `ANTHROPIC_API_KEY`,
`IOT_ASSISTANT_PROVIDER`, `IOT_ASSISTANT_MODEL` and `IOT_ASSISTANT_RUN_BUDGET_USD`
(default `0.04`, as today). `tooling/release/manage.py` no longer refuses an enabled
assistant without `OPENAI_API_KEY`, since the key may be saved in admin; it checks that
`IOT_ASSISTANT_PROVIDER` is `openai` or `anthropic`.

## Project Structure

### Documentation (this feature)

```text
specs/010-assistant-provider-settings/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/api/config/assistant.php
apps/api/database/migrations/2026_10_15_000000_create_assistant_settings.php      # new
apps/api/app/Domain/Assistant/
├── Models/AssistantSetting.php, Models/AssistantProviderKey.php                     # new
├── Services/AssistantProvider.php, Services/AssistantSettings.php                    # new
├── Services/AssistantBudget.php
├── Http/Controllers/AssistantSettingsController.php                                  # new
├── Http/Resources/AssistantSettingsResource.php                                      # new
├── Http/Controllers/AssistantController.php
├── Agents/*.php, Jobs/RunAssistant.php
└── routes/api.php
apps/api/app/Domain/Devices/Services/TelemetryDiagnosis.php
apps/api/app/Domain/Authentication/Http/Resources/AuthenticatedUserResource.php
apps/api/app/Support/Operations.php
apps/api/tests/Feature/Domain/Assistant/AssistantSettingsApiTest.php                  # new
apps/api/tests/Feature/Domain/Assistant/AssistantProviderTest.php                     # new
contracts/openapi/openapi.json
packages/api-client/src/index.ts, packages/api-client/src/assistant.ts
apps/admin/src/App.tsx, layout/AdminLayout.tsx, pages/AssistantPage.tsx (new), e2e/admin.spec.ts
apps/portal/src/assistant/AssistantPanel.tsx, automation/WorkflowAssistant.tsx
deploy/release/compose.yml, deploy/release/environment.example, deploy/compose/compose.app.yml
tooling/release/manage.py
docs/features/assistant.md, docs/architecture/overview.md, apps/admin/README.md
```

**Structure Decision**: the Assistant domain owns the settings; Administration is not
changed beyond the `/me` capability.

## Delivery

One pull request based on `main` with these documents and the implementation, then the
release from `main` and the pilot deploy. After the deploy the pilot keeps OpenAI from
its environment until a super administrator saves Anthropic with a key in admin.

## Complexity Tracking

No violations.
