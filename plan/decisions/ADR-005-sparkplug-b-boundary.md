# ADR-005: Sparkplug B Boundary

**Status:** Accepted  
**Date:** 2026-08-22

## Context

MQTT does not standardize industrial topic namespaces, typed metrics, discovery, birth/death state, aliases, or commands. Sparkplug B supplies those conventions and improves interoperability with industrial gateways and platforms.

## Decision

Support Sparkplug B 3.0 as a first-class device-facing MQTT contract processed by Go. Keep the platform canonical event and operational model independent from Sparkplug hierarchy and session state.

Laravel owns onboarding approval, namespace mapping, profile bindings, permissions, and audit. EMQX owns MQTT transport and authentication.

## Consequences

- Sparkplug-aware gateways can connect without proprietary JSON conventions.
- The Go service must maintain birth certificates, aliases, sequence, rebirth, and presence state.
- Sparkplug group, edge node, device, and metric identifiers require configurable domain mapping.
- Birth messages create discovery candidates rather than automatically trusted production assets by default.

