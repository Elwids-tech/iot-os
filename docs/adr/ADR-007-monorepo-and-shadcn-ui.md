# ADR-007: Monorepo and Shared shadcn UI

**Status:** Accepted
**Date:** 2026-08-22

## Context

The product spans React applications, a Laravel control plane, a Go data plane, shared contracts, Node-RED integration artifacts, and deployment configuration. Developers need one reproducible workspace without erasing the native tooling of each ecosystem. The portal and administration experiences also need a reusable, accessible component foundation.

## Decision

Use one cross-language monorepo. Keep technology-native workspaces inside it and expose a root `Taskfile.yml` interface for setup, development, verification, and diagnostics.

Use shadcn as the React component foundation. Store its component source, configuration, design tokens, and theme in a shared `packages/ui` workspace consumed by the portal and administration applications. Do not maintain independent shadcn copies in each app.

Begin Phase 1 with a modular Go runtime rather than prematurely splitting every runtime capability into a separate deployable service.

## Consequences

- A developer can clone, bootstrap, run, and test the product from one repository.
- Cross-language contract changes can be reviewed and verified atomically.
- React applications share accessible components while retaining independent routes and product workflows.
- shadcn source becomes platform-owned code that must be reviewed, tested, and upgraded deliberately.
- CI needs dependency-aware checks across pnpm, Composer, Go, contracts, containers, and Compose.
- Repository boundaries and ownership rules must prevent the monorepo from becoming a shared-code free-for-all.
