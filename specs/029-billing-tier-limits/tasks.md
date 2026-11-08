# Tasks: Billing Module (specs 028 and 029)

**Input**: [spec.md](spec.md), [spec 028](../028-pricing-plans/spec.md), [plan.md](plan.md),
[research.md](research.md), [data-model.md](data-model.md),
[contracts/billing-api.md](contracts/billing-api.md),
[contracts/usage-data-points-event.md](contracts/usage-data-points-event.md),
[contracts/stripe-webhooks.md](contracts/stripe-webhooks.md), [quickstart.md](quickstart.md)

**Tests**: part of the feature:

- tenant isolation (constitution III; 028 SC-006, 029 SC-007);
- the runtime event contract (constitution IV);
- exact counting (028 SC-002, 029 SC-002, SC-003);
- verification in the rebuilt stack (constitution IX).

Write each test with its task and see it fail first. PHPUnit runs on PostgreSQL;
SQLite hides row locks, partial unique indexes and uuid errors.

**Delivery**: one phase per pull request in the plan's Delivery table. Each is based
on `main` and opened after the pull requests it needs have merged; none is stacked.
Phases whose "After" pull requests have merged may run at the same time.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task).
- **[Story]**: `028-US1`…`028-US4` are spec 028's user stories; `US1`…`US8` are spec
  029's.

---

## Phase 1: Documents pull request (PR 1)

