# IoT OS

IoT OS is an API-first, AI-first industrial IoT platform built as a cross-language monorepo.

The repository is at the beginning of [Phase 1](plan/roadmap/phase-1/README.md). Architecture decisions are accepted, while implementation status is recorded separately and must be supported by repository and runtime evidence.

## Repository Boundaries

```text
apps/          React applications and Laravel control plane
services/      Go data-plane runtime
packages/      Shared React and TypeScript packages
contracts/     Versioned cross-language contracts and fixtures
integrations/  Adapter-runtime artifacts
deploy/        Development and release deployment profiles
tooling/       Reproducible developer commands
```

See [Monorepo and Developer Experience](plan/roadmap/phase-1/monorepo-and-developer-experience.md) for the intended complete layout.

## Initial Developer Setup

The current M0 slice requires Docker, Git, `curl`, `tar`, and a SHA-256 utility on macOS or Linux. The bootstrap script installs the pinned Task binary inside the repository; it does not modify a global toolchain.

```bash
./tooling/bootstrap
./taskw deps:up
./taskw deps:status
```

Application workspaces are being added incrementally. The root doctor command reports which local language tools are available without treating optional local toolchains as a replacement for the pinned CI/release toolchains.

## Useful Commands

```bash
./taskw doctor
./taskw deps:config
./taskw deps:up
./taskw deps:status
./taskw deps:smoke
./taskw deps:logs
./taskw deps:down
./taskw lint
./taskw test
./taskw runtime:test
./taskw runtime:dev
```

Development credentials in `.env.example` are intentionally non-production values. Production packaging will generate unique secrets and must never reuse them.
