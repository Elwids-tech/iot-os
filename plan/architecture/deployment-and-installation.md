# Deployment and Installation

**Status:** Accepted direction  
**Last updated:** 2026-08-22

## Principle

The same versioned containers and contracts support every deployment profile. Cloud, on-premise, and Kubernetes are packaging choices rather than separate products.

## Deployment Profiles

| Profile | Status | Intended use |
| --- | --- | --- |
| Development | Phase 1 | Local development and integration testing |
| Single node | Phase 1 default | One VM or on-premise computer |
| Edge runtime | Planned | Local protocol processing with selective cloud synchronization |
| Managed Kubernetes | Planned | Hosted or enterprise scale using managed infrastructure |
| Self-hosted Kubernetes | Planned | Advanced customer-managed cluster |

## Single-Node Production Baseline

The initial production bundle uses Docker Compose and contains:

- Reverse proxy and TLS termination
- React portal and administration applications
- Laravel API, queue workers, scheduler, and Reverb
- Go ingestion, Sparkplug, rule, and command services
- EMQX
- NATS JetStream
- PostgreSQL with TimescaleDB
- Redis
- Node-RED adapter runtime
- Object-storage integration or local compatible storage
- Lightweight logs, metrics, and health checks

Optional analytics and development tools are separate Compose profiles.

## Installer

A future `platformctl` Go binary should provide one stable installation and operations interface:

```text
platformctl install
platformctl doctor
platformctl status
platformctl upgrade
platformctl backup
platformctl restore
platformctl logs
platformctl support-bundle
```

Initial responsibilities:

- Host, CPU, memory, disk, clock, and port preflight
- Container-runtime verification
- Persistent path selection
- Secret and certificate generation
- Release-manifest and Compose-profile selection
- Database migration orchestration
- Initial administrator bootstrap
- End-to-end health verification
- Backup configuration
- Upgrade and rollback metadata
- Air-gapped installation bundle support

After infrastructure starts, a React setup wizard backed by Laravel handles organization, administrator, identity provider, first site, first gateway, connector onboarding, first live datapoint, and optional AI-provider configuration.

The CLI and web setup must share a declarative installation state rather than implementing two unrelated setup processes.

## Self-Managed Hosts

Ansible is the planned host-provisioning tool for customer-managed environments. It owns:

- Supported Linux baseline and hardening
- System users
- Docker installation
- Firewall rules
- Storage mounts
- Time synchronization
- Backup destinations
- Monitoring agents
- Multi-host inventory and prerequisites

`platformctl` owns the application release. Ansible prepares hosts; it does not become the platform's product-level workflow engine.

## Data Protection Before High Availability

The first operational priority is recoverability:

- Dedicated persistent database volume
- Encrypted scheduled backups
- PostgreSQL WAL archiving through an appropriate tool
- Off-host or object-storage backup copies
- Documented restore procedure
- Automated restore verification
- JetStream storage monitoring and snapshot procedures
- Versioned Node-RED flows and adapter artifacts outside runtime volumes

High-availability databases and multi-node messaging are introduced only when customer requirements justify their operational cost.

## Kubernetes Evolution

Managed Kubernetes support should use Helm rather than a custom operator initially. It may use managed PostgreSQL, Redis, and object storage while scaling stateless Laravel and Go workloads independently.

Self-hosted Kubernetes may later use Ansible plus k3s or RKE2 and the same Helm chart. Hosting databases inside a customer-managed cluster is an advanced profile, not the default recommendation.

## Scaling Seams Preserved in Phase 1

- Stateless React applications
- Horizontally scalable Laravel API and queue workers
- Partitionable Go consumers
- Durable JetStream streams
- Immutable definition versions
- Explicit service data ownership
- Replaceable realtime delivery
- Optional analytics sinks
- Isolated adapter runtimes
- Provider-independent AI tools

