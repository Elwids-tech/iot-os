# Current Task: Administration Foundation

**Status:** In progress
**Last updated:** 2026-08-23

## Objective

Establish the Laravel API and React administration foundations for tenant, user, role, and permission management. Do not build dashboards, device management, or other IoT features in this task.

## Agreed Direction

- Laravel is the headless control plane and owns authentication, tenancy, authorization, and public API contracts.
- React is the administration experience and uses the shared shadcn component foundation.
- Laravel code follows domain-driven boundaries, informed by the proven patterns in `/Users/tharindarodrigo/Herd/iot-portal` without copying its Filament UI.
- Tenant-aware authorization uses `spatie/laravel-permission` with teams enabled and the tenant key set to `organization_id`.
- Permission definitions use typed enums through `althinect/enum-permission`.
- API authentication for the React client must be explicitly selected and documented before protected endpoints are implemented.

## Working Method

- Complete one small, reviewable slice at a time.
- Keep documentation, backend foundations, API behavior, and React screens in separate checkpoints where practical.
- Verify tenant isolation and denied authorization paths alongside successful behavior.
- Do not begin the next slice until the current diff has been reviewed.
- Record only repository-verified work as complete.

## Proposed Task Sequence

This is a working sequence, not a milestone commitment. The user may change it as the product is clarified.

- [x] Confirm the Laravel application boundary and package baseline.
- [ ] Add the organization tenancy domain and migrations.
- [ ] Add users and organization membership behavior.
- [ ] Add organization-scoped roles and enum-backed permissions.
- [ ] Define versioned administration API contracts.
- [ ] Build the first React administration flow with default shadcn patterns.

## Current Checkpoint

Establish the Sanctum, Spatie Permission, and enum-permission package baseline. Configure stateful Sanctum middleware and document the client authentication boundary without adding tenancy models, API endpoints, or React changes.
