# ADR-010: Device Definition Versioning

**Status:** Accepted
**Date:** 2026-08-28

## Context

Semantic capabilities and transport mappings change for different reasons. Combining MQTT topics, JSON paths, and protocol details with product meaning makes definitions difficult to reuse, review, and evolve safely. Device registration also needs an exact contract rather than a mutable latest Profile.

## Decision

Separate definitions into two Organization-owned catalogs:

- a Device Profile Version defines transport-independent components and capabilities; and
- a Native MQTT Transport Binding Version maps one exact Profile Version to manufacturer topics and JSON payloads.

Version lifecycle is `draft -> published -> retired`. Validation is immutable evidence, not a lifecycle state. Publishing requires a successful validation run whose normalized input hash still matches the current draft revisions.

Published and retired Versions are immutable. Changes clone a new draft with lineage. Profile and Binding artifacts are normalized JSON, canonicalized using RFC 8785, hashed with SHA-256, and stored with schema and compiler versions. A Binding artifact includes the exact Profile artifact hash.

A Device definition assignment pins the exact Profile Version, Binding Version, and Binding artifact. Device lifecycle in this slice is `draft -> registered -> archived`. Registered means identity and definitions are established; it does not imply credentials, connectivity, or runtime activation.

## Consequences

- Active assignments never change because a catalog entry is edited.
- A Profile change requires a newly validated compatible Binding Version.
- Drafts may be hard-deleted only while unreferenced; published history is retired or archived.
- Runtime Bundles, broker principals, desired/observed convergence, and rollback execution remain later milestones.