- [X] T001 Run `/speckit-analyze` over `specs/029-billing-tier-limits/spec.md`, `plan.md` and `tasks.md` (with `specs/028-pricing-plans/spec.md`), and fix what it finds
- [X] T002 Open the documents pull request from `main` on `spec/029-billing-plan` with `specs/029-billing-tier-limits/` (plan, research, data model, contracts, quickstart, tasks, the spec's retry assumption), `specs/028-pricing-plans/plan.md`, `docs/adr/ADR-035-plans-and-allowances.md`, `ADR-036-runtime-counts-data-points.md`, `ADR-037-invoices-and-card-payments.md`, their rows in `docs/adr/README.md`, and ADR-026's "amended by ADR-035"; `./taskw lint` passes

**Checkpoint**: the design is on `main`.

---

## Phase 2: Plans and allowances, API (PR 2) — 028-US1, 028-US2, US1

**Goal**: platform administrators define plans with every allowance, assign them to
billing accounts, and override allowances per account. The organization limit comes
from the allowance.

**Independent Test**: create two plans through the API, assign one to an account with
two organizations, and override `devices`. `GET admin/billing-accounts/{account}`
shows each allowance with source `override`, `plan` or `default`. An account whose
limit was raised before the migration shows it as an override, and owner creation
still stops at it.

**As built (PR 2)**:

- `config/billing.php` holds only `defaults`. Each later pull request adds the keys it
  uses.
- Columns that reference plans are named `billing_plan_id`, not `plan_id`.
- `organization_limit` stays in the API as the resolved `organizations` allowance
  (`null` when unlimited). Writing it sets an override, or removes the override when
  the value equals the plan's or default's. The admin and portal apps only became
  null-safe here, and PR 3 replaces the field in the UI.
- Plan and allowance changes show in the account's history as `updated` entries:
  `plan`, the allowance kind, or `organization_limit` as the field.

### Foundation

- [X] T003 `apps/api/config/billing.php`:
  - `currency` (`env('BILLING_CURRENCY', 'USD')`, ISO 4217, three uppercase letters);
  - `defaults` (`alerts` null, `devices` null, `data_points` null, `organizations` 1,
    `sms` from spec 011's deployment setting or 0, `retention_days` null meaning
    platform default);
  - `invoice_due_days` 14, `retention_grace_days` 30, `usage_report_stale_seconds`
    300.

  Add `BILLING_CURRENCY` to `deploy/compose` and `deploy/release` env examples.
- [X] T004 `apps/api/app/Domain/Billing/Enums/AllowanceKind.php`, a string enum with
  cases `alerts`, `sms`, `devices`, `data_points`, `retention_days`, `organizations`.
  It has helpers `isMonthly()` (alerts, sms, data_points), `allowsUnlimited()` (every
  kind except `retention_days`) and validation bounds: `retention_days` 1–36,500,
  others `≥ 0`. Also `PlanAssignmentKind.php` (`paid`, `trial`, `trial_unpaid`).
- [X] T005 Migration `apps/api/database/migrations/2026_11_10_000000_create_billing_plans.php`
  with the tables in [data-model.md](data-model.md#plans-and-allowances):
  - `billing_plans`: uuid unique; `name` string(120) with a unique index on
    `lower(name)`; `description` text nullable; `archived_at` timestampTz nullable;
    timestampsTz.
  - `billing_plan_allowances`: `plan_id` FK cascade, `kind` string(32), `value`
    bigint nullable ("`NULL` = unlimited"); primary key `(plan_id, kind)`.
  - `billing_allowance_overrides`: `billing_account_id` FK cascade, `kind`
    string(32), `value` bigint nullable, `note` text not null, `set_by` nullable FK
    users set null, timestampsTz; primary key `(billing_account_id, kind)`.
  - `billing_plan_assignments`: uuid, `billing_account_id` FK restrict, `plan_id` FK
    restrict, `kind` string(16), `started_at`, `ended_at` nullable, `trial_ends_at`
    nullable, `end_reason` string(32) nullable, `assigned_by` and `ended_by` nullable
    FKs set null; index `(billing_account_id, started_at)`; partial unique index
    `billing_plan_assignments_open` on `(billing_account_id) WHERE ended_at IS NULL`
    via `DB::statement`.
  - The data step: for every `billing_accounts` row with `organization_limit <> 1`,
    insert an `organizations` override with that value and the note "Organization
    limit before plans". Then drop `billing_accounts.organization_limit`.
  - `down()` restores the column from overrides (default 1) and drops the tables.
- [X] T006 [P] Models in `apps/api/app/Domain/Billing/Models/`:
  - `BillingPlan` (uuid route key, `allowances()`, `assignments()`, `archived()`
    scope);
  - `PlanAllowance` (no timestamps, composite key handled with
    `updateOrInsert`/`upsert`);
  - `AllowanceOverride`;
  - `PlanAssignment` (casts, `plan()`, `account()`, `open()` scope).

  `BillingAccount` gains `planAssignments()`, `openAssignment()`,
  `allowanceOverrides()`. Remove `organization_limit` from its fillable.
- [X] T007 [P] Factories: `apps/api/database/factories/BillingPlanFactory.php` (with
  `withAllowances(array)` and `archived()` states) and
  `BillingAccountFactory::onPlan(BillingPlan)`. Replace every
  `BillingAccountFactory::limit(int)` use with an `organizations` override state of
  the same name, so existing tests keep their meaning.

### Services and HTTP

- [X] T008 [028-US1] `apps/api/app/Domain/Billing/Services/Allowances.php`:
  - `resolve(BillingAccount, AllowanceKind): array{value: ?int, source:
    'override'|'plan'|'default', note: ?string}`: the override row, else the open
    assignment's plan row, else `config('billing.defaults')`.
  - `all(BillingAccount)` for every kind, using one query for overrides and one for
    the plan.
  - `override(account, kind, ?int value, string note, User actor)` and
    `removeOverride(...)` validate with `AllowanceKind` bounds and record
    `billing_account.allowance_overridden` / `.allowance_override_removed` (from, to,
    note).
- [X] T009 [028-US1] `apps/api/app/Domain/Billing/Services/Plans.php`:
  - `create(values, actor)` and `update(plan, values, actor, ?int confirmAffected)`. A
    plan with accounts whose allowances change needs `confirmAffected === count of
    accounts on it`, else a 409 with `{affected_accounts}`.
  - `archive`, `restore`, and `delete` (409 when any assignment ever named the plan).

  Audit events `billing_plan.created|updated|archived|restored|deleted` include the
  changed allowances.
- [X] T010 [028-US2] `apps/api/app/Domain/Billing/Services/PlanAssignments.php`:
  - `assign(account, plan, actor, kind = paid)`: refused for an archived plan, a no-op
    when the plan is already the open one.
  - `remove(account, actor)`.

  Each runs in a transaction that locks the `billing_accounts` row, closes the open
  row (`ended_at`, `ended_by`, `end_reason` `changed` or `removed`) and opens the next
  at the same `$at`. Also `current(account)` and `at(account, CarbonImmutable)`. Audit
  `billing_account.plan_assigned|plan_removed`.
- [X] T011 [US1] `apps/api/app/Domain/Billing/Services/OwnerOrganizations.php::create`:
  the limit comes from `Allowances::resolve($account, AllowanceKind::Organizations)`,
  with null as unlimited. The account row lock and organization count are unchanged.
  The 422 message names the resolved limit.
- [X] T012 [028-US1] HTTP in `apps/api/app/Domain/Billing/Http/` and
  `routes/api.php`, per [contracts/billing-api.md](contracts/billing-api.md) (Plans, a
  billing account's plan and allowances):
  - `PlatformPlanController` (index with `search`, `archived`, account counts;
    store/show/update/archive/restore/destroy);
  - `PlatformBillingAccountPlanController` (PUT `plan`);
  - `PlatformBillingAccountAllowanceController` (PUT/DELETE `allowances/{kind}`);
  - FormRequests: plan `name` "required, string, max 120, unique case-insensitive";
    allowance values "integer ≥ 0 or null; retention_days 1–36500, never null"; `note`
    "required, string, max 1000";
  - Resources: `PlanResource`, `AllowanceResource`, and `BillingAccountDetailResource`
    with `plan`, `assignment`, `allowances[]`.

  All routes need `can:PlatformAdministration.manageOrganizations`.
- [X] T013 [028-US2] `Administration/Http/Requests/StoreOrganizationRequest.php` and
  `PlatformOrganizationController@store` accept `plan_uuid` (an unarchived plan) only
  together with `new_billing_account` or no account. Assign it in the existing
  transaction. (As built: `organization_limit` stays accepted and maps to the
  allowance; PR 3 removes it from `BillingAccountDialog`.)
- [X] T014 [028-US2] The admin `GET v1/admin/billing-accounts` gains a `plan` column
  and a `plan` filter (plan uuid, or `none`).
- [X] T015 `apps/api/app/Domain/Audit/Services/ActivityCatalogue.php`: the plan,
  assignment and allowance events from data-model.md, with titles.

### Tests

- [X] T016 [P] [028-US1] `apps/api/tests/Feature/Domain/Billing/PlanAdministrationTest.php`:
  - create with all six kinds; a duplicate name with different case is 422;
  - `retention_days` null is 422, and 0 or 36,501 are 422;
  - editing a plan with two accounts without `confirm_affected` is 409 with
    `affected_accounts: 2`, and with it, it applies to both;
  - an archived plan cannot be assigned but stays on accounts; restore;
  - deleting an assigned plan is 409;
  - non-administrators get 403 on every route.
- [X] T017 [P] [028-US2] `apps/api/tests/Feature/Domain/Billing/PlanAssignmentTest.php`:
  - assign, change, remove: one open row at a time, no overlap, gaps for "no plan",
    `at()` answers for past instants;
  - overrides survive plan changes;
  - resolution order override, then plan, then default for each kind;
  - organization creation with `plan_uuid` and `new_billing_account`.
- [X] T018 [P] [US1] `apps/api/tests/Feature/Domain/Billing/OrganizationLimitAllowanceTest.php`:
  - the migration data step: limit 5 becomes an override of 5, limit 1 makes no row;
  - owner creation stops at the resolved limit from the plan, from an override and at
    the default 1, and passes when unlimited;
  - concurrent owner creation at the limit still lets only one through (existing
    lock);
  - platform administrators are not bound.

  Update `BillingAccountOwnerTest` for the removed column.

### Finish

- [X] T019 `php artisan contract:export` and `contracts/openapi/supplements/billing.yaml`
  (the allowance map body and the 409 confirmation body). In
  `packages/api-client/src/billing.ts` add `BillingPlan`, `Allowance`,
  `AllowanceKind`, `PlanAssignment`, and extend `BillingAccountDetail`. In
  `src/index.ts` add `adminPlans`, `createPlan`, `adminPlan`, `updatePlan`,
  `archivePlan`, `restorePlan`, `deletePlan`, `setBillingAccountPlan`,
  `overrideAllowance` and `removeAllowanceOverride`. (As built: `organization_limit`
  stays in the types as `number | null`; PR 3 removes it from the values types.)
- [X] T020 Docs: new `docs/features/billing.md` (plans, allowances, resolution, the
  organization limit) linked from `docs/features/access.md`'s Billing accounts
  section, which loses the typed limit; `docs/dev/gotchas.md` (an account's
  organization limit is an allowance now).
- [X] T021 Verify: `php artisan test --compact`, `contract:check --base=origin/main`,
  `./taskw lint`. Rebuild `api` and the API-image services, then run quickstart
  section 1 through the API with curl or the admin app's existing pages, and confirm
  existing accounts keep their organization limit (029 SC-006).

**Checkpoint**: PR 2 is ready.

---

## Phase 3: Plans in admin (PR 3) — 028-US1, 028-US2, US1

**Goal**: administrators manage plans, assign them and override allowances in the
admin app.

**Independent Test**: [quickstart.md](quickstart.md) section 1 in the admin app.

**As built (PR 3)**:

- The API no longer accepts `organization_limit` on billing account create or update;
  the field still reads the resolved `organizations` allowance. The limit is set as an
  override (`PUT allowances/organizations`).
- Allowance sources and plan assignment kinds are `statusOf` domains (`allowance`,
  `plan_assignment`) in the kit, so the badges come from `Status`.
- A plan field left empty uses the deployment default; **Unlimited** sends `null`.
  Retention has no Unlimited switch, and empty means the platform setting.
- Deleting a plan that was ever assigned shows as a disabled menu item ("Delete: it was
  used, archive it instead"), as billing accounts do, rather than a tooltip.
- The Plans list shows current plans by default; the Status filter offers **Archived**
  and **All plans**. Archive and restore apply at once, with a toast.
- The account page applies a plan as soon as it is chosen; **Remove plan** asks first.
  Removing an override applies at once and the toast names the value it falls back to.
- `BillingPlanDetail.history` is typed as `PlanHistoryEntry` (actions `created`,
  `updated`, `archived`, `restored`).

- [x] T022 [P] [028-US1] `apps/admin/src/pages/PlansPage.tsx`: `CollectionPage` +
  `DataTable` via `useDirectoryTable`, with columns Name, Allowances (compact
  "Alerts 3 · SMS 2 · Devices 50…"), Accounts and Archived (`Status`). Search and an
  Archived filter. Row actions Edit, Archive/Restore, and Delete (disabled with a
  tooltip once assigned).
- [x] T023 [P] [028-US1] `apps/admin/src/components/PlanDialog.tsx`: name,
  description, and one `Field` per allowance kind with an **Unlimited** switch.
  Retention takes days or **Platform default**. A 409 `affected_accounts` opens a
  confirmation `AlertDialog` ("This changes N billing accounts") that resends with
  `confirm_affected`.
- [x] T024 [028-US1] `apps/admin/src/pages/PlanPage.tsx` (`/plans/:planUuid`):
  `EntityPage` with Panels Allowances, Accounts (`DataTable` linking to accounts) and
  History. Routes and nav: **Plans** after Billing accounts in
  `layout/AdminLayout.tsx`, routes in `App.tsx`.
- [x] T025 [028-US2] `apps/admin/src/pages/BillingAccountPage.tsx`:
  - a **Plan** Panel showing the current plan or **No plan**, since when, and
    **Change plan** (a `SearchableSelect` of unarchived plans, plus **Remove plan**);
  - an **Allowances** Panel listing each kind with its value, a source badge and the
    note, with **Override** and **Remove override** (`AllowanceOverrideDialog.tsx`:
    value or Unlimited, required note).

  Remove the organization limit field from `components/BillingAccountDialog.tsx`, and
  read "N of M organizations" from the `organizations` allowance in
  `BillingAccountChoice.tsx` and `BillingAccountsPage.tsx`. Then drop
  `organization_limit` from `BillingAccountValues` and from the store and update
  requests. The history already lists plan and allowance changes as `updated`
  entries; give their fields labels (`plan`, each allowance kind).
- [x] T026 [028-US2] `components/BillingAccountChoice.tsx`: under **New billing
  account**, an optional **Plan** `SearchableSelect` (default **No plan**) sending
  `plan_uuid`. `BillingAccountsPage.tsx` gains a Plan column and a Plan filter.
- [x] T027 [P] `apps/admin/e2e/billing-plans.spec.ts` (route mocks):
  - create and edit a plan, including the confirmation;
  - archive;
  - assign on an account;
  - override and remove;
  - the New organization plan choice.

  Update `apps/admin/e2e/billing-accounts.spec.ts` for the removed limit field.
- [x] T028 Verify: `pnpm --filter @iot-os/admin lint`, `test`, `test:e2e`. Rebuild
  `admin` and walk quickstart section 1 in the running app without discarding unsaved
  edits.

---

## Phase 4: Usage and alert counting, API (PR 4) — 028-US3, 028-US4

**Goal**: alerts and SMS are counted exactly against the account's allowances, with
overage and warnings. Usage is readable by administrators, owners and managers.

**Independent Test**: spec 028 US3's test. With a plan of 3 alerts, four activations
give a count of 4 with 1 overage, and every alert is still sent. Replaying a runtime
transition adds nothing. 100 concurrent `reserve` calls never exceed the SMS
allowance.

**As built (PR 4)**:

- `Usage::COUNTED` lists the kinds counted so far, alerts and SMS. Usage responses,
  the warnings and the `usage_at_least` filter follow it, so data points (PR 6) join by
  adding the kind; PR 5 adds the device count to the filter and the endpoints.
- Every usage response is `{data: Usage[]}`. `allowance` and `left` use the allowance
  now, for earlier months too; `overage` is what was fixed when counted.
- "The deployment has an SMS provider" is `services.twilio.account_sid` and
  `services.twilio.from` (`TWILIO_ACCOUNT_SID`, `TWILIO_FROM`), the settings spec 011's
  sender will use (`Usage::smsAvailable()`).

- [X] T029 Migration `2026_11_11_000000_create_billing_usage.php`:
  - `billing_usage` (pk `(billing_account_id, kind, month)`, `count` and `overage`
    bigint default 0, `updated_at`);
  - `billing_usage_shares` (pk `(billing_account_id, organization_uuid, kind,
    month)`, `organization_id` nullable FK set null, `organization_name`, `count`);
  - `billing_overage` (pk `(billing_account_id, kind, month,
    plan_assignment_id)`, with `plan_assignment_id` nullable; add a unique index with
    `NULLS NOT DISTINCT` instead of the primary key);
  - `billing_device_peaks` (pk `(billing_account_id, month)`, `peak`);
  - `billing_notices` (unique `(billing_account_id, kind, key)`, `sent_at`).

  Add `billing_usage_shares` to `OrganizationDeletion::KEPT` with
  `organization_id` set null.

  As built (PR 4): the migration is `2026_11_07_200000_create_billing_usage.php`,
  dated after PR 2's like it. SQLite, used by the local suite and `contract:export`,
  keys `billing_overage` with a unique index on `coalesce(plan_assignment_id, 0)`.
  Every table cascades with its account; `plan_assignment_id` restricts.
- [X] T030 [028-US3] `apps/api/app/Domain/Billing/Services/Usage.php`:
  - `add(BillingAccount, ?Organization, AllowanceKind, CarbonImmutable $at, int
    $quantity): array{count, overage}`:
    1. `insertOrIgnore` the totals row, then `lockForUpdate` it;
    2. resolve the allowance as of now;
    3. `overageDelta = allowance === null ? 0 : max(0, min(quantity, count + quantity -
       allowance))`;
    4. update the totals, upsert the share (with the organization name snapshot) and
       upsert `billing_overage` keyed by the open assignment at `$at`;
    5. after commit, call `UsageThresholds::check`.
  - `reserve(account, organization, sms, parts): bool` refuses when `count + parts >
    allowance`, with no overage. `release(...)` subtracts and never goes below 0.
  - `forAccount(account, month)` and `forOrganization(organization, month)` return
    the shapes in [the contract](contracts/billing-api.md#shared-shapes).

  As built (PR 4): the allowance is resolved on the account without its loaded
  relations, so a stale plan never counts. Shares and overage are read and written
  under the totals lock instead of upserted. `reserve` and `release` take an instant,
  and `release` gives parts back to the month they were reserved in. `forAccount`
  returns `MonthlyUsage` and `forOrganization` returns `OrganizationUsage` (the
  organization's own count, with the account's allowance, left and overage).
- [X] T031 [028-US3] `apps/api/app/Domain/Automation/Services/AlertProjector.php::project`:
  after the update that sets `activation_transition_id` (only for `activated`, in the
  same transaction), call `Usage::add($organization->billingAccount, $organization,
  Alerts, now(), 1)`. Use `now()`, not the transition's `occurred_at`: spec 028
  counts a late alert in the month the platform records it, so a past month never
  changes. Nothing else in the projector changes.

  As built (PR 4): in `AlertProjector::countAlert()`, skipped for an organization
  without a billing account.
- [X] T032 [028-US4] `apps/api/app/Domain/Billing/Services/Notices.php` and
  `UsageThresholds.php`. After a change, for each limited allowance passing 80% or
  100% (`count >= ceil(allowance*0.8)`, `count >= allowance`), `Notices::send(account,
  'usage_threshold', "{kind}:{month}:{80|100}", UsageThresholdMail)`. The ledger
  insert is first, and the queued job follows only if the row was inserted.
  Unlimited sends nothing; an account with no owners sends nothing.
  Also create `apps/api/app/Domain/Billing/Console/PruneBilling.php`
  (`billing:prune`, scheduled daily at 03:30 with `withoutOverlapping()` in
  `routes/console.php`). It deletes `billing_notices` older than 13 months; every
  notice key carries its month, so a pruned key can never be sent again
  (constitution VII). Later pull requests add their ledgers to it.

  As built (PR 4): thresholds are checked with `DB::afterCommit`. A count that passes
  80% and 100% at once sends both notices, as the rule reads. `billing:prune` accepts
  `--now=`.
- [X] T033 [P] [028-US4] `apps/api/app/Domain/Billing/Jobs/DeliverBillingEmail.php`
  (`ShouldQueue`, `$tries = 5`, backoff `[60, 300, 900]`, one `Mail::to()->send()`
  per owner) and `Mail/UsageThresholdMail.php` with text view
  `resources/views/billing/usage-threshold.blade.php`. It names the account, the
  allowance, used and left, and links to `/billing?account={uuid}`.

  As built (PR 4): one job per owner, so a retry never repeats another owner's email.
  It runs on the `alerts` database queue, queued in the notice's transaction like
  ticket emails, and skips someone no longer an owner or without a verified address.
  The mailable carries plain values, not models.
- [X] T034 [028-US4] Endpoints:
  - admin `GET billing-accounts/{account}/usage?month=` and `usage[]` in
    `BillingAccountDetailResource`;
  - the owner `GET v1/billing-accounts` gains `plan`, `allowances[]`, `usage[]`;
  - owner `GET v1/billing-accounts/{account}/usage`;
  - tenant `GET v1/organizations/{organization}/usage` in a new
    `OrganizationUsageController` under `ResolveOrganizationContext` with
    `Device.manage`. It returns only that organization's counts plus what is left on
    the account, and no account name, other organizations or prices.

  The admin list gains `usage_at_least=80`: any limited allowance at 80% or more,
  meaning this month's alerts, SMS or data points, or the current device count (029
  FR-026). When the deployment has no SMS provider (spec 011's configuration), owner
  and manager responses omit the `sms` kind (spec 028 edge case "SMS not
  configured"); administrators still see it.

  As built (PR 4): the owner list's `plan` is `{uuid, name}` as in the admin list; the
  trial `assignment` comes with trials. The account shape always carries
  `organizations`; the manager's leaves it out, and its `count` is the organization's
  own. The manager route reads this month only. `usage_at_least` takes 1 to 100 and
  resolves allowances in SQL as `Allowances` does.
- [X] T035 [028-US3] The SMS integration point:
  `apps/api/app/Domain/Billing/Contracts/SmsAllowance.php`, an interface with
  `reserve` and `release` bound to `Usage`. Spec 011's sender calls it before handing
  a message to Twilio. Document it in `docs/features/billing.md` and leave a note in
  `specs/011-notification-channels/` only if that folder is not frozen.

  As built (PR 4): bound in `AppServiceProvider`. The note is a new file,
  `specs/011-notification-channels/sms-allowance.md`, so spec 011's open pull request
  does not conflict.
- [X] T036 [P] [028-US3] `apps/api/tests/Feature/Domain/Billing/AlertUsageTest.php`:
  - four activations under an allowance of 3 give a count of 4 and overage 1, and
    every alert is recorded and has its email delivery;
  - replaying the same transition through `WorkflowDeploymentService` and `DagActions`
    counts once;
  - clears, acknowledgements, comments and offline alerts (spec 018) add nothing;
  - a new UTC month starts at 0;
  - a plan change mid-month applies to what is left;
  - overage rows name the open assignment.

  As built (PR 4): DAG replays call `AlertProjector::project` as `DagActions` does.
  Also: no plan with an override of 0 records overage against no assignment, and
  unlimited counts without overage or warnings.
- [X] T037 [P] [028-US3] `apps/api/tests/Feature/Domain/Billing/SmsAllowanceTest.php`:
  `reserve` within, at and over the allowance; `release`; 100 concurrent reservations
  through separate connections (`pcntl_fork` or parallel processes as in existing
  lock tests) never exceed the allowance (028 SC-002).

  As built (PR 4): 50 forked processes reserve twice each against 37 parts on
  PostgreSQL (skipped on SQLite); without the row lock all 100 went through. Also an
  allowance of 0, unlimited, and a release after the month turned.
- [X] T038 [P] [028-US4] `apps/api/tests/Feature/Domain/Billing/UsageVisibilityTest.php`
  (constitution III):
  - an owner sees organizations and usage, a non-owner gets 404;
  - a manager sees their organization only, with no account name, no other
    organization and no prices;
  - a member without `Device.manage` gets 403;
  - with no SMS provider configured, owners and managers get no `sms` kind;
  - a manager of organization A cannot read organization B's usage;
  - threshold emails: one per threshold, allowance and month, none for unlimited and
    none without owners (028 SC-005).

  As built (PR 4): also the email's content and recipients, the admin
  `usage_at_least=80` filter across plan, override and default allowances, and
  `PruneBillingTest`.
- [X] T039 Contract export, supplements and api-client (`Usage`, `UsageKind`,
  `adminBillingAccountUsage`, `ownedBillingAccountUsage`, `organizationUsage`);
  `docs/features/alerts.md` (alert allowance and overage, 028 FR-026);
  `docs/features/billing.md` (usage, warnings, SMS interface).

  As built (PR 4): no supplement was needed, since nothing new answers 409. The client
  also has `OrganizationUsage`, `usageAtLeast` on `adminBillingAccounts`,
  `BillingAccountDetail.usage` and `OwnedBillingAccount.plan`, `allowances` and
  `usage`. `docs/dev/gotchas.md` has the forked-test trap.
- [X] T040 Verify: tests, `contract:check`, `./taskw lint`. Rebuild `api` and the
  API-image services (queue workers), then run quickstart section 3 step 1 and step 4
  with workflow alerts in the running stack.

  As built (PR 4): the SQLite and PostgreSQL suites, `contract:export --check`,
  `contract:check` and `pnpm lint` pass. The API family was rebuilt from this branch;
  portal and admin were not, since the client change is types and unused methods.
  Another session recreated `api` from its own worktree a minute later, so section 3
  steps 1 and 4 ran against a container of this branch's image with the stack's
  environment and database, through the runtime's event intake: four activations
  against a plan of 3 counted 4 with 1 overage on the paid assignment, all four alert
  emails went out, replays and an offline alert added nothing, and the owner got one
  80% and one 100% email.

---

## Phase 5: Device limit (PR 5) — US2

**Goal**: active devices are counted per account. Activation at the limit is refused;
registering is not.

**Independent Test**: spec 029 US2's test, and quickstart section 2.

**As built (PR 5)**:

- Devices join the usage responses as one more entry of the `Usage` shape:
  `kind: devices`, with `peak_this_month` and `over_limit` (both only on devices),
  `overage` 0, and for an earlier month its peak as `count`.
- `DeviceConfigurationService::deactivate`, the Deactivate button's path, releases too;
  the tasks named only the lifecycle switch's.
- `billing:device-peaks` (daily 00:15 UTC) records each account's current count as at
  least the month's peak, and a release raises the peak with the count before it, so a
  month in which no claim happened still has its peak (029 FR-007).

- [X] T041 Migration `2026_11_12_000000_add_device_limit_places.php`:
  `devices.limit_place_at` timestampTz nullable, and a partial index on
  `(organization_id) WHERE limit_place_at IS NOT NULL AND deleted_at IS NULL`.
  Backfill `now()` for devices with `lifecycle = 'active'` or with an outstanding
  `device.activate.v1` operation.

  As built (PR 5): `2026_11_08_000000_add_device_limit_places.php`. Devices have no
  `deleted_at`, so the partial index is `WHERE limit_place_at IS NOT NULL`. An active
  device whose deactivation is already pending gets no place (its deactivation was
  accepted).
- [X] T042 [US2] `apps/api/app/Domain/Billing/Services/DeviceLimit.php`:
  - `claim(Device)`, called with the device row already locked:
    1. return if `limit_place_at` is set;
    2. `lockForUpdate` the device's `billing_accounts` row;
    3. count devices with a place in the account's non-trashed organizations;
    4. if the resolved `devices` allowance is not null and the count is at or above
       it, throw a 422 on `device` with the message in the contract;
    5. otherwise set `limit_place_at = now()` and raise `billing_device_peaks` for
       the month when exceeded.
  - `release(Device)` clears it. `retake(Device)` sets it without a check.
  - `count(BillingAccount)` returns the total and per organization.
  - `UsageThresholds::check` treats `devices` as a level (80% and 100% once per
    month).

  As built (PR 5): `count` is grouped by organization in SQL. `peak(account, month)`
  and `recordPeaks(at)` keep `billing_device_peaks` with an upsert that only raises.
  The warning email words devices as a level ("has reached its device limit").
- [X] T043 [US2] `apps/api/app/Domain/Devices/Services/DeviceConfigurationService.php::activate`:
  inside `locked()`, before enqueuing, call `DeviceLimit::claim($device)` when
  `limit_place_at` is null. Reconfiguring an active device holds its place and is
  never refused.
  `apps/api/app/Domain/Devices/Services/DeviceLifecycleService.php::request`: target
  `active` calls `claim`; target `inactive` calls `release` when the request is
  accepted.

  As built (PR 5): `activate` claims before the runtime validation call, so a refusal
  costs no round trip. An active device without a place (only possible from data made
  outside these paths) retakes one without a check instead of being refused.
- [X] T044 [US2] `apps/api/app/Domain/Devices/Http/Controllers/RuntimeController.php`:
  - `device.failed.v1` on a device whose `lifecycle` is not `active` calls
    `DeviceLimit::release`;
  - a failed deactivation operation calls `retake`.

  The archive action in `DeviceController` calls `release`. Organization deletion
  removes its devices, so places go with them.

  As built (PR 5): the operation's `target_state` tells a failed deactivation
  (`inactive`, retake) from a failed activation (release unless `lifecycle` is
  `active`).
- [X] T045 [US2] Device usage in the usage responses (`kind: devices`, `count`,
  `allowance`, `left`, `peak_this_month`, `over_limit`, per organization) in
  `Usage::forAccount` / `forOrganization`. The bulk onboarding item reason shows the
  422 message (check `BulkOnboarding.php:136-138`, which already stores it).

  As built (PR 5): bulk onboarding needed no change. Managers see their organization's
  devices with the account's limit, `left` and `over_limit`, not its peak.
  `usage_at_least` adds the current device count against the resolved limit.
- [X] T046 [P] [US2] `apps/api/tests/Feature/Domain/Billing/DeviceLimitTest.php`:
  - a limit of 3 across two organizations: the fourth activation is 422 and the
    device stays `registered`;
  - deactivating frees a place; reactivating at the limit is 422;
  - reconfiguring and rolling back an active device at the limit succeed;
  - `device.failed.v1` on a first activation releases; on an active device it keeps
    the place;
  - archiving releases;
  - lowering the limit below the count deactivates nothing and refuses activations;
  - moving an organization with active devices into a full account deactivates
    nothing;
  - the peak is recorded;
  - the refusal message names no account or organization.

  As built (PR 5): also the threshold notices and the 80% list filter for devices, and
  the rollout backfill.
- [X] T047 [P] [US2] `apps/api/tests/Feature/Domain/Billing/DeviceLimitConcurrencyTest.php`:
  parallel activations on separate connections at the last place, so exactly one
  succeeds (029 SC-003). A bulk onboarding run with 5 items and one place gives 1
  activated and 4 Skipped with the reason.

  As built (PR 5): 20 forked processes claim for their own devices in two organizations
  with one place left; exactly one succeeds, and without the account row lock 10 did.
  The fork helper is now the `ForksProcesses` trait, which `SmsAllowanceTest` uses too.
- [X] T048 Docs: `docs/features/devices.md` Lifecycle (the device limit, when a place
  is held), `docs/features/billing.md`, `docs/dev/gotchas.md` (a place is held from
  acceptance, not runtime confirmation). Contract export and api-client types for
  device usage.

  As built (PR 5): no supplement was needed: the activate and lifecycle routes already
  document their 422. `UsageKind` gains `devices`; `Usage` gains `peak_this_month` and
  `over_limit`, `OrganizationUsage` gains `over_limit`.
- [X] T049 Verify: tests, `contract:check`. Rebuild `api` and run quickstart section 2
  with simulated devices and a bulk onboarding run.

  As built (PR 5): the SQLite and PostgreSQL suites and `contract:check` pass. The API
  family was rebuilt; the rollout gave the dev account's 3 active devices their places.
  With the limit at 3, a bulk onboarding run of a live simulator source was skipped with
  the limit's message and activating a registered device was refused with it. With 4,
  the run activated the source, the runtime applied it, usage read 4 of 4 with peak 4,
  and accepting its deactivation freed the place. The dev stack had one free matching
  source, so the run had one item, not five.

---

## Phase 6: Data point counting (PR 6) — US3

**Goal**: the runtime counts every stored reading per organization and hour, reports
cumulative counts, and Laravel turns them into exact usage with overage and a
finality watermark.

**Independent Test**: spec 029 US3's test, and quickstart section 3 steps 2–3.

**As built (PR 6)**:

- `Usage::COUNTED` now ends with `data_points`, so every usage response, the warnings
  and the `usage_at_least` filter include them. Their entries alone carry `final`,
  `reported_at` and `stale`.
- `ReportUsage(ctx, now, since)` takes the last `final_through` written and returns the
  new one; the application keeps it between ticks, and a zero `since` is read from the
  outbox.

### Contract (constitution IV)

- [X] T050 [P] [US3] `contracts/internal/events/usage.data_points.v1.schema.json`
  (dialect and `$id` as in `device.connectivity.v1`):
  - required `schema_version` const 1, `generated_at`, `final_through`, `buckets`
    (array, maxItems 500);
  - each bucket requires `organization_uuid` (uuid), `hour` (date-time), `count`
    (integer ≥ 0) and `final` (boolean);
  - `additionalProperties: false`.

  Add `.fixture.json` and `.cases.json` (valid: empty buckets; invalid: negative
  count, missing `final`, version 2), and a `contracts/internal/catalogue.json` entry
  naming the Go producer test and the PHP consumer test.

  As built (PR 6): also an invalid case for an unknown bucket field, marked
  `tolerant_valid` because the contract is read tolerantly. The catalogue fences on
  `count` and `final_through`.

### Runtime (Go)

- [X] T051 [US3] `services/runtime/internal/storage/schema.sql`: `CREATE TABLE IF NOT
  EXISTS device_runtime.usage_data_points (organization_uuid uuid NOT NULL, hour
  timestamptz NOT NULL, count bigint NOT NULL DEFAULT 0, reported_count bigint NOT
  NULL DEFAULT 0, reported_final boolean NOT NULL DEFAULT false, PRIMARY KEY
  (organization_uuid, hour))`.

  As built (PR 6): as written.
- [X] T052 [US3] `services/runtime/internal/storage/store.go::PersistResult`:
  - keep `RowsAffected()` of each observation and diagnostic insert (lines 277–285)
    and add them up;
  - after the loop, when the sum is above 0, `INSERT … ON CONFLICT (organization_uuid,
    hour) DO UPDATE SET count = usage_data_points.count + EXCLUDED.count` with `hour
    = date_trunc('hour', now())`, in the same transaction;
  - return the stored count to callers through a new result field, without changing
    the existing boolean's meaning.

  As built (PR 6): `PersistResultCounted` returns `PersistOutcome{Stored, Readings}`;
  `PersistResult` wraps it, so its callers are unchanged. The hour is
  `date_trunc('hour', now(), 'UTC')`, so the session time zone cannot shift it.
- [X] T053 [US3] `services/runtime/internal/storage/usage.go`:
  - `ReportUsage(ctx, now time.Time)`, in one transaction:
    1. select buckets with `count > reported_count`, or `NOT reported_final AND hour <
       date_trunc('hour', now - 1 minute)`;
    2. build events of at most 500 buckets with `final = hour + 1h <= now - 1 minute`
       and `final_through = date_trunc('hour', now - 1 minute)`;
    3. insert each into `outbox` with a UUID v5 of
       `usage.data_points#{final_through}#{sha256(buckets)}` and `ON CONFLICT (uuid)
       DO NOTHING`;
    4. update `reported_count` and `reported_final`.

    It writes an event with no buckets only when `final_through` advanced since the
    last one (kept in memory, and recomputed from the latest outbox row at start).
  - `PruneUsage(ctx, now)` deletes `hour < now - 40 days`.
  - Payload types in `internal/devices/types.go`.

  As built (PR 6): `reported_count` is raised to the count that was read, with
  `GREATEST`, and the buckets are not locked, so ingestion never waits on the reporter;
  a count that grows meanwhile is sent on the next tick.
- [X] T054 [US3] `services/runtime/internal/app/application.go`: a 60-second ticker
  calling `ReportUsage` beside the heartbeat, with logged errors and a retry on the
  next tick. `PruneUsage` joins the 24-hour maintenance.

  As built (PR 6): every twelfth tick of the existing 5-second maintenance loop.
- [X] T055 [P] [US3] `services/runtime/internal/storage/usage_integration_test.go`:
  - a message with 5 readings counts 5;
  - redelivering the same telemetry UUID counts 0 more;
  - a content-match duplicate under a new UUID counts 0;
  - a calculated reading and an invalid diagnostic each count 1;
  - two organizations are kept apart;
  - the reporter emits cumulative counts, marks closed hours final, never re-emits an
    unchanged bucket, and advances `final_through`;
  - `contractstest.AssertProduced` validates the event;
  - pruning works.

  As built (PR 6): the tests read only their own organization's buckets from the
  events, because the reporter covers every organization in the shared database
  (gotchas). `historyStore`'s cleanup deletes usage buckets too.
- [X] T056 [P] [US3] A load check: `tooling/` simulator at the tested rate before and
  after the change, with ingestion-to-history latency within 5% (029 SC-004). Record
  the numbers in the pull request.

  As built (PR 6): measured on the storing transaction instead, with
  `BenchmarkPersistResult` (a ten-reading message, `persist_bench_integration_test.go`)
  against one TimescaleDB, six runs each: median 7.71 ms per message on main and
  7.95 ms with counting, +3.0%. The simulator's Python dependencies were not installed
  on the machine that built this, so no end-to-end simulator run was made.

### Laravel

- [X] T057 [US3] Migration `2026_11_13_000000_create_data_point_buckets.php`:
  `billing_data_point_buckets` (pk `(organization_uuid, hour)`, `count`,
  `billing_account_id` nullable FK, `updated_at`) and `billing_usage_watermarks` (pk
  `source` string(16), `final_through`, `reported_at`). Add the buckets table to
  `OrganizationDeletion::KEPT` (it has no organization FK, only the uuid).
  `billing:prune` also deletes buckets older than 13 months.

  As built (PR 6): `2026_11_08_100000_create_data_point_buckets.php`. The buckets table
  is not in `KEPT`: `KEPT` lists tables whose organization key sets null, and the
  inventory test fails for a table with no such key. Deleting an organization leaves
  its buckets anyway.
- [X] T058 [US3] `apps/api/app/Domain/Billing/Services/DataPointReports.php::apply(array
  $payload)`:
  1. reject `schema_version !== 1` as a permanent failure;
  2. for each bucket, `insertOrIgnore` and then `lockForUpdate`;
  3. on the first sight of a bucket, fix `billing_account_id` from the organization's
     assignment history at `hour` (`billing_account_assignments`); an unknown or
     deleted organization stays null and is not counted;
  4. if the reported count is above the stored one, `Usage::add(account,
     organization, DataPoints, hour, increase)` and raise the stored count;
  5. `final_through = greatest(stored, reported)`, and `reported_at = now()`.

  As built (PR 6): a version other than 1 or a malformed payload is a 422 for that
  event, which the batch answers on its own and the runtime dead-letters. An hour no
  assignment covers falls back to the organization's account now.
- [X] T059 [US3] `RuntimeController.php`: add `usage.data_points.v1` to the
  `eventRules()` allow-list (line 138), and a branch in `apply()` before the device
  lookup that calls `DataPointReports::apply`.

  As built (PR 6): as written.
- [X] T060 [US3] Usage responses for `data_points` carry `final` (watermark ≥ month
  end) and `reported_at`. When `reported_at` is older than
  `config('billing.usage_report_stale_seconds')`, the response says so (029 FR-014).

  As built (PR 6): `stale: true` for an open month not reported for longer than
  `BILLING_USAGE_REPORT_STALE_SECONDS` (default 300, now in `config/billing.php`), or
  never reported; a final month is never stale. Managers get the same three fields.
- [X] T061 [P] [US3] `apps/api/tests/Feature/Domain/Billing/DataPointReportsTest.php`:
  - the fixture is accepted (consumer contract assertion);
  - a replayed event changes nothing; a lower count is ignored; out-of-order events
    end at the highest count;
  - overage past an allowance of 1,000 after 1,200;
  - attribution to the account at the bucket's hour across a move;
  - the watermark only moves forward;
  - version 2 fails permanently;
  - an unknown organization is not counted;
  - an end-to-end batch through `events/batch` with other event types.

  As built (PR 6): the fixture's organization exists, so its counts are checked too;
  the finality test also covers `final` and `stale` in the usage response.
- [X] T062 Docs: `docs/reference/events.md` (`usage.data_points.v1`),
  `docs/features/billing.md` (data points, finality), `docs/features/devices.md`
  (counted readings). Contract export and api-client (`final`, `reported_at`).

  As built (PR 6): `UsageKind` gains `data_points`, and `Usage` and `OrganizationUsage`
  gain `final`, `reported_at` and `stale`. `docs/dev/gotchas.md` notes the reporter's
  shared-database trap.
- [X] T063 Verify: `go test -count=1 -p 1 ./...` with `DEVICE_TEST_DATABASE_URL`,
  `python3 tooling/verify-devices-contracts.py`, PHP tests. Rebuild `runtime` and
  `api`, then run quickstart section 3 steps 2–3 including the ten-minute `api` stop.

  As built (PR 6): the Go suite, the contract check and both PHP suites pass. The
  runtime and API family were rebuilt; live simulator readings were counted exactly (the
  runtime's bucket matched the rows stored since its restart, 66 and 66), and the API
  held exactly what the runtime last reported. With `api` stopped for four minutes, not
  ten, the reports waited in the runtime and the API caught up to the same count (234)
  within half a minute of starting. The usage response showed `final: false`,
  `reported_at` and `stale: false`, and October as final.

---

## Phase 7: Usage pages (PR 7) — 028-US4, US5

**Goal**: owners, managers and administrators see allowances, usage and freshness in
the apps.

**Independent Test**: quickstart section 4.

- [X] T064 [P] [US5] `packages/ui/src/components/allowance-meter.tsx`: props `label`,
  `count`, `allowance` (null = Unlimited), `overage`, `kind` (`monthly` | `level`),
  `freshness?` (`{reportedAt, final}`). It shows count, of-allowance or "Unlimited",
  and left or overage; the status comes from `statusOf` (ok under 80%, warning at
  80%, critical when used up); "Provisional" or "Last reported" comes via
  `Freshness`. Add a story in `apps/storybook/src/stories/AllowanceMeter.stories.tsx`
  with unlimited, 50%, 85%, over and stale states. `check-ui` passes.

  As built (PR 7): the story is `apps/storybook/src/components/AllowanceMeter.stories.tsx`,
  where the kit's stories live. The status is a `usage` domain in `statusOf` (within,
  near, used up, over the limit, unlimited) from `allowanceUse`. A `detail` slot shows
  this month's device peak. `UsagePanel`, `UsageMeters`, `UsageShares` and
  `UsageMonthSelect` in `usage-overview.tsx` (with a story) carry the month picker and
  organizations' shares that T065 and T066 both need.
- [X] T065 [028-US4] `apps/admin/src/pages/BillingAccountPage.tsx`: a **Usage** Panel
  with a month picker, `AllowanceMeter` per kind, and an organizations `DataTable`
  (name, alerts, SMS, devices, data points). The Billing accounts list gains the
  "80% or more used" filter, which covers the device limit too.

  As built (PR 7): the panel is the kit's `UsagePanel`. The month picker offers this UTC
  month and the eleven before it. The list's Usage filter also offers **Used up**
  (`usage_at_least=100`).
- [X] T066 [028-US4] `apps/portal/src/billing/BillingAccountsPage.tsx`: the selected
  account becomes an `EntityPage` with Panels **Plan** (name and since when),
  **Usage** (`AllowanceMeter`s, organizations' shares, month picker) and
  **Organizations** (the existing table). It keeps `?account=`.

  As built (PR 7): the owner's account `plan` gains `since`. The Plan panel lists the
  allowances, so the retention period shows there (FR-023).
- [X] T067 [US5] `apps/portal/src/settings/Usage.tsx` and a `usage` section in
  `settings/Settings.tsx`, spread in only when
  `useDeviceOrganization().capabilities.manage`. It shows this organization's devices,
  data points, alerts, SMS and retention with source, and what is left on the account,
  from `organizationUsage`. There is no account name.

  As built (PR 7): `organizationUsage` returns `{usage, retention}`; the manager
  response gains `retention` (days, source and pending reduction). The section shows
  the organization's own count and what is left on the account, never the account's
  count.
- [X] T068 [028-US4] `NotificationsList` in `apps/portal/src/alerts/NotificationSettings.tsx`
  (the **Settings → Notifications** section): a Panel above the list with the alert
  and SMS allowances and this organization's usage, from the same endpoint (028
  FR-022). SMS is hidden when the response omits it.

  As built (PR 7): the Panel shares `OrganizationAllowances` with Settings → Usage, and
  notes that SMS stops at its allowance only when SMS is present.
- [X] T069 [P] [US5] Help: `apps/api/resources/help/billing-usage.md` (front block
  with `contexts` for the usage settings page) and an entry in `contexts.json`; a
  paragraph in `apps/api/resources/help/alert-notifications.md` about the alert
  allowance. Set `helpContext` on the Usage section.

  As built (PR 7): the context is `billing.usage`, from the `settings/usage` path
  (embedded settings sections take their help context from the path, not a prop).
- [X] T070 [P] Playwright: `apps/portal/e2e/billing-usage.spec.ts` (owner panels,
  manager Settings → Usage without the account name, the section hidden without
  `Device.manage`, the stale freshness note) and admin Usage panel cases in
  `apps/admin/e2e/billing-accounts.spec.ts`.

  As built (PR 7): six portal cases (owner panels and an earlier month, the stale note,
  manager Settings → Usage with axe, hidden without `Device.manage`, the Notifications
  panel with and without SMS, axe and phone width) and two admin cases (the Usage
  panel and an earlier month, the 80% filter). The existing billing cases moved to the
  entity page.
- [X] T071 Verify: `pnpm --filter @iot-os/portal lint`, `pnpm --filter @iot-os/admin
  lint`, unit and e2e tests. Rebuild `admin` and `portal`, then run quickstart section
  4 as owner, manager and member.

  As built (PR 7): lint, kit and portal unit tests, the portal's mocked specs against a
  build (172) and admin e2e (58) pass, as do both PHP suites. The API family, admin and
  portal were rebuilt (the runtime too, see below), and quickstart section 4 ran
  headless against the stack:
  - The owner saw the plan with its start, the allowances, the meters (alerts used up
    with 2 of overage, devices with their peak, data points provisional and freshly
    reported) and the organization's share. October came from the picker.
  - The same person as a manager saw Settings → Usage and the Notifications panel with
    the organization's counts, what is left on the account, and 400 days from the
    deployment default; SMS was absent because the stack has no SMS provider.
  - A member without `Device.manage` saw neither section, the direct address said so,
    and the API answered 403.
  - The admin account page matched, and the 80% filter listed the account.
  Checking found the runtime rebuilt for PR 8 lacked PR 6's counting; it was rebuilt
  from this branch, and counting and reports resumed. The forked-process tests now
  start late children at once instead of failing on a busy machine.

---

## Phase 8: Retention follows the plan (PR 8, after PR 4) — US4

**Goal**: retention resolves through the billing account. Billing changes that
shorten it wait 30 days, and owners are warned.

**Independent Test**: spec 029 US4's test, and quickstart section 5.

**As built (PR 8)**:

- The guard's 409 is `{message, retention: {deletion_from, organizations: [{uuid, name,
  from_days, to_days}]}}`; every guarded route documents it in
  `contracts/openapi/supplements/billing.yaml`.
- `RetentionGuard::around` takes organization ids (an account's organizations, or the
  one organization that moves) rather than accounts.
- The state contract gains `billing_account` in the retention `source` enum. The runtime
  reads only `days`, and a valid case covers it.

- [X] T072 Migration `2026_11_14_000000_create_retention_floors.php`:
  `telemetry_retention_floors` (`organization_id` FK cascade, `days` integer, `until`
  timestampTz, `reason` string(64), `warned_at` nullable, `created_at`; index
  `(organization_id, until)`).

  As built (PR 8): `2026_11_08_200000_create_retention_floors.php`.
- [X] T073 [US4] `apps/api/app/Domain/Devices/Services/RetentionService.php`:
  - `effective()` resolves organization override, else
    `Allowances::resolve(account, RetentionDays)` when not null, else platform, else
    `config('devices.default_retention_days')`;
  - `source` gains `billing_account`; add `pending_reduction` (`{days, from}`) from
    the highest active floor;
  - new `cleanupDays(Organization)` = `max(effective days, active floors)`.

  `RuntimeController::state()` sends `cleanupDays` in each retention item's `days`.
  The state contract is unchanged; add a contract-test case that the field still
  validates.

  As built (PR 8): `effective()` also returns `billing_days` (what an organization
  without an override inherits), and `update()` uses it for the cutoff when an override
  is removed. `state()` lists the contract's fields itself instead of spreading
  `effective()`, whose new fields the strict schema would refuse.
- [X] T074 [US4] `apps/api/app/Domain/Devices/Services/RetentionGuard.php::around(array
  $accounts, callable $change, string $reason)`:
  1. compute each organization's effective days in those accounts before the change;
  2. run the change;
  3. compute them after;
  4. for every organization whose days fell, insert a floor (`days` = before, `until`
     = now + `config('billing.retention_grace_days')`) and send
     `Notices::send(account, 'retention_reduction', "{organization}:{until}",
     RetentionReducedMail)`.

  Wrap `Plans::update`, `Allowances::override|removeOverride`,
  `PlanAssignments::assign|remove` and `BillingAccounts::move` (`organization_moved`).
  The API returns 409 with the deletion date and affected organizations unless
  `confirm_retention: true` (contract).

  As built (PR 8): each service takes a `confirmRetention` flag; overrides are guarded
  only for `retention_days`, plan edits only when allowances are sent. The services
  resolve the guard lazily (`app(RetentionGuard::class)`), since it depends on
  `Allowances` through `RetentionService`. Organization creation with a plan confirms by
  itself. The email is one `RetentionReducedMail` for the change and the reminder.
- [X] T075 [US4] `apps/api/app/Domain/Billing/Console/RetentionWarnings.php`
  (`billing:retention-warnings`, daily 08:00, `--now=`): floors with `until` within 7
  days and `warned_at` null send `RetentionWarningMail` to owners and set `warned_at`.
  `billing:prune` deletes expired floors.

  As built (PR 8): a floor the account undid in the meantime is marked warned without
  an email. The reminder is `RetentionReducedMail` with `reminder: true`.
- [X] T076 [US4] `apps/admin/src/pages/RetentionPage.tsx`: the source label
  "Billing account" and a pending reduction line "N days from {date}"
  (`RelativeTime`). The plan, override and assignment confirmations in the admin app
  show the deletion date and organizations from the 409.

  As built (PR 8): one `RetentionConfirmDialog` serves the plan dialog, the override
  dialog, the plan change and override removal on the account page, and the
  move-organization dialog. The pending date is absolute (`formatDateTime`), because
  `RelativeTime` only reads "… ago". The inherit switch names the billing account when
  it sets a retention.
- [X] T077 [P] [US4] `apps/api/tests/Feature/Domain/Billing/RetentionFollowsPlanTest.php`:
  - resolution order and source;
  - a plan change to 7 days gives a floor of the previous days for 30 days, and
    `cleanupDays` stays at the previous days;
  - moving back within the grace leaves nothing to delete (029 SC-012);
  - two reductions in a row keep the longest period of the last 30 days;
  - an organization override is unaffected;
  - direct changes on Settings → Retention keep today's immediate behaviour;
  - lengthening applies at once;
  - emails at the change and 7 days before, once each;
  - `/state` carries the raised days;
  - rollout leaves every organization's effective retention unchanged.

  As built (PR 8): also plan edits, account overrides and moves, and a floor undone
  before its warning. A mocked admin e2e test covers the confirmation.
- [X] T078 Docs: `docs/features/devices.md` Retention (the billing step, grace,
  pending reductions), `docs/features/billing.md`. Contract export and api-client
  (`pending_reduction`, source).

  As built (PR 8): the client also has `billing_days`, `RetentionNeedsConfirmation`
  and a `confirmRetention` argument on the five guarded methods. `docs/dev/gotchas.md`
  notes that a plan with a retention can itself need confirmation.
- [X] T079 Verify: tests, `contract:check`, admin lint and e2e. Rebuild `api` and
  `admin`, then run quickstart section 5, including a runtime restart for cleanup.

  As built (PR 8): both PHP suites, the Go suite, `contract:check`, the contract
  checker, admin lint and all admin e2e pass. The runtime, the API family and admin were
  rebuilt. On the dev account (one organization), a 7-day plan answered 409 naming the
  organization (400 to 7 days) and the deletion date, then applied once confirmed,
  emailed the owner, and showed "7 days from" with `/state` still at 400. A further move
  to a 1-day plan also kept `/state` at 400, and the runtime's cleanup after a restart
  deleted nothing (155,190 readings older than a day remained). In the live admin app
  the Retention page showed the billing source and the pending reduction, and a plan
  change opened the confirmation. The account was put back and the floors removed.

---

## Phase 9: Prices, tax and invoices, API (PR 9) — US6

**Goal**: plans carry prices, administrators set billing details and tax, and the
platform drafts, issues and corrects monthly invoices.

**Independent Test**: spec 029 US6's test, using `billing:draft-invoices --now=` and
**Draft anyway**.

- [X] T080 `composer require dompdf/dompdf` in `apps/api`. Migration
  `2026_11_15_000000_create_billing_invoices.php`, per data-model.md:
  - `billing_settings` (one row, seeded empty, `invoice_prefix` default `INV-`,
    `credit_note_prefix` default `CN-`, `revision`);
  - `billing_tax_rates` (`name` unique, `basis_points` "0–10,000", `archived_at`);
  - `billing_plan_prices` (pk `(plan_id, effective_from)`, `data_point_block_size`
    integer "≥ 1, default 1,000,000");
  - `billing_price_overrides` (pk `(billing_account_id, price, effective_from)`,
    `value` nullable);
  - `billing_accounts` gains `billing_address` text nullable, `tax_number`
    string(64) nullable and `billing_tax_rate_id` nullable FK;
  - `billing_invoices` (unique `(billing_account_id, month)`, unique `number`,
    `billing_account_id` FK restrict);
  - `billing_invoice_lines`, `billing_invoice_usage`, `billing_credit_notes` (unique
    `number`), `billing_account_credits`;
  - `billing_number_sequences` seeded with `invoice` and `credit_note` at 1.

  As built (PR 9): `billing_credit_notes` gains `applied` (the part taken off its
  invoice), so issued invoices never change; amounts are signed `bigint` where credit
  can be negative. The tax rate foreign key restricts deletion (rates are archived).
- [X] T081 [US6] Services `BillingSettings.php` (get, update with revision 409),
  `TaxRates.php` (CRUD, archive) and `Prices.php`:
  - `setPlanPrices(plan, values, actor)` writes or replaces the row for the next
    month;
  - `override(account, price, ?value, note, actor)` does the same from the next
    month;
  - `for(account, month)` resolves the plan row and the overrides in force.

  Audited.

  As built (PR 9): also `BillingDetails` (account address, tax number, rate; an archived
  rate can be kept but not newly chosen) and `Prices::overrideList` (each override this
  month and next). Audit codes `billing_plan.prices_set`, `billing_account.price_overridden`,
  `billing_account.billing_details_updated`, `billing_settings.updated` and
  `billing_tax_rate.*` are in the catalogue; price and detail changes show in the account
  and plan histories.
- [X] T082 [US6] `apps/api/app/Domain/Billing/Services/InvoiceDrafter.php`:
  - `draft(account, month, ?User actor, ?string note)`: refuses when an invoice
    exists; `usage_incomplete` when the watermark is before the month's end. Lines:
    - for each UTC day of the month, the assignment in force at 00:00; consecutive
      days per assignment make one line (`paid`: base × days / days-in-month, rounded
      half up; `trial`/`trial_unpaid`: kind `trial`, amount 0);
    - one line per `billing_overage` row with a price (alerts: quantity × alert
      price; data points: `ceil(quantity / block) ×` block price; trial assignments
      at 0 with "Not charged during trial");
    - the usage snapshot from `billing_usage_shares`.
  - `recalculate(invoice)` (drafts only) keeps adjustments.
  - `draftDue(now)`: last month, every account with an assignment overlapping it and
    no invoice, when the watermark passed the month's end.

  As built (PR 9): drafts also show the account's credit after tax as a `credit` line,
  so "Credit from CN-…" appears on the draft; issuing applies it. Overage under no plan
  is not invoiced. An administrator's draft needs a note; a month not yet started is 422.
  `waiting(month)` and `computeLines` (for SC-009) are public.
- [X] T083 [US6] `apps/api/app/Domain/Billing/Services/InvoiceIssuer.php::issue(invoice,
  actor)`, in one transaction:
  1. lock the invoice and the `invoice` sequence row, then set `number = prefix +
     zero-padded next` and increment;
  2. snapshot `operator_details` (settings) and `account_details` (name, contact,
     address, tax number);
  3. snapshot the tax rate name and basis points; compute `tax` on the subtotal
     (half up) and the total;
  4. apply the account credit balance up to the total, as a `credit` line and a
     negative ledger row;
  5. set `amount_due`, `due_at = issued_at + invoice_due_days`;
  6. if `amount_due` is 0, set `payment_status = paid`;
  7. set `status = issued`.

  After commit, send `invoice_issued` notices to the billing contact and owners, and
  dispatch the payment hook (a no-op until PR 11). Issued invoices refuse every write
  except `payment_status`, enforced in the model's `updating`.

  As built (PR 9): issuing recomputes the totals under the account's row lock first, so
  two issues cannot spend the same credit, and refuses a total below 0 (422). Numbers are
  the prefix and four digits (`INV-0001`). The payment hook is an `InvoiceIssued` event.
- [X] T084 [US6] `apps/api/app/Domain/Billing/Services/CreditNotes.php::issue(invoice,
  amount, reason, actor)`: the amount is "> 0 and ≤ total − earlier credit notes"; it
  takes a credit-note number; the amount due falls (not below 0) and the excess goes
  to `billing_account_credits`; `payment_status` becomes `credited` when nothing is
  left to pay. Notice `credit_note_issued`.

  As built (PR 9): the invoice's `amount_due` stays as issued; the credit note records
  `applied`, and `outstanding` (the API field) is the amount due less applied credit, 0
  once paid. Credit notes on a paid invoice go wholly to account credit. Emails go to the
  billing contact too, once per address (`Notices::sendWithContact`).
- [X] T085 [US6] `InvoicePdf.php` (dompdf from `resources/views/billing/invoice.blade.php`)
  and a CSV stream of the lines and usage. A credit note PDF uses the same view with a
  flag.

  As built (PR 9): an adjustment's note is the administrator's own and appears in no
  document; owners' API responses leave it and the draft note out. Emails attach the PDF,
  rendered when sent.
- [X] T086 [US6] `apps/api/app/Domain/Billing/Console/DraftInvoices.php`
  (`billing:draft-invoices`, daily 02:10, `--now=`) and `routes/console.php`. The
  waiting list: accounts due for last month without an invoice, with "waiting since"
  = the month's end.

  As built (PR 9): the waiting list is `InvoiceDrafter::waiting`, and the admin route
  marks accounts `overdue` after `BILLING_INVOICE_WAIT_DAYS` (3).
- [X] T087 [US6] HTTP per the contract (Settings and tax; Invoices, credit notes; the
  owner invoice routes for issued invoices only, drafts 404; PDF/CSV), plus `PUT
  billing-plans/{plan}/prices`, `PUT billing-accounts/{account}/prices/{price}` and
  `PATCH billing-accounts/{account}/billing-details`. The owner `GET
  v1/billing-accounts` gains `prices` (this month's and, when different, next
  month's, with overrides applied; 029 FR-030). Managers and members never receive
  prices. `BillingAccounts::delete` refuses an account with issued invoices (409,
  amending spec 023 FR-013).

  As built (PR 9): owner credit note PDFs are at
  `billing-accounts/{account}/credit-notes/{note}.pdf`; the owner `GET billing-accounts`
  also carries `latest_invoice`. Admin account detail carries `prices`,
  `price_overrides` and `billing_details`, and plans carry `prices`. Deleting an account
  with only drafts deletes them. Payments, reconcile and checkout routes are PR 11's.
- [X] T088 [P] [US6] `apps/api/tests/Feature/Domain/Billing/InvoiceDraftingTest.php`:
  - proration across a mid-month plan change, with the day at 00:00 rule;
  - overage priced per assignment with data point blocks rounded up;
  - trial days and overage at 0;
  - a plan without prices gives 0;
  - next-month price changes leave the current month alone;
  - waiting until the watermark, and draft anyway marked incomplete;
  - recalculation keeps adjustments;
  - a month with no usage still has a base price line;
  - `recompute == stored` for every line and total (029 SC-009).

  As built (PR 9): eight tests, driving `billing:draft-invoices` with travelled time and
  real `Usage::add` overage.
- [X] T089 [P] [US6] `apps/api/tests/Feature/Domain/Billing/InvoiceIssuingTest.php`:
  - numbers are sequential with no gaps under concurrent issues;
  - issued invoices refuse edits;
  - snapshots survive later changes to settings and the account;
  - tax rounding;
  - credit applied and carried;
  - credit notes over and under the amount due;
  - a 0 invoice is paid;
  - emails go once each to the billing contact and owners;
  - owners see issued invoices only, drafts 404, members 403 or 404, non-owners 404
    (029 SC-007);
  - owners see their account's prices; the manager usage route carries none;
  - an account with issued invoices cannot be deleted.

  As built (PR 9): eight tests; the concurrent issue test forks six processes on
  PostgreSQL (skipped on SQLite). Settings, tax rates, billing details, price overrides,
  PDF and CSV are covered through the API.
- [X] T090 Docs: `docs/features/billing.md` (prices, tax, invoices, credit notes),
  `docs/dev/gotchas.md` (issued invoices never change; amounts in minor units).
  Contract export, supplements (PDF/CSV responses) and api-client.

  As built (PR 9): the api-client gains the price, tax, settings, invoice and credit note
  types and methods, with document URLs for downloads. The 409s are in
  `supplements/billing.yaml`; Scramble infers the PDF and CSV responses.
- [ ] T091 Verify: tests, `contract:check`. Rebuild `api` and the API-image services
  (scheduler), then run quickstart section 6 through the API.

---

## Phase 10: Invoices in admin and portal (PR 10) — US6

**Goal**: administrators review, adjust, issue and credit invoices; owners read and
download them.

**Independent Test**: quickstart section 6 in the apps.

- [X] T092 [P] [US6] `apps/admin/src/pages/BillingSettingsPage.tsx`
  (`/settings/billing`): operator details form with `useDiscardGuard`, prefixes,
  read-only currency and "Payments on/off", and a tax rates `DataTable` with
  `TaxRateDialog.tsx` (name, percentage to two decimals, stored as basis points).

  As built (PR 10): a stale save shows "Someone else saved these settings" with **Load
  saved settings**; tax rates are edited and archived from row actions. "Payments
  on/off" is left to PR 12: the API has no payment setting until PR 11. Money and
  percentages go through the kit's new `lib/money.ts` (`formatMoney`, `parseMoney`,
  `formatBasisPoints`, `parseBasisPoints`).
- [X] T093 [P] [US6] `apps/admin/src/components/PlanPricesDialog.tsx` (opened from
  `PlanPage`; it states "Applies from {next month}") and `PriceOverrideDialog.tsx`
  plus a **Prices** Panel and a **Billing details** Panel (address, tax number, tax
  rate `SearchableSelect`) on `BillingAccountPage.tsx`.

  As built (PR 10): `PlanPage` gains a **Prices** panel (`PriceList`: this month and the
  change waiting for next month); its history moved below the accounts. The account's
  Prices panel is a `DataTable` (this month, from next month, override note) and says
  there is nothing to charge without a plan. Billing details open
  `BillingDetailsDialog.tsx` from **Edit billing details**; archived rates are not
  offered unless the account already has one.
- [X] T094 [US6] `apps/admin/src/pages/InvoicesPage.tsx` (`/billing/invoices`): tabs
  Drafts, Waiting for usage (with **Draft anyway** and a note dialog), Issued and
  Unpaid, each a `DataTable` (number, account, month, total, `Status` for payment
  status, `RelativeTime`).

  As built (PR 10): the list API gains `unpaid=1` (issued and pending or failed); a
  notice counts accounts waiting over three days. `DraftInvoiceDialog.tsx` serves
  **Draft anyway** (fixed month) and the account page's **Draft invoice** (this month
  or the twelve before), and opens the draft once its unsaved-changes guard is clear.
  Kit status domains `invoice` and `payment`; `paymentState()` reads an unpaid invoice
  past its due date as overdue.
- [X] T095 [US6] `apps/admin/src/pages/InvoicePage.tsx`: Panels Lines, Usage by
  organization, Credit notes and History. A sticky action bar with `ref={keepToastsAbove}`
  holds Recalculate, Add adjustment (`InvoiceAdjustmentDialog.tsx`), Issue (with a
  confirmation stating it cannot be changed after) and Credit note
  (`CreditNoteDialog.tsx`), plus PDF/CSV links. The account page gains an
  **Invoices** Panel. Nav: **Invoices** and Settings → **Billing**.

  As built (PR 10): the admin invoice detail gains `history` (`InvoiceHistory`, from the
  audit log: drafted, recalculated, adjustments added and removed, issued, credit notes;
  empty for owners). Totals and "Billed to" sit in the page's rail; a draft drafted
  early shows its note in a notice. Adjustments are removed from the Lines row actions.
- [X] T096 [US6] `apps/portal/src/billing/`: an **Invoices** Panel on the account (issued
  invoices and credit notes, `Status`, PDF and CSV), `InvoiceDetail.tsx` opened by
  `?invoice=`, and the plan's prices on the **Plan** Panel ("from {month}" when they
  change next month).

  As built (PR 10): credit notes have their own panel, shown when there are any; the
  invoice opens in a sheet; switching account closes it.
- [X] T097 [P] Playwright: `apps/admin/e2e/billing-invoices.spec.ts` (settings, tax
  rate, draft anyway, adjust, issue, credit note) and
  `apps/portal/e2e/billing-invoices.spec.ts` (list, detail, downloads; no drafts).

  As built (PR 10): admin four cases (settings with a stale save, tax rate, billing
  details; plan prices and an override; draft anyway to credit note; phone width);
  portal two (prices, list, credit notes, downloads, the sheet with axe; a direct
  `?invoice=` link). The existing billing specs' mocks gained prices, billing details
  and empty invoice lists.
- [X] T098 Verify: both apps' lint and tests. Rebuild `admin` and `portal`, then run
  quickstart section 6 in the apps without discarding unsaved edits.

  As built (PR 10): both apps' lint, the kit's unit tests, admin e2e (62) and portal
  mocked e2e (174, against a build) pass. The API family, admin and portal were rebuilt
  from this branch and quickstart section 6 was run in the apps, headless, as seeded
  users, so the browser pane's signed-in tenant session was left alone. The
  administrator found the saved operator details and tax rate, the plan's and the
  account's prices, and the billing details; drafted a month from the account page;
  added a charge (tax at 15%); issued it with the next number; and issued a credit
  note. The owner saw the prices, the invoice and both credit notes in the portal, and
  opened the invoice by its link; PDFs and CSVs downloaded for both. A member owns
  nothing. The credit note larger than what is owed stays covered by
  `InvoiceIssuingTest` until payments exist (PR 11).

---

## Phase 11: Card payments, API (PR 11) — US7

**Goal**: owners save cards on Stripe, issued invoices are charged or paid online,
failures are retried and reminded, and nothing is ever restricted.

**Independent Test**: spec 029 US7's test in Stripe test mode, and quickstart
section 7.

- [ ] T099 `composer require laravel/cashier:^16.9` in `apps/api`. In
  `BillingServiceProvider`, call `Cashier::useCustomerModel(BillingAccount::class)`
  and `Cashier::ignoreMigrations()`. Set `config/cashier.php` currency from
  `billing.currency` and the webhook path `stripe/webhook` under `/api`. Add
  `STRIPE_KEY`, `STRIPE_SECRET` and `STRIPE_WEBHOOK_SECRET` to the env examples with
  empty values; real keys live only in `.local/`.
- [ ] T100 Migration `2026_11_16_000000_add_billing_payments.php`:
  - `billing_accounts` gains `stripe_id` string nullable indexed, `pm_type`
    nullable, `pm_last_four` string(4) nullable, `pm_expires` string(7) nullable and
    `past_due_since` nullable;
  - `billing_payments` (unique `provider_reference`, `attempt` smallint);
  - `billing_provider_events` (pk `provider_event_id`).

  `BillingAccount` uses `Laravel\Cashier\Billable`, with `stripeName()` = name and
  `stripeEmail()` = contact email.
- [ ] T101 [US7] `apps/api/app/Domain/Billing/Services/Payments.php`:
  - `enabled()` (`cashier.secret` set);
  - `checkoutForPaymentMethod(account)`: a Checkout session `mode=setup`, customer
    created if needed, `metadata.billing_account_uuid`, success and cancel URLs
    `/billing?account=`;
  - `checkoutForInvoice(invoice)`: `mode=payment`, the amount due in minor units,
    `metadata.invoice_uuid`; 409 when paid;
  - `removePaymentMethod(account)`;
  - `charge(invoice, attempt)`: a PaymentIntent with `off_session`, `confirm` and the
    default payment method, idempotency key `invoice:{uuid}:{attempt}`; records a
    `pending` payment; a synchronous card error marks it `failed`;
  - `recordOutside(invoice, amount, note, actor)`;
  - `reconcile(invoice)`: retrieves pending PaymentIntents and applies their status.
- [ ] T102 [US7] `apps/api/app/Domain/Billing/Jobs/ChargeInvoice.php` (`ShouldQueue`,
  unique per invoice and attempt), dispatched by `InvoiceIssuer` when payments are on,
  the account has a payment method and the amount due is above 0.
- [ ] T103 [US7] `apps/api/app/Domain/Billing/Listeners/StripeEvents.php` on Cashier's
  `WebhookReceived`, per [contracts/stripe-webhooks.md](contracts/stripe-webhooks.md):
  - the ledger insert first;
  - `checkout.session.completed` (setup and payment), `payment_intent.succeeded`,
    `payment_intent.payment_failed`, `payment_method.detached`;
  - status moves forward only, and amounts are checked;
  - receipts (`receipt`) and failure emails (`payment_failed`, with the provider's
    message and a link to `/billing?account=…&invoice=…`).

  When a card is saved on a `trial_unpaid` account, call a `Trials` hook (a no-op
  until PR 13).
- [ ] T104 [US7] `apps/api/app/Domain/Billing/Console/PaymentReminders.php`
  (`billing:payment-reminders`, daily 09:00, `--now=`):
  - unpaid issued invoices on their due date and 7 days after get a reminder
    (`payment_reminder` notices keyed `invoice:{uuid}:due|due+7`) and, with a card, a
    `ChargeInvoice` attempt 2 or 3;
  - accounts with any invoice past due get `past_due_since` (kept from the first);
    accounts with none get it cleared.

  `billing:prune` also deletes `billing_provider_events` older than 30 days.

  Nothing else changes for the account's organizations (029 FR-043).
- [ ] T105 [US7] HTTP: owner `POST invoices/{invoice}/checkout`, `POST
  payment-method/checkout`, `DELETE payment-method`; admin `POST invoices/{invoice}/payments`
  and `/reconcile`; the `past_due=1` list filter; `payment_method` and
  `past_due_since` in account resources. Every payment route answers 404 when
  payments are off.
- [ ] T106 [P] [US7] `apps/api/tests/Feature/Domain/Billing/StripePaymentsTest.php`
  with Stripe's HTTP client faked (`Stripe\ApiRequestor::setHttpClient` with a stub
  client):
  - setup checkout stores the brand, last four and expiry, and never a card number
    (029 SC-011: assert no PAN-like value in the database or logs);
  - a charge on issue uses the idempotency key;
  - `succeeded` marks paid with one receipt;
  - `payment_failed` marks failed with the reason and an email;
  - replayed, duplicated and out-of-order events change nothing (029 SC-010);
  - an unsigned webhook is 403;
  - reminders and retries on the due date and 7 days after;
  - past due is set and cleared, and device activation, ingestion and alerts are
    unaffected;
  - outside payments; reconcile;
  - payments off: every route 404 and no card in responses;
  - owners only; members and non-owners refused.
- [ ] T107 Docs: `docs/ops/billing-payments.md` (Stripe account, keys in `.local/`,
  the webhook endpoint and secret, test mode, `stripe listen`), and
  `docs/features/billing.md` (payments, reminders, past due). Contract export and
  api-client.
- [ ] T108 Verify: tests, `contract:check`. Rebuild `api` and the API-image services
  with Stripe test keys from `.local/`, then run quickstart section 7 with `stripe
  listen` and the test cards, including keys removed.

---

## Phase 12: Payments in admin and portal (PR 12) — US7

**Goal**: owners manage their card and pay; administrators see payment status, past
due and act.

**Independent Test**: quickstart section 7 in the apps.

- [ ] T109 [US7] `apps/portal/src/billing/PaymentMethodPanel.tsx`: brand, last four and
  expiry; **Add card**, **Replace** and **Remove** (confirmation). Add and Replace call
  the checkout endpoint and `window.location.assign(url)`. It is hidden when payments
  are off. On return to `/billing`, the account query refetches.
- [ ] T110 [US7] Portal invoices: a **Pay** button on unpaid invoices (checkout and
  redirect); payment status via `Status` (pending, paid, failed, credited, paid
  outside); `?invoice=` from emails opens the invoice with **Pay** focused.
- [ ] T111 [US7] Admin: a **Payment method** Panel (display only) and a past due badge
  on `BillingAccountPage.tsx`; a Past due filter on `BillingAccountsPage.tsx`; on
  `InvoicePage.tsx`, a Payments Panel and **Record payment** (`RecordPaymentDialog.tsx`)
  and **Check with Stripe** in the action bar.
- [ ] T112 [P] Playwright: `apps/portal/e2e/billing-payments.spec.ts` (add card
  redirect, pay redirect, statuses, hidden when off) and admin payment cases in
  `apps/admin/e2e/billing-invoices.spec.ts`.
- [ ] T113 Verify: both apps' lint and tests. Rebuild `admin` and `portal`, then run
  quickstart section 7 through Stripe's test pages.

---

## Phase 13: Trials (PR 13, after PRs 8 and 11) — US8

**Goal**: super administrators start trials, limited or open-ended. At the end the
account is charged when a card is saved, or flagged otherwise.

**Independent Test**: spec 029 US8's test, and quickstart section 8.

- [ ] T114 [US8] `apps/api/app/Domain/Billing/Services/Trials.php`:
  - `start(account, ?plan (default current), ?CarbonImmutable endsAt, actor)`: 409
    when a trial is open; inside `RetentionGuard`; opens a `trial` assignment.
  - `change(account, endsAt?, plan?)`.
  - `end(account, reason, actor?)`: opens `paid` from the next 00:00 UTC (with a
    saved card) or `trial_unpaid` (without), and sends `trial_ended`.
  - `convert(account, actor)`: `paid` from the next 00:00 UTC.
  - `paymentMethodAdded(account)`: `trial_unpaid` becomes `paid` from the next 00:00
    UTC (wired from PR 11's hook).
  - `endDue(now)`.

  Audit `billing_account.trial_started|trial_changed|trial_ended`.
- [ ] T115 [US8] `apps/api/app/Domain/Billing/Console/EndTrials.php`
  (`billing:end-trials`, daily 00:05, `--now=`): ends due trials, then sends
  `trial_reminder` notices keyed `trial:{assignment}:7d|1d` for limited trials ending
  in 7 days and 1 day, asking for a card when none is saved.
- [ ] T116 [US8] HTTP per the contract (Trials), and `trial` with
  `new_billing_account` in organization creation. List filters `trial=active|ending|ended_unpaid`.
  The `assignment` in the owner and admin resources carries kind and end date.
- [ ] T117 [US8] Admin: on `BillingAccountPage.tsx`'s Plan Panel, **Start trial**
  (`TrialDialog.tsx`: plan, end date or **No end date**), **Change trial**, **End
  trial** and **Convert to paid**; a trial option in `BillingAccountChoice.tsx`; the
  list filters. Portal: a trial banner on the Plan Panel ("Trial until {date}" or
  "Trial") and "Add a card to keep your plan" when ending within 7 days or ended
  without a card.
- [ ] T118 [P] [US8] `apps/api/tests/Feature/Domain/Billing/TrialsTest.php`:
  - limited and open-ended trials;
  - limits and warnings apply during trials;
  - the invoice has trial days at 0 and no overage charge, with "trial ended today"
    charged from tomorrow;
  - end with a card goes to `paid` from the next day;
  - end without a card goes to `trial_unpaid`, is flagged, is uncharged, and a card
    added later charges from the next day;
  - reminders at 7 days and 1 day, once each (029 SC-008), and no trial day ever
    charged (029 SC-013);
  - extend, shorten, change plan, convert;
  - at most one open trial;
  - "was on a trial at instant X" from assignments.
- [ ] T119 [P] Playwright: `apps/admin/e2e/billing-trials.spec.ts` and the portal
  banner in `apps/portal/e2e/billing-usage.spec.ts`.
- [ ] T120 Docs: `docs/features/billing.md` (trials). Contract export and api-client.
- [ ] T121 Verify: tests and lint. Rebuild `api`, `admin` and `portal`, then run
  quickstart section 8 with `billing:end-trials --now=` and a test card.

---

## Phase 14: Wrap-up (PR 14)

- [ ] T122 Run `/speckit-converge` and add any unbuilt work as tasks; repeat until it
  reports none
- [ ] T123 [P] Cross-check docs: `docs/features/billing.md`, `access.md`, `devices.md`,
  `alerts.md`, `docs/reference/events.md` and `docs/ops/billing-payments.md` describe
  what was built; fix any drift from code
- [ ] T124 [P] Set ADR-035, ADR-036 and ADR-037 to Accepted (built in specs 028 and
  029) in their headers and `docs/adr/README.md`
- [ ] T125 Mark `specs/028-pricing-plans/` and `specs/029-billing-tier-limits/` frozen
  (constitution: specs are history) and tick the remaining tasks

---

## Dependencies

- Phase 1 merges before any implementation pull request.
- Phase 2 (PR 2) blocks everything else.
- After PR 2:
  - Phases 3 (PR 3) and 4 (PR 4) can be open together.
  - PR 4 blocks PRs 5, 6, 7 and 8. PR 8 uses `Notices` and `billing_notices` from
    PR 4.
  - PRs 5 and 6 can be open together. They both touch `Usage::forAccount`, so the
    second rebases onto `main` after the first merges.
  - PR 9 needs PRs 4 and 6 (overage, watermark).
  - PR 10 and PR 11 need PR 9.
  - PR 12 needs PR 11. PR 13 needs PR 11 and PR 8, because `Trials::start` runs
    inside `RetentionGuard`.
- Spec 011's SMS pull request needs PR 4 (T035).
- Within a phase: the migration first, then models and services, then HTTP, tests
  alongside, then contract and client, docs, and verification last.

## Parallel opportunities

- **PR 2**: T006 and T007 together after T005; T016, T017 and T018 alongside T012.
- **PR 3**: T022 and T023 together.
- **PR 4**: T033, T036, T037 and T038 together once T030 exists.
- **PR 6**: T050 (contract) and T051 together; T055 and T056 alongside T057–T059.
- **PR 7**: T064 and T069 together.
- **PR 9**: T088 and T089 alongside T085–T087.
- **PR 10**: T092 and T093 together.
- **Across pull requests**: PR 3 and PR 4 at once; PR 5, PR 6, PR 7 and PR 8 at once
  once PR 4 merges; PR 12 and PR 13 at once once PR 11 (and PR 8) merge.

## Implementation strategy

- **MVP (spec 028)**: PRs 2, 3, 4 and 7. Administrators define plans and assign them,
  alerts are counted with overage, the SMS allowance is ready for spec 011, and owners
  and managers see usage. This is everything spec 028 asked for.
- **Limits (spec 029 P1)**: PR 5 (devices) and PR 6 (data points), then PR 8
  (retention).
- **Billing (spec 029 P2)**: PRs 9–13. Invoices without payments (PRs 9 and 10)
  already replace hand-made invoices; payments (PRs 11 and 12) and trials (PR 13)
  follow.
- **If a pull request grows too large**, split it along its API and UI tasks, each
  based on `main`. Never stack.
