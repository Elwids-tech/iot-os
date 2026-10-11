# ADR-004: Node-RED Adapter Runtime

**Status:** Superseded by [ADR-010](ADR-010-per-tenant-adapter-runtimes.md)  
**Date:** 2026-08-22

## Context

Industrial onboarding requires OPC UA, CoAP, API polling, proprietary protocols, and custom binary decoding. Building a complete native integration studio and multi-language sandbox before serving initial customers would delay delivery.

## Decision

Use an isolated Node-RED instance as the initial adapter runtime. Laravel owns adapter records, versions, desired configuration, and audit. Node-RED executes protocol, polling, decoder, mapper, and encoder flows and publishes platform canonical events.

The adapter contract, fixtures, artifacts, health, and lifecycle belong to the platform rather than Node-RED.

## Consequences

- Proprietary onboarding can be delivered quickly as a managed service.
- Existing Node-RED protocol nodes and JavaScript functions are available.
- Node-RED requires container, network, secret, and palette restrictions.
- Flow artifacts must be versioned outside mutable runtime storage.
- A future native TypeScript Integration Studio can replace or supplement Node-RED behind the same contract.

