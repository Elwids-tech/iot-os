# P1-M0: Monorepo Foundation

**Status:** In progress
**Outcome:** A developer can move from a fresh clone to both React application shells and healthy backend dependencies through documented root commands.
**Dependencies:** None

## P1-M0-E1: Reproducible Developer Workspace

### P1-M0-E1-S1 — Bootstrap the repository

**User story:** As a developer, I want one documented bootstrap command so that I can contribute without manually discovering every language and service dependency.

**Acceptance criteria:** A fresh supported macOS or Linux environment reports all required tool versions, installs project dependencies, creates local configuration from safe examples, and can be rerun without damaging existing state.

**Engineering tasks:**

- [x] T1 — Create the agreed `apps`, `services`, `packages`, `contracts`, `integrations`, `deploy`, and `tooling` boundaries.
- [x] T2 — Pin supported Node/pnpm, PHP/Composer, Go, Docker, and task-runner versions.
- [x] T3 — Add root bootstrap and doctor commands with actionable failure messages.
- [x] T4 — Add safe `.env.example` files and document secret-generation boundaries.
- [ ] T5 — Verify the bootstrap flow on a clean macOS and Linux environment.

### P1-M0-E1-S2 — Start the local platform dependencies

**User story:** As a developer, I want one command to start local infrastructure so that I can test cross-plane behavior consistently.

**Acceptance criteria:** PostgreSQL/TimescaleDB, Redis, EMQX, NATS JetStream, Node-RED, and local artifact storage start with health checks, named volumes, documented ports, and no production credentials.

**Engineering tasks:**

- [x] T1 — Create the root development Compose profile and health checks.
- [ ] T2 — Configure deterministic development users, streams, buckets, and broker namespaces.
- [ ] T3 — Add start, stop, status, logs, and non-destructive demo-reset commands.
- [x] T4 — Document data persistence and the exact scope of reset operations.
- [x] T5 — Add a smoke test that proves every dependency becomes ready.

## P1-M0-E2: Shared React Experience Foundation

### P1-M0-E2-S1 — Establish the shared shadcn package

**User story:** As a frontend developer, I want one shared component foundation so that portal and admin behavior remains consistent and accessible.

**Acceptance criteria:** `packages/ui` owns the shadcn configuration, tokens, theme, and initial components; both React applications import the same component source through the workspace alias.

**Engineering tasks:**

- [ ] T1 — Record the React runtime, shadcn base, and preset choice before scaffolding.
- [ ] T2 — Initialize shadcn with its monorepo-aware flow inside `packages/ui`.
- [ ] T3 — Define semantic product tokens for color, typography, spacing, radius, status, charts, and focus.
- [ ] T4 — Add the initial Button, Field/Input, Card, Sidebar, Breadcrumb, Table, Badge, Alert, Empty, Skeleton, Dialog, Sheet, and toast primitives as needed by the shells.
- [ ] T5 — Add a component workbench with light, dark, responsive, error, empty, and loading examples.
- [ ] T6 — Add automated accessibility and critical visual-regression checks.

### P1-M0-E2-S2 — Create portal and administration shells

**User story:** As a developer, I want independently runnable portal and admin shells so that product workflows can evolve separately while sharing foundations.

**Acceptance criteria:** Both apps render responsive authenticated and unauthenticated shells, use shared shadcn components, expose health/build metadata, and demonstrate loading, error, empty, and permission-denied routes.

**Engineering tasks:**

- [ ] T1 — Scaffold `apps/portal` and `apps/admin` in the pnpm workspace.
- [ ] T2 — Compose shared navigation, account, tenant-switching placeholder, error boundary, and route fallback patterns.
- [ ] T3 — Add `packages/auth`, `packages/api-client`, and shared query/error handling foundations.
- [ ] T4 — Add keyboard and responsive browser tests for both shells.
- [ ] T5 — Confirm the applications build and deploy independently.

## P1-M0-E3: Contracts and Quality Gates

### P1-M0-E3-S1 — Establish cross-language contract workflow

**User story:** As a platform developer, I want shared schemas and fixtures to be verified across languages so that Laravel, Go, and React cannot silently drift.

**Acceptance criteria:** The repository has canonical locations and validation commands for OpenAPI, events, ingestion envelopes, and activated definitions; generated artifacts are reproducible and CI detects drift.

**Engineering tasks:**

- [ ] T1 — Create contract directories with ownership and compatibility rules.
- [ ] T2 — Add representative valid, invalid, duplicate, and version-mismatch fixtures.
- [ ] T3 — Generate the TypeScript public API client from committed OpenAPI.
- [ ] T4 — Add PHP, Go, and TypeScript fixture validation harnesses.
- [ ] T5 — Configure dependency-aware CI for frontend, Laravel, Go, contracts, containers, and Compose smoke tests.
- [ ] T6 — Add a pull-request template that requires story IDs and verification evidence.

## Milestone Demonstration

From a clean clone, a developer runs the documented bootstrap and development commands, opens portal and admin shells built from the shared shadcn package, reaches Laravel and Go health endpoints, and sees every local dependency healthy. CI passes without generated-contract drift.

## Exit Criteria

- The bootstrap path is verified on both supported development operating systems.
- Portal and admin consume one `packages/ui` shadcn foundation.
- Root test, lint, doctor, seed, and development commands are documented and working.
- Contract fixtures are validated by all consuming language workspaces.
- No M1 work depends on undocumented local setup.
