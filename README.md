# IoT OS

IoT OS is an API-first, AI-first industrial IoT platform built as a cross-language monorepo.

Active work is tracked as small, reviewable tasks in the [plan](plan/README.md). Architecture decisions are accepted, while implementation status is recorded separately and must be supported by repository and runtime evidence.

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

The current repository foundation requires Docker, Git, `curl`, `tar`, and a SHA-256 utility on macOS or Linux. The bootstrap script installs the pinned Task binary inside the repository; it does not modify a global toolchain.

```bash
./tooling/bootstrap
./taskw deps:up
./taskw deps:status
```

Application workspaces are being added incrementally. The root doctor command reports which local language tools are available without treating optional local toolchains as a replacement for the pinned CI/release toolchains.

## Device Profile Studio

The tenant authoring portal runs on `http://localhost:5173`; platform administration remains on `http://localhost:5174`. See [Device Profile Studio](docs/device-profile-studio.md) for startup, login, safe upgrades, authoring, and isolated browser tests.

## Useful Commands

The [Devices v1 guide](docs/devices-v1.md) covers registration, Sparkplug B on EMQX, live measurements and history, confirmed commands, retention, and recovery. Run `./taskw devices:test` for disposable simulator acceptance or `./taskw devices:serve` for an interactive review. The normal development stack is unchanged unless the Devices overlay is explicitly selected.

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
./taskw devices:test
./taskw devices:serve
```

Development credentials in `.env.example` are intentionally non-production values. Production packaging will generate unique secrets and must never reuse them.

## Staging and single-node releases

See [the release runbook](deploy/release/README.md) for immutable images, Hetzner host setup, `elwids.xyz`/Brevo configuration, staging fixtures, monitoring, backup/recovery, and launch gates. This profile is separate from the local development stack.
