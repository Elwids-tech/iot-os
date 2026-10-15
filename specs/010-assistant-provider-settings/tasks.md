# Tasks: Assistant Provider Settings in Admin

**Input**: [spec.md](spec.md), [plan.md](plan.md)

All tasks land in one pull request based on `main`.

## Phase 1: Foundation

- [x] T001 Add provider, model and per-model prices to `apps/api/config/assistant.php`
- [x] T002 Migration `create_assistant_settings` with `assistant_settings` and `assistant_provider_keys`; models `AssistantSetting` and `AssistantProviderKey` (encrypted key)
- [x] T003 `AssistantProvider`: resolution (saved, then environment), `configured`, `textProvider`, `cost`, `redact`, `options`

## Phase 2: Runtime on the resolved provider (US1, US3)

- [x] T004 `RunAssistant` and `TelemetryDiagnosis` use the resolved provider and model; cost with the run's model; redact every key
- [x] T005 `AssistantBudget` reads limits from `AssistantProvider`; `Operations` reports the saved daily limit
- [x] T006 Agents send provider options per driver; `AdapterAssistant` gains them
- [x] T007 `AssistantController` checks `configured()` and returns `provider` in every settings response
- [x] T008 [P] Tests: environment defaults unchanged, saved settings win, an Anthropic streamed tool loop through an approval pause with `Http::fake`, model pricing, provider options, redaction

## Phase 3: Admin API (US1–US4)

- [x] T009 `AssistantSettings` service: inspection, update under revision with audit, key removal, connection test
- [x] T010 `AssistantSettingsController`, `AssistantSettingsResource`, routes; `/me` `manage_assistant`
- [x] T011 [P] Tests: 403 for non-super administrators, save and encryption, 409, 422 cases, audit events, key removal, test endpoint success, failure redaction and throttle
- [x] T012 Export the OpenAPI contract; `contract:export --check` and `contract:check` pass

## Phase 4: Clients (US1–US4)

- [x] T013 `packages/api-client`: types and calls for the four endpoints, `manage_assistant`, settings `provider`
- [x] T014 Admin `AssistantPage`, route and sidebar entry
- [x] T015 Portal notices name the active provider
- [x] T016 [P] Admin Playwright: the page, saving, testing, and the super-administrator gate

## Phase 5: Release and docs

- [x] T017 Release and dev Compose pass the new variables; `environment.example`
- [x] T018 Docs: `docs/features/assistant.md`, `docs/architecture/overview.md`, `apps/admin/README.md`
- [x] T019 Rebuild `api`, workers, `admin`, `portal`; switch to Anthropic in admin and get a Claude reply in the portal (SC-001)
