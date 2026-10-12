# Contract: Organization context (internal interface)

The interface that request, job, worker, scheduler, runtime and assistant code uses to
act within one organization. PHP namespace: `App\Domain\Authorization\Tenancy`. Paths are
relative to `apps/api/`. Design: [research.md](../research.md) D1 to D5.

## `OrganizationContext`

The container binds it with `scoped()`, so it lives for one request or one queued job.

| Method | Behaviour |
| --- | --- |
| `run(Organization $organization, Principal $principal, Closure $callback): mixed` | The **only** way to act as an organization (FR-016). Sets the permission registrar's team to `$organization->id`, enters organization mode, calls `$callback`, then restores the previous mode, organization, principal and team in `finally`. It nests. |
| `platform(PlatformWork $work, Closure $callback): mixed` | Runs declared platform-wide work: global scopes do not filter, and `TenantTable` allows every organization. It nests; `run()` inside it acts as one organization. |
| `organization(): Organization` | The acting organization; throws `MissingOrganizationContext` outside organization mode |
| `principal(): Principal` | The acting principal; throws when there is none |
| `isPlatform(): bool` / `work(): ?PlatformWork` | Platform mode and its declaration |
| `snapshot(): PermissionSnapshot` | The acting principal's snapshot for the acting organization, built once |
| `snapshotFor(Organization $organization): PermissionSnapshot` | For endpoints that span organizations (`/me`, notification centre, recipients); built once per organization |
| `refresh(): void` | Drops memoized snapshots. Each assistant tool call uses it. |

`MissingOrganizationContext` extends `LogicException`. It is a programming error,
reported as a 500 and logged with the model or table that was touched. It is never
shown to tenants as a 404.

## `Principal`

`Principal::user(User)`, `Principal::application(IntegrationApplication, PersonalAccessToken)`,
`Principal::platform(PlatformWork)`. Immutable, with `kind()`, `user()`, `application()`,
`token()` and `work()`. In a request, `user()` must equal `$request->user()`; the
snapshot asserts it, so synthetic requests built by assistant tools stay consistent.

## Entry points

| Entry point | Enters the context with | Placement |
| --- | --- | --- |
| Portal tenant routes | `EnterOrganization` (alias `organization`): the route's organization and `Principal::user` | Every `api/v1/organizations/{organization}` group, including organization administration. It runs right after authentication and before `SubstituteBindings` (`$middleware->appendToPriorityList(AuthenticatesRequests::class, EnterOrganization::class)`). |
| Integration routes | `AuthenticateApplication`: the route's organization and `Principal::application` | Same priority; an organization mismatch is 404 |
| Queued jobs | `EnterOrganizationForJob` job middleware: the job's `organization()` and `principal()` | Returned by `middleware()` on every class implementing `RunsInOrganization` |
| Platform-wide jobs | `platform($job->platformWork(), ...)` | Classes implementing `PlatformWide` |
| Worker loops, scheduler, console commands, seeders, backfills | `platform(PlatformWork::X, fn () => ... run($org, $principal, ...) ...)` | `AutomationWorker`, `WebhookWorker`, `routes/console.php`, `app/Console/Commands/*`, `database/seeders/*` |
| Runtime and adapter-manager internal routes | `platform(RuntimeSync \| RuntimeEvents \| AdapterEvents)`, then `run()` per organization touched | `RuntimeController`, `AdapterController::event` |
| Assistant tool calls | Inherited from `RunAssistant`'s context; `refresh()` at the start of each call | `app/Domain/Assistant/Tools/*` |

A route test asserts that every `api/(integration/)?v1/organizations/{organization}`
route has exactly one of `EnterOrganization` and `AuthenticateApplication`, and that
no `api/v1/admin/*` route has either. An architecture test asserts that every
`ShouldQueue` class implements exactly one of `RunsInOrganization` and `PlatformWide`.

## Job interfaces

```php
interface RunsInOrganization
{
    public function organization(): Organization;   // from the job's stored ids
    public function principal(): Principal;         // who the job acts for
}

interface PlatformWide
{
    public function platformWork(): PlatformWork;
}
```

`EnterOrganizationForJob`:

1. Loads the organization and principal in platform mode (the organization may have
   been deleted; then the job ends with no side effects).
2. Re-establishes the principal's access: a person must still be a member or hold the
   platform grant; an application must still be unrevoked.
3. Runs the job inside `run()`.

A job whose principal has lost access is deleted from the queue without running. It
logs `job.principal_lost_access` with the job class and organization id. Its domain
records the outcome as it does today, for example an alert delivery becomes
`cancelled`.

## Failure behaviour

| Situation | Result |
| --- | --- |
| Organization-owned model or `TenantTable` queried with no context | `MissingOrganizationContext` (500 in a request, failed job in a worker) |
| A `creating` hook sees an `organization_id` different from the context | `LogicException` ("record belongs to another organization") |
| A record of another organization named in a request | The not-found response ([error-responses.md](error-responses.md)) |
| A non-member in `EnterOrganization` | The not-found response |
| A member without the permission | 403, as today |

## Testing helpers

- `tests/TestCase.php` enters `PlatformWork::TestFixtures` around each test body
  outside requests, so factories and direct model calls keep working. HTTP requests
  made by the test enter their own context through the middleware.
- `withoutOrganizationContext(Closure)` runs code with no context. Background-work
  tests (SC-007) use it to prove that work enters its own context.
- `OrganizationScope::disableFor(class-string $model)` (testing only) supports the
  walker's self-test.
