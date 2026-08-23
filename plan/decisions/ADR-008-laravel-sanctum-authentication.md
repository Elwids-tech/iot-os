# ADR-008: Laravel Sanctum Authentication

**Status:** Accepted
**Date:** 2026-08-23

## Context

The platform needs authentication for a first-party React administration application, future customer applications, and later native mobile clients. It must remain straightforward to deploy on a single VM or on-premise computer without introducing an external identity service at the start.

Authentication proves a caller's identity. Tenant selection and authorization remain separate Laravel domain concerns enforced through policies and organization-scoped Spatie roles and permissions.

## Decision

Use Laravel Sanctum as the initial authentication boundary.

- First-party React applications use stateful Laravel sessions with secure, HTTP-only cookies and CSRF protection.
- React applications do not store bearer tokens in browser storage.
- Future native mobile or explicitly approved machine clients may use revocable Sanctum personal access tokens with narrowly defined abilities.
- Laravel owns login, logout, session lifecycle, credential recovery, and future multi-factor authentication workflows.
- Stateful domains, cookie security, and trusted origins are deployment configuration rather than hard-coded application values.
- No token-issuance endpoint or login workflow is introduced by this decision alone.

## Consequences

- The React application and Laravel API require compatible trusted-origin, CORS, session-domain, and secure-cookie configuration.
- Native clients will need secure operating-system credential storage and an explicit token lifecycle before mobile access is enabled.
- Sanctum does not provide delegated OAuth. Laravel Passport or an external identity provider can be evaluated later if third-party delegation becomes a real requirement.
- Authorization remains explicit: successful Sanctum authentication never bypasses tenant membership, policies, roles, or permission checks.
