# Feature Specification: Assistant Provider Settings in Admin

**Feature Branch**: `feat/assistant-provider-settings`

**Created**: 2026-10-15

**Status**: Draft

**Input**: "We use an OpenAI key for the AI assistant and want to switch to Claude. The
provider should be easily swappable, and configurable from the admin panel: select the
provider and add a key from the UI."

## Context

The assistant (profile, automation and adapter assistants, Ask Help, and telemetry
diagnosis) calls OpenAI only. The provider is hard-coded in every call, the "is the
assistant configured?" checks look only for `OPENAI_API_KEY`, the spend guard prices
every reply at gpt-5.4-mini rates, and the portal tells people their files are "sent to
OpenAI". The model, key and spend limits come from server environment variables, so
changing any of them needs a redeploy, and on the pilot the per-reply limit is fixed in
the release Compose file.

Laravel AI (`laravel/ai` 1.2) already supports Anthropic with streaming, tool calls,
structured output and PDF and image attachments.

This feature lets a super administrator choose the assistant's provider and model, store
an API key for each provider, test it, and set the spend limits, from a new **AI
assistant** page in the admin app. Server environment variables remain the defaults, so
an environment that saves nothing behaves exactly as today.

**Terms**: *provider* is the AI company whose API the assistant calls (OpenAI or
Anthropic). *Model* is one of the models the platform lists for that provider, each with
its price per million input and output tokens. *Saved key* is a key stored through the
admin app; *environment key* is `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. *Spend limits*
are the existing daily allowance and per-reply allowance.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switch the assistant to another provider (Priority: P1)

A super administrator opens **AI assistant** in the admin app, chooses Anthropic, picks
a Claude model, pastes an Anthropic API key and saves. The next assistant reply in the
portal comes from Claude.

**Why this priority**: it is the request.

**Independent Test**: in the local stack, save Anthropic with a valid key, then ask the
profile assistant a question in the portal. The reply streams, and the run's recorded
cost uses the Claude model's price.

**Acceptance Scenarios**:

1. **Given** a super administrator on **AI assistant**, **Then** the page shows the
   active provider and model, each provider's key status (saved, from the environment,
   or missing, with the last four characters of a present key), the spend limits, and
   today's spend.
2. **Given** they choose a provider, **Then** the model list shows that provider's
   models with their prices and an estimate for a large reply, and warns when that
   estimate exceeds the per-reply limit.
3. **When** they save a provider with a key, **Then** the key is stored encrypted, the
   response never contains it, and one audit event records the change without the key.
4. **Given** the change, **Then** replies queued afterwards use the new provider and
   model; a reply already running finishes on the provider it started with.
5. **Given** the profile and automation assistants, **Then** their notices name the
   active provider instead of "OpenAI"; every assistant settings response, Ask Help's
   included, names it.

---

### User Story 2 - Test a key before relying on it (Priority: P1)

The super administrator presses **Test connection**. The platform sends one short
request to the chosen provider and model with the typed key (or the stored one) and
reports success with the response time, or the provider's error with the key removed.

**Why this priority**: a wrong key would switch the assistant off for every
organization; the test catches it before saving.

**Independent Test**: test with a valid Anthropic key (success, latency shown) and with
a made-up key (the provider's authentication error is shown; nothing is saved).

**Acceptance Scenarios**:

1. **When** they test, **Then** nothing is saved and no spend is recorded.
2. **Given** the provider rejects the key, **Then** the message shown contains no part of
   the key.
3. **Given** many tests in a short time, **Then** further tests are refused with 429.

---

### User Story 3 - Adjust spend limits (Priority: P2)

The super administrator raises or lowers the daily allowance and the per-reply
allowance from the same page.

**Why this priority**: Claude models cost between a tenth and five times as much as the
current model, so the limits must move with the model.

**Independent Test**: lower the daily allowance below today's spend; the next portal
request is refused with the existing "daily allowance" message.

**Acceptance Scenarios**:

1. **When** they save new limits, **Then** the next reservation uses them, and the
   operations metric `iot_assistant_daily_budget_usd` reports the saved daily limit.
2. **Given** a per-reply limit larger than the daily limit, **Then** saving is refused
   with 422.

---

### User Story 4 - Remove a saved key (Priority: P2)

The super administrator removes a provider's saved key, for example after rotating it
in the provider's console.

**Independent Test**: remove the saved OpenAI key while Anthropic is active; the OpenAI
key status reads "from the environment" or "missing".

**Acceptance Scenarios**:

1. **When** they remove a saved key, **Then** the provider falls back to its environment
   key, if any, and one audit event records the removal.
2. **Given** the provider is active and has no environment key, **Then** removing its
   saved key is refused with 422, because it would switch the assistant off.

### Edge Cases

- Nothing saved: provider, model, key and limits come from the environment exactly as
  today (`IOT_ASSISTANT_PROVIDER` defaults to `openai`).
- Switching to a provider with no saved or environment key is refused with 422.
- A model the platform does not list is refused with 422; a model set by
  `IOT_ASSISTANT_MODEL` that is not listed is used as is and priced at the provider's
  most expensive listed model.
- Two super administrators saving at once: the second save is refused with 409 and the
  page offers to load the saved settings, as Retention does.
- `IOT_ASSISTANT_ENABLED=false`: the page still saves settings and says the assistant is
  switched off on this server; the switch stays in the environment (Constitution V).
- A platform administrator who is not a super administrator does not see the page, and
  every endpoint refuses them with 403.
- Provider errors in logs and in the test result never contain a saved or environment
  key.
- A conversation started on one provider continues on the other after a switch; the
  stored history is provider-neutral.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Only super administrators MAY read or change assistant settings, remove
  keys or test connections; everyone else gets 403.
- **FR-002**: The assistant MUST resolve its provider, model, key and spend limits from
  saved settings first and the server environment second, on every run, so a change
  applies without a restart.
- **FR-003**: The platform MUST list, per provider, the selectable models with their
  input and output prices per million tokens, and MUST price each run with the model
  that served it.
- **FR-004**: Keys MUST be stored encrypted with the application key, MUST never be
  returned by the API, and MUST be redacted from provider error messages.
- **FR-005**: `GET /api/v1/admin/assistant-settings` MUST return the active settings,
  where each value comes from, each provider's models and key status, and today's spend.
  `PUT` MUST save provider, model, spend limits and optionally a new key for the chosen
  provider, guarded by a revision (409 on conflict).
  `DELETE /api/v1/admin/assistant-settings/keys/{provider}` MUST remove a saved key.
  `POST /api/v1/admin/assistant-settings/test` MUST run one short request and report the
  outcome without saving.
- **FR-006**: Every saved change and key removal MUST record one audit event with no
  organization and the acting user; key values MUST NOT appear in it. A save that changes
  nothing records none.
- **FR-007**: The portal's assistant settings responses MUST name the active provider,
  and the portal notices MUST show it.
- **FR-008**: Provider-specific request options (OpenAI reasoning and storage options,
  Anthropic effort and parallel tool use) MUST be sent only to the provider they belong
  to.
- **FR-009**: The admin app MUST offer the **AI assistant** page to super
  administrators only, and `/me` MUST expose a `manage_assistant` capability.
- **FR-010**: The release Compose file MUST pass `ANTHROPIC_API_KEY`,
  `IOT_ASSISTANT_PROVIDER`, `IOT_ASSISTANT_MODEL` and `IOT_ASSISTANT_RUN_BUDGET_USD`
  through, and the OpenAPI contract and `packages/api-client` MUST describe the new
  endpoints.

### Key Entities

- **Assistant settings** (one platform row): provider, model, daily limit and per-reply
  limit (each nullable, meaning "use the environment"), revision, last editor.
- **Provider key** (one row per provider): provider, encrypted key, last editor, time
  saved.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the local stack, a super administrator switches the assistant from
  OpenAI to Anthropic from the admin app, and a portal assistant reply and an Ask Help
  answer come back from Claude, with no environment change or restart.
- **SC-002**: With nothing saved, the existing assistant tests pass unchanged and the
  pilot's assistant keeps using its environment OpenAI key after the deploy.
- **SC-003**: The API tests for every acceptance scenario and edge case above pass on
  PostgreSQL, and the admin Playwright test covers US1, US2 and the super-administrator
  gate.

## Assumptions

- Only super administrators manage the settings, as only they manage the platform team:
  a key spends the operator's money for every organization.
- The listed models are OpenAI gpt-5.4-mini and Anthropic Claude Opus 5.5, Sonnet 5.5
  and Haiku 5.5. Adding a model is a config change with its prices.
- Anthropic requests use effort `low` for these chat-style replies, matching the
  OpenAI reasoning effort `low` used today.
- The assistant's on/off switch (`IOT_ASSISTANT_ENABLED`) and Ask Help's switch stay in
  the environment.
- Limits stay one shared daily allowance for the platform, not per organization.
- The connection test does not count against the daily allowance; it is rate-limited
  instead.
