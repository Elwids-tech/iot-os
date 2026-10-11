# Scaling and Evolution

**Status:** Planned options, not committed implementation  
**Last updated:** 2026-08-22

## Principle

Scale by moving stable responsibilities into additional processes and stores. Do not change public APIs, definition ownership, or canonical contracts merely because deployment size changes.

## Trigger-Based Evolution

| Evidence or requirement | Planned response |
| --- | --- |
| More API or agent traffic | Scale stateless Laravel API and queue workers |
| Higher telemetry throughput | Partition Go consumers by tenant, site, device group, or stream |
| Realtime connection pressure | Add a dedicated Go realtime gateway behind the same event contract |
| Long-range/fleet analytics pressure | Add ClickHouse and an idempotent Go OLAP sink |
| Scheduled backfills and exports | Add Airflow outside the live path |
| Complex multi-hop relationship queries | Add Neo4j as a rebuildable projection |
| Many proprietary integrations | Build native React Integration Studio and TypeScript SDK |
| Stronger plugin isolation or throughput | Add signed OCI plugins or WebAssembly execution |
| Multiple edge sites | Add store-and-forward edge synchronization and fleet management |
| Availability requirements | Add managed services or high-availability NATS/database topology |
| Customer-managed cluster requirement | Add Helm and Ansible-supported Kubernetes profile |

## Native Integration Studio

The planned experience includes:

- React Flow visual pipeline
- Monaco TypeScript editor
- Typed plugin SDK
- Hex and binary inspector
- Sample replay
- Fixtures and assertions
- AI-assisted decoder and mapping drafts
- Disposable test sandbox
- Signed, immutable plugin artifact
- Version deployment and rollback

It implements the same adapter contract used by Node-RED.

## Hybrid Edge and Cloud

The future edge runtime may contain EMQX, Node-RED or native adapters, NATS JetStream, Go execution, and local operational storage. It remains useful while disconnected and synchronizes selected configuration, events, alerts, rollups, and approved data upstream.

Raw telemetry is not synchronized by default. Data sovereignty and bandwidth policies are explicit per site.

## Analytics

TimescaleDB remains the operational telemetry and diagnostic store. ClickHouse is introduced only for long-range aggregates, high-cardinality fleet comparisons, counter rollups, and state-duration analytics that exceed the practical operational workload.

Airflow performs finite retryable jobs such as backfills, reconciliation, retention archives, and customer warehouse exports. It never orchestrates live ingestion or device control.

## Knowledge Graph

PostgreSQL remains authoritative for assets and typed relationships. Neo4j may become a read projection when dependency, impact, or resource-flow traversal requires it. Consumers call a domain graph interface and do not depend directly on Neo4j.

## AI Evolution

Future agent capabilities may include sub-agents, richer RAG, local inference, model failover, and multi-step durable workflows. Tool authorization, risk classification, approval, and audit remain in Laravel regardless of provider or model architecture.

