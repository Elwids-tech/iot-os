# ADR-001: React Experience Layer

**Status:** Accepted  
**Date:** 2026-08-22

## Context

The platform needs a flexible, reusable customer experience, administration experience, future Integration Studio, and future mobile clients. A server-rendered administration framework would couple product UX to the backend implementation.

## Decision

Use React for both customer and administration applications. Share the design system, API client, authentication, agent UI, charts, and integration components through a monorepo while allowing separate app shells and deployments.

Laravel is headless and exposes versioned APIs. Backend authorization remains authoritative.

## Consequences

- Product UX can be designed around end-user tasks rather than database resources.
- Customer and administrator experiences can evolve independently while reusing components.
- The API becomes a first-class contract for web, mobile, and external integrations.
- The team must own frontend routing, state, accessibility, testing, and design-system quality.

