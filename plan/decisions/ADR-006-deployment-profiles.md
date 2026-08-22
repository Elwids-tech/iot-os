# ADR-006: Deployment Profiles

**Status:** Accepted  
**Date:** 2026-08-22

## Context

The product must install simply on a VM or on-premise computer while preserving a route to managed and self-hosted Kubernetes. Starting with Kubernetes would add operational burden before the platform has scale or availability evidence.

## Decision

Make a single-node Docker Compose deployment the first supported production profile. Package the same versioned containers for later Helm-based Kubernetes profiles. Plan a Go `platformctl` installer and Ansible host provisioning without making them prerequisites for the first code foundation.

## Consequences

- Early installations remain understandable and supportable.
- Persistent storage, backups, upgrades, rollback, and health verification become first-class requirements.
- Service boundaries must map cleanly to later independent scaling.
- Kubernetes, ClickHouse, Neo4j, and Airflow remain optional evolution rather than initial dependencies.

