# Quickstart: Validating the Dashboard Assistant

How to prove the feature works, from automated checks to the running stack. Interfaces
are described in [contracts](contracts/); data in [data-model.md](data-model.md).

## Prerequisites

- The local stack with simulated devices (`./taskw devices:setup`, `./taskw devices:up`),
  including at least one energy meter (counter), one device with a ranged temperature,
  one with a boolean or enum, and one RGB light (writable colour).
- The assistant enabled with a provider key (`IOT_ASSISTANT_ENABLED=true`, a key saved in
  admin **AI assistant** or in the server environment) and a per-reply limit high enough
  for the chosen model (see research R16).
- Two people in one organization: one with `Dashboard.create` (Moderator or Admin) and
  one Member (`Dashboard.view` only). A second organization for isolation checks.

## A. Automated checks

```bash
cd apps/api && php artisan test --compact --filter='PanelSuggestionsContract|DashboardAssistant|DashboardTest|DashboardAccessTest|WorkflowAssistantTest|AssistantTest'
```

Expected: parity cases pass in PHP; dashboard assistant feature tests cover scope
access, cross-organization 404s, tool refusals, claims lint, validation parity with
`DashboardDefinition`, create-once idempotency, `dashboard_panels` re-validation, 409/410
paths, unmet counts and the revision `origin`. Existing dashboard and assistant tests pass
unchanged.

```bash
pnpm --filter @iot-os/portal test
```

Expected: `suggest.test.ts` passes the same fixture cases; band range wording and the
tone colour mapping pass.

```bash
pnpm --filter @iot-os/portal lint
```

Expected: `tsc` and the design-system guardrails pass.

```bash
cd apps/portal && rtk proxy npx playwright test e2e/dashboard-assistant.spec.ts e2e/dashboards.spec.ts e2e/help.spec.ts e2e/support.spec.ts
```

Expected (mocked API): entry points shown or hidden by permission and assistant state;
proposal shown at full size beside the rail; **Create dashboard** opens the new
dashboard; edit-mode proposal panels marked **Proposed**, added with **Add to
dashboard**, removed with **Undo**, not saved until **Save dashboard**; **Ask the team
for this panel** opens a pre-filled ticket; **Set up an alert** opens the automation
assistant with the request waiting; a 390 px sheet with **Review dashboard**.

## B. Rebuild and run

Rebuild `api`, `assistant-worker` and `portal` with the command in
[local setup](../../docs/dev/local-setup.md#rebuild-one-service), keeping the stack's env
files and overlays, then run the migrations in `api`.

## C. Scenarios in the running portal

1. **New dashboard (US1).** As the Moderator, open Dashboards → **Create with
   assistant**, and ask "a dashboard for the energy meters and the RGB light". Expect
   devices named before a proposal, the proposal at full size with live data beside the
   rail, and **Create dashboard** opening a dashboard owned by you, open to the
   organization, whose **Version history** says "Created with the assistant". Pressing
   **Create dashboard** twice creates one dashboard.
2. **Options (US2).** Ask "how else could I show the meter energy?". Expect at most three
   options led by Consumption, each with a reason and preview; "daily bars for the last
   30 days" replaces the proposal and the earlier one can no longer be applied.
3. **Thresholds and alert (US2, FR-012).** Ask "show the temperature red above 80". Expect
   a band labelled "80 °C and above", a note that bands only colour the panel, and **Set
   up an alert** opening a new automation with the request waiting in its assistant.
4. **Existing dashboard (US3).** Open a dashboard, enter edit mode, move a panel without
   saving, open the assistant and ask for two panels. Expect them marked **Proposed**
   below the draft; **Add to dashboard** keeps the moved panel, **Undo** removes the
   added ones, and reloading before **Save dashboard** shows the server unchanged.
5. **Not available yet (US4).** Ask "total energy of all meters per day" and "top 5
   devices by temperature". Expect an explanation, a truthful alternative, no panel
   titled "Total" or "Top", and **Ask the team for this panel** opening a Feature request
   with a title and description you can edit. `GET /internal/ops/metrics` shows
   `iot_assistant_unmet_requests{category="cross_device_total"}` and `{category="ranking"}`.
6. **Access.** As the Member, the Dashboards page offers no assistant entry point and an
   existing dashboard's view mode offers none. Switching the assistant off hides every
   entry point and dashboards still work; a proposal prepared before it was switched off
   can still be applied.
7. **Unsaved edits.** With unsaved edits in the editor, applying a proposal keeps them
   (preserve your own edits while verifying, per AGENTS.md).

## D. Evaluation

```bash
cd apps/api && php artisan assistant:evaluate-dashboards --organization=<slug> --user=<id>
```

Expected: every out-of-model request reported as unmet with its category; no proposal
refused for claims at the end of a request; at least 90% of in-model requests reach a
proposal within three replies; the cost per request reported per model. Record the
results in the pull request.
