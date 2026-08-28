# ADR-012: Draft-First AI Device Onboarding

**Status:** Accepted
**Date:** 2026-08-28

## Context

An engineer should be able to describe a Device and firmware contract conversationally, but an LLM must not invent safety-critical command responses, bypass tenant authorization, or create mutable production definitions without review.

## Decision

Build two experiences over the same Laravel application services:

- a tenant portal agent using Laravel AI; and
- an authenticated external server using Laravel MCP and Sanctum bearer tokens.

The agent returns a structured adaptive interview. It asks only for missing or risky facts, then sends the typed proposal and fixtures to the deterministic Go compiler. The user sees source JSON, canonical previews, command request/response previews, assumptions, and warnings before confirmation.

A ready proposal is Organization-scoped, actor-scoped, expiring, canonicalized, and hashed. Confirmation must include the exact proposal UUID, hash, and idempotency key. A successful transaction creates editable Profile, Binding, Device, and assignment drafts exactly once.

AI/MCP confirmation does not publish definitions, register the Device, issue credentials, or activate runtime behavior. Those remain explicit reviewed actions. The internal Laravel AI agent calls application services directly rather than calling its own MCP endpoint.

## Consequences

- Prompt text is an authoring aid, not an executable domain contract.
- Organization selection never supplies authority; authenticated membership and policies remain authoritative.
- Two-way Command proposals require firmware-supported response topic, correlation, and terminal status details.
- Unconfirmed proposals expire after 24 hours.
- Bulk onboarding, OAuth delegation, broker credentials, and zero-touch provisioning remain later work.
