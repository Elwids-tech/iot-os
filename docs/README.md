# IoT OS documentation

Start with the [architecture overview](architecture/overview.md) and the
[glossary](architecture/glossary.md), then [local setup](dev/local-setup.md).

The code is the source of truth. These docs describe current behaviour and link to
the code; when they disagree, fix the doc. Decisions change only through a new
[ADR](adr/README.md). Planned work lives in the [roadmap](roadmap.md) and, from now
on, in Spec Kit specs under `specs/` with the project constitution at
`.specify/memory/constitution.md`.

## Architecture

- [Overview](architecture/overview.md): the core rule, containers, key flows, what was not built
- [Glossary](architecture/glossary.md)
- [Architecture decision records](adr/README.md)

## Features

- [Devices](features/devices.md): sources, onboarding, configuration, measurements, commands, telemetry viewer, retention
- [Device profiles](features/device-profiles.md): parameters, revisions, units, conversions, calculations
- [Device adapters](features/adapters.md): vendor MQTT devices through per-tenant runtimes
- [Dashboards](features/dashboards.md): panels, charts, access and sharing
- [Automation](features/automation.md): DAG automations, geofences, location
- [Alerts and notifications](features/alerts.md): episodes, email, event log
- [Integrations](features/integrations.md): applications, integration API, event feed, webhooks, SDK
- [Assistant and help](features/assistant.md)
- [AI agents](features/agents.md): connect Claude and other MCP clients, switches, connections
- [Access](features/access.md): sign-in, organizations, roles, permission ceilings, platform administration
- [Support tickets](features/support.md): bug reports, feature requests and improvements, the team's queue
- [Activity log](features/activity-log.md): the audit trail of who changed what, and the admin timeline

## Reference

- [API surface](reference/api.md)
- [Events and messaging](reference/events.md): JetStream, control messages, runtime events, committed telemetry, integration events
- [Sparkplug B](reference/sparkplug.md)
- Contracts: [`contracts/`](../contracts/README.md)

## Development

- [Local setup](dev/local-setup.md)
- [Testing](dev/testing.md)
- [Simulators and fixtures](dev/simulators-and-fixtures.md)
- [Design system](dev/design-system.md)
- [Spec-driven development](dev/specs.md) (Spec Kit, the [constitution](../.specify/memory/constitution.md), `specs/`)
- [Docs site](dev/docs-site.md): the platform's landing page and developer docs, how they're generated and checked
- [Gotchas](dev/gotchas.md)

## Operations

- [Release](ops/release.md): single-node deployment, upgrades, backups and restore
- [Pilot environment](ops/pilot.md)
- [Monitoring](ops/monitoring.md)
- [MQTT broker](ops/broker.md)
- [Docs site](ops/docs-site.md): publishing to GitHub Pages, DNS, and updating the hosted commit
- [Incident runbook](ops/incident-runbook.md)

## Hardware

- [Waveshare RGB and audio alarm board](hardware/waveshare-audio-board.md)

## Planning and history

- [Roadmap](roadmap.md)
- [Archive (October 2026)](archive/2026-10/README.md): unmaintained plans and records from the first build

## Repository map

| Path | What it is |
| --- | --- |
| [`apps/api`](../apps/api) | Laravel control plane: public, integration and internal APIs, workers, assistant. Domain code in `app/Domain/<Domain>` with its own routes, models and services |
| [`apps/portal`](../apps/portal) | Tenant React app (Vite) |
| [`apps/admin`](../apps/admin) | Platform administration React app |
| [`apps/storybook`](../apps/storybook) | Design-system gallery |
| [`apps/vertical-demo`](../apps/vertical-demo/README.md) | Sample external app built only on the integration SDK |
| [`apps/docs`](../apps/docs) | The platform's public landing page and developer docs: Astro and Starlight, published to GitHub Pages ([docs site](dev/docs-site.md)) |
| [`services/runtime`](../services/runtime) | Go data plane (`cmd/runtime`), plus `cmd/broker-admin` and `cmd/committed-consumer` |
| [`services/adapters`](../services/adapters) | adapter-manager and the per-tenant Node-RED runtime image |
| [`packages/ui`](../packages/ui/README.md) | `@iot-os/ui` design-system kit |
| [`packages/charts`](../packages/charts) | `@iot-os/charts`, ECharts wrapper and option builders |
| [`packages/api-client`](../packages/api-client) | Hand-written TypeScript client for the Laravel API |
| [`packages/auth`](../packages/auth) | Shared password-recovery and invitation pages |
| [`packages/workflow-editor`](../packages/workflow-editor) | React Flow automation editor |
| [`packages/integration-sdk`](../packages/integration-sdk/README.md) | Server-side SDK for the integration API |
| [`contracts`](../contracts/README.md) | JSON Schemas, golden fixtures and the pinned Sparkplug protobuf shared by PHP, Go and TypeScript |
| [`deploy/compose`](../deploy/compose/README.md) | Development Compose files and overlays |
| [`deploy/release`](../deploy/release) | Release Compose files, Caddy, broker and monitoring config |
| [`deploy/docker`](../deploy/docker) | Dockerfiles per image |
| [`deploy/monitoring`](../deploy/monitoring) | Local monitoring configuration |
| [`deploy/ansible`](../deploy/ansible) | Release host provisioning |
| [`tooling`](../tooling/README.md) | Bootstrap, doctor, test harnesses, verification scripts, simulators, release and monitoring tools |
| [`firmware`](../firmware/waveshare-audio) | ESP-IDF firmware for the Waveshare board |
| `docs` | This documentation. In-product help lives in [`apps/api/resources/help`](../apps/api/resources/help) |
