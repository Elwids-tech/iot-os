# ADR-038: The API Serves Requests From Laravel Octane on FrankenPHP

**Status:** Proposed
**Date:** 2026-11-08
**Relates to:** [ADR-006](ADR-006-deployment-profiles.md),
[ADR-032](ADR-032-applications-follow-a-plant.md)

## Context

The release API is two containers built from
[`Dockerfile.release`](../../deploy/docker/api/Dockerfile.release): `api` runs
php-fpm on PHP 8.4 and `api-web` runs nginx with
[`nginx.release.conf`](../../deploy/docker/api/nginx.release.conf), which passes every
request to `api:9000` over FastCGI. Caddy
([`deploy/release/Caddyfile`](../../deploy/release/Caddyfile)) terminates TLS and
proxies `api.{$DOMAIN}` to `api-web:80`. The runtime, Prometheus and the blackbox
checks also call `api-web` directly.

php-fpm boots the framework on every request. A local benchmark on 2026-11-08
compared that image with FrankenPHP 1.13.5 running Laravel Octane 2.23, which boots
the application once per worker and keeps it in memory between requests. Both used
PHP 8.4.27, 8 workers (fpm set to 8 static children), a 4-CPU cap and the dev
database; only `GET` endpoints were tested.

| Endpoint, 16 clients | php-fpm | Octane | p50 (fpm → Octane) |
| --- | --- | --- | --- |
| Device latest measurement | 174 req/s | 631 req/s | 85 → 23 ms |
| Dashboard show | 176 req/s | 623 req/s | |
| `/api/v1/me` | 130 req/s | 284 req/s | |
| Device list (2,491 devices) | 79 req/s | 135 req/s | |

- A single request on a light endpoint fell from a 27 ms to a 7 ms median, so booting
  the framework costs about 20 ms per request in this application.
- `php artisan optimize` on php-fpm alone gained only about 5–15%; the cost is the
  boot, not configuration loading.
- Idle memory rose from 69 MiB (fpm) to 142 MiB (Octane).
- A leak test alternated two users, each a member of one organization only, through
  the same workers: no leaks in about 31,000 requests, and all of about 14,800
  cross-organization requests got 403.

The gain is largest on the endpoints dashboards and applications poll most
(latest measurement, dashboard show), and it matters more once applications follow a
plant (ADR-032). The risk is the one Octane always brings: the application instance,
its singletons and static properties outlive a request, so state set for one request
can be seen by the next, which may belong to another organization (constitution
principle III).

The bench setup (a FrankenPHP Dockerfile, `laravel/octane` in Composer and
`config/octane.php`) exists only on an uncommitted benchmark branch.

## Decision

The release `api` service runs Laravel Octane on FrankenPHP and serves HTTP itself.
nginx and the `api-web` container go away once the rollout below completes.

### Image and process

- A FrankenPHP stage replaces the php-fpm stage in `Dockerfile.release`, pinned to an
  exact FrankenPHP and PHP patch release like the image it replaces, with the same
  extensions, `uploads.ini`, `release.ini`, contracts and firmware directories.
  `laravel/octane` becomes a production dependency and `config/octane.php` is
  committed.
- The same image still runs `migrate`, the queue workers and the scheduler through
  `php artisan`; only the `api` command changes, to
  `php artisan octane:frankenphp --host=0.0.0.0 --port=8000 --workers=<n> --max-requests=<n>`.
- FrankenPHP serves `public/` itself. The rules nginx enforces today move into the
  image's Caddyfile or into Octane: a 20 MB body limit, no direct `.php` access other
  than the front controller, dotfiles denied except `/.well-known/` (agent OAuth
  discovery), the 150 s request timeout, an `X-Request-Id` on every request and the
  JSON access log with the same fields (`service`, `request_id`, `method`, `status`,
  `duration`).
- FrankenPHP's own TLS and ACME stay off; it listens on plain HTTP inside the private
  network.

### Caddy front

[`deploy/release/Caddyfile`](../../deploy/release/Caddyfile) keeps terminating TLS
and keeps its rules (watchdog by private IP, `/internal/*` and `/api/internal/*`
answered with 404 from outside). Its `api` upstream changes from `api-web:80` to
`api:8000`, and so do the runtime's `DEVICE_CONTROL_URL`, the Prometheus scrape target
and the blackbox health checks in [`tooling/release/manage.py`](../../tooling/release/manage.py).
Caddy sets `X-Forwarded-Proto`; `TrustDeploymentProxies` must still trust it as the only hop.

### Worker count, `--max-requests` and memory

- Workers start at 8, the benchmarked count, and are tuned on the pilot from CPU and
  memory, not raised blindly.
- `--max-requests` recycles each worker after 500 requests at first (the bench used
  1,000), so a slow leak is bounded. It is raised only once memory per worker is seen
  to stay flat on the pilot.
- The `api` container's `mem_limit` (384 MiB today) is re-sized from measured peak
  per-worker memory × workers + FrankenPHP overhead, with headroom for a
  `memory_limit` of 256 MiB on upload requests. Each worker's resident memory is
  exported as a metric and alerted on before the container limit is reached.
- Long-lived responses hold a worker for their whole length. The ADR-032 telemetry
  stream lasts up to an hour, so streams get their own concurrency cap below the
  worker count (or their own worker pool) before that endpoint ships on Octane;
  otherwise a handful of open streams would starve every other request.

### Deploys reload workers

