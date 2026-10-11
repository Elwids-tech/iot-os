# API (Laravel control plane)

Laravel 13 with Sanctum, spatie/laravel-permission and Laravel AI. It owns the
public API (`/api/v1`), the integration API (`/api/integration/v1`), the internal
API the Go runtime calls (`/api/internal`), the queue workers and the assistant
([architecture](../../docs/architecture/overview.md), [API surface](../../docs/reference/api.md)).

Code is organized by domain: `app/Domain/<Domain>/{Http,Models,Services,Permissions,…}`
with each domain's routes beside it (loaded from `routes/api.php`). Tests mirror it
under `tests/Feature/Domain` and `tests/Unit/Domain`. In-product help articles are in
`resources/help`.

```sh
php artisan test --compact                    # SQLite in memory; never the dev database
php artisan test --compact --filter=DashboardTest
php artisan help:validate
```

In Docker the API runs migrations on start but never seeds; see
[local setup](../../docs/dev/local-setup.md). Agent guidelines for this app (Laravel
Boost) are in [`AGENTS.md`](AGENTS.md).
