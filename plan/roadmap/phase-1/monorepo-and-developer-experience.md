# Monorepo and Developer Experience

**Status:** Accepted direction; exact tool versions are selected incrementally
**Last updated:** 2026-08-22

## Principle

The platform is one product in one repository. Technology-native tools remain in place, while a small root-level command surface makes the whole system easy to set up, run, test, and diagnose.

The monorepo must not imply that every Go capability becomes a separate service. Phase 1 should begin with a modular Go runtime that can be split later at the already-defined contract boundaries.

## Proposed Repository Layout

```text
apps/
  portal/                 # Customer-facing React application
  admin/                  # Administration React application
  api/                    # Laravel public API and control plane

services/
  runtime/                # Go ingestion, Sparkplug, rules, hot state, commands

packages/
  ui/                     # Shared shadcn components and design tokens
  api-client/             # Generated TypeScript client from Laravel OpenAPI
  auth/                   # Shared React authentication and tenant context
  agent-ui/               # Agent conversation, approval, and tool-result UI
  charts/                 # Governed telemetry visualization components
  config/                 # Shared TypeScript, lint, and test configuration

contracts/
  openapi/                # Versioned public API description
  events/                 # JetStream event schemas
  ingestion/              # Canonical telemetry schemas and fixtures
  definitions/            # Activated-definition schemas and fixtures

integrations/
  node-red/               # Versioned flows, approved nodes, fixtures, packaging

deploy/
  compose/                # Development and single-node release profiles
  helm/                   # Planned; not implemented in Phase 1

ops/
  ansible/                # Planned host preparation

tooling/                  # Root development and release scripts
docs/
plan/
```

The final names may change as the scaffold evolves, but ownership and dependency direction should not.

## Workspace Tooling

| Scope | Tooling direction |
| --- | --- |
| React and shared TypeScript | pnpm workspace; Turborepo for dependency-aware tasks and caching |
| Laravel | Composer and Artisan inside `apps/api` |
| Go | Go workspace with the initial runtime under `services/runtime` |
| Local dependencies | Root Docker Compose profile |
| Cross-language commands | Root `Taskfile.yml` checked-in task runner |
| API client | Generated from committed OpenAPI; CI rejects stale output |
| Shared contracts | Language-specific generated types plus cross-language fixtures |

Task is the developer interface, not a replacement for pnpm, Composer, Artisan, Go, or Docker Compose. The bootstrap helper must diagnose a missing Task installation before any Task command is required.

## Required Root Commands

The repository foundation should provide stable equivalents of:

```text
task bootstrap       Install or verify toolchains and project dependencies
task dev             Start dependencies and development processes
task doctor          Explain missing tools, ports, and unhealthy services
task test            Run affected unit, contract, and integration tests
task lint            Run affected formatting, linting, and static checks
task seed            Create a deterministic demonstration tenant and device
task reset-demo      Rebuild only the documented local demonstration data
```

A fresh supported macOS or Linux development machine should reach the portal, admin, Laravel health endpoint, and Go runtime health endpoint using the documented bootstrap flow.

## shadcn UI Foundation

shadcn is the shared React component foundation. Because shadcn distributes source code, the platform owns and reviews the generated components.

### Ownership

- Initialize shadcn once in `packages/ui`, using the monorepo-aware CLI flow.
- Commit the shared `components.json`, theme CSS, component source, and tokens.
- Import shared primitives through the package alias; do not initialize a separate shadcn copy in each app.
- Keep application-specific pages and domain compositions in their owning app or domain package.
- Keep agent and telemetry composites in `packages/agent-ui` and `packages/charts`; compose them from `packages/ui` primitives.

### Component Rules

- Search the installed and official shadcn registries before writing a new primitive.
- Compose existing components and built-in variants before adding bespoke styling.
- Use semantic color and spacing tokens so portal and admin share accessible themes.
- Use shadcn form, feedback, empty-state, loading, overlay, navigation, and chart patterns consistently.
- Preserve keyboard behavior, focus visibility, accessible names, and responsive layouts.
- Preview upstream component changes before merging them; do not overwrite local changes blindly.

### Quality Gate

`packages/ui` should provide:

- A component workbench such as Storybook
- Light and dark token previews
- Accessibility checks for shared interactive components
- Visual regression coverage for critical states
- Documented empty, loading, error, disabled, and permission-denied states

## Dependency Direction

```text
React apps → shared packages → generated public API client
                                  ↓
                              Laravel API
                                  ↓
                     versioned events and definitions
                                  ↓
                              Go runtime
```

- React applications do not import Laravel or Go implementation code.
- Laravel and Go share schemas and fixtures through `contracts`, not database models.
- Go does not link to Laravel domain code or call Laravel per telemetry message.
- Node-RED publishes and consumes platform contracts; it does not own domain records.
- Shared packages must not depend on an application package.

## CI Strategy

CI should calculate affected work but retain full contract and release gates:

- TypeScript lint, type check, unit tests, and affected app builds
- PHP formatting, static analysis, unit and feature tests
- Go formatting, static analysis, race-aware tests where applicable, and builds
- OpenAPI generation drift check
- Cross-language schema and fixture compatibility tests
- Container build and vulnerability scan
- Compose smoke test for integration and release branches