`manage.py` already recreates the application containers with
`up -d --force-recreate`, which replaces the Octane process and its memory with the
new image. Any deploy step that changes configuration or code without recreating
`api` (an environment-only change, a hot-fix) runs `php artisan octane:reload`
afterwards, and [`tooling/release`](../../tooling/release) gains a check that the
`api` process started after the last configuration write. `opcache.validate_timestamps=0`
stays.

### State-safety audit before the switch

The switch is blocked until each item below is checked, fixed if needed and covered
by a test. Middleware that changes request-scoped state already restores it in a
`finally`, which is the pattern to follow.

1. **Spatie `PermissionRegistrar` team ID.** `ResolveOrganizationContext`,
   `DashboardAccess` and `AuthenticateAgent` save the previous team ID, set the
   organization's, and restore it in `finally` (and unset the user's loaded roles and
   permissions). The audit finds every other caller of `setPermissionsTeamId` (jobs,
   commands, controllers, tests) and confirms none leaves a team ID set; an Octane
   `RequestReceived` listener also resets it to `null` as a backstop.
2. **`AgentContext`.** `AuthenticateAgent` binds it with
   `app()->instance(AgentContext::class, ...)` and forgets it in `finally`. It is
   added to Octane's `flush` list so a request that throws before the middleware's
   `try` cannot leave it bound.
3. **Singletons and scoped bindings in providers.** `AppServiceProvider` registers
   `UnitCatalogue` as a singleton and `PublishedParameters` as scoped;
   `ContractServiceProvider` registers the Scramble transformers and
   `ContractExporter` as singletons. Each singleton must hold only process-wide,
   tenant-free data (a catalogue, a schema), never the current user, organization,
   request or config read at construction. Scoped bindings are reset by Octane per
   request and are the default for anything request-shaped. Package providers (Spatie
   permission, Sanctum, Passport, `laravel/mcp`, Laravel AI, Cashier) get the same
   check.
4. **Static properties.** Static caches such as `ContractRegistry::$instances` are
   fine when keyed by something tenant-free and immutable for the release; any static
   that holds a model, user, organization or request is moved to a scoped binding.
5. **Write paths.** The benchmark covered only `GET`s. Every write route is reviewed
   for state left on long-lived objects (model events, observers, `Model::$...`
   statics, `DB::listen`, `Context`, `Auth::setUser` outside the guard), and the
   leak test below is extended to writes.
6. **Uploads and streamed responses in `app/Domain/Support`.** Ticket attachment
   uploads go through `TicketAttachments`, and `TicketController::attachment` and
   `AdminTicketController::attachment` return `StreamedResponse`s. The audit confirms
   uploaded temporary files are removed after each request, the 10 MB per-file and
   26 MB per-request limits still apply under FrankenPHP, and a stream's callback
   captures only its own attachment and never runs after the next request has begun.
   Any other `StreamedResponse`, download or server-sent stream gets the same check.

### A CI test that alternates organizations through one worker

A test job builds the release image, starts it with `--workers=1` and a high
`--max-requests` against the CI database, and seeds two organizations, each with one
member and devices, dashboards, tickets and agent connections of its own. It then
sends an interleaved sequence of requests (A, B, A, B, ...) through that single
worker, covering reads, writes, uploads and attachment downloads, MCP agent calls and
an exception mid-request, and asserts that:

- every response for user A contains only organization A's identifiers, and the same
  for B;
- every request for the other organization's resource gets 403 or 404;
- the team ID, `AgentContext` and authenticated user are unset after each request
  (exposed through a test-only debug route compiled only into the CI build).

This runs on every pull request that touches `apps/api`, so a new singleton or static
cannot reintroduce a leak unnoticed.

### Rollout

1. Land the audit fixes, the Octane stage and the CI test while production still runs
   php-fpm; the fpm stage stays in `Dockerfile.release` and is built on every release.
2. Canary on the pilot: run Octane `api` beside the fpm pair with Caddy sending a
   share of API traffic to it, then all of it, while watching error rates, p50/p95
   latency, per-worker memory and recycles, and 403 counts per organization. Keep it
   there at least a week, covering deploys and the nightly jobs.
3. Rollback is a configuration switch: the release keeps `API_WEB_IMAGE` and the fpm
   `API_IMAGE` tag, and the Caddyfile upstream points back to `api-web:80`. No data
   or schema depends on the server, so rolling back loses nothing.
4. After two releases without a rollback, remove the fpm stage, `nginx.release.conf`
   and `api-web` in a follow-up pull request.

## Consequences

- Polling endpoints serve about three to four times as many requests on the same
  CPU, and latency drops by roughly 20 ms per request, which postpones adding API
  hosts for dashboards and partner applications.
- One container replaces two, and nginx's rules move into FrankenPHP's configuration.
- Idle memory roughly doubles and grows with workers; the `api` memory limit and its
  alerts must be re-sized, and workers recycle to bound leaks.
- Code becomes long-lived: a new singleton, static or `app()->instance(...)` can leak
  one organization's state into another's request. The audit, the `finally` pattern,
  Octane's `flush` list and the alternating-organization CI test are the guard; code
  review checks for them in `apps/api`.
- Long-lived responses (the ADR-032 stream) need a cap so they cannot exhaust a fixed
  worker pool.
- The dev stack can stay on php-fpm or move to Octane with `--watch`; that choice is
  left to the implementation plan, but CI tests the Octane release image either way.
