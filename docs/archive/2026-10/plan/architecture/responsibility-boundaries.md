# Responsibility Boundaries

**Status:** Accepted  
**Last updated:** 2026-08-22

## Primary Ownership Matrix

| Capability | React | Laravel | Go | Node-RED |
| --- | --- | --- | --- | --- |
| Customer and admin UX | Owns | Serves APIs | No | No |
| Public web/mobile API | Consumes | Owns | Internal only | No |
| Authentication and tenancy | Presents | Owns | Enforces supplied scope | Uses scoped credentials |
| Authorization and policies | Presents decisions | Owns | Enforces activated runtime constraints | No independent policy |
| Assets, devices, profiles | Presents | Owns | Caches active snapshots | Maps external sources |
| Definition authoring | Owns UX | Validates and versions | No | Advanced adapter authoring only |
| Definition activation | Initiates | Owns | Consumes | Consumes adapter revisions |
| Native telemetry ingestion | No | Configures | Owns | No |
| Sparkplug B | Presents onboarding | Owns mapping and approval | Owns runtime protocol state | Optional publisher/adapter |
| Protocol polling | Configures | Owns desired configuration | Consumes output | Owns execution initially |
| Proprietary decoding | Presents tests | Owns artifact/version record | Consumes canonical output | Owns execution initially |
| Rule authoring | Owns UX | Owns definitions | Executes active rules | No |
| Stateful rule evaluation | No | No | Owns | No |
| Human command authorization | Presents confirmation | Owns | Executes transport lifecycle | Encodes/sends adapter commands |
| Alerts and notifications | Presents | Owns workflow/delivery | Evaluates runtime conditions | Emits adapter failures |
| Realtime UI | Consumes | Authorizes and broadcasts initially | Publishes curated changes | Publishes adapter status |
| AI agents | Presents | Owns orchestration and tools | Provides scoped query/runtime capabilities | Provides diagnostics through tools |
| Audit | Presents | Owns authoritative audit | Emits runtime events | Emits execution events |

## The Definition Boundary

The platform follows one lifecycle for schemas, mappings, rules, adapter configurations, and command policies:

```text
Author → Validate → Test → Activate → Publish → Execute
        Laravel and React                Go or Node-RED
```

An activated definition is immutable. Editing creates a new draft version. Runtime services identify every execution by definition type and version.

## Public API Boundary

Laravel owns APIs used by:

- React portal
- React administration
- Future mobile applications
- Customer and partner integrations
- AI domain tools

Go services expose only narrowly scoped internal interfaces, such as:

- Time-series query execution
- Health and readiness
- Runtime status
- Replay control
- Adapter and Sparkplug diagnostics

Laravel authenticates and authorizes the public request before invoking internal capabilities.

## Data Ownership

Logical ownership applies even when the first deployment uses one PostgreSQL cluster.

### Laravel-owned records

- Organizations, users, memberships, roles, and permissions
- Sites, areas, assets, devices, and relationships
- Device profiles, profile versions, channels, and mappings
- Gateway and adapter desired configuration
- Rules, workflows, and command policies
- Command requests and business status
- Agent conversations, approvals, and audit events

### Go-owned records

- Ingestion messages and diagnostics
- Telemetry points and derived signals
- Latest values and presence state
- Runtime rule state and windows
- Stream checkpoints
- Command delivery attempts and protocol acknowledgements

One service must not casually update another service's owned fields. Cross-boundary changes use events or explicit internal APIs.

## Command Ownership

```text
User or agent
    ↓
Laravel authorization, approval, and command request
    ↓
Transactional outbox and JetStream
    ↓
Go command execution
    ↓
Native transport or Node-RED downlink encoder
    ↓
Device acknowledgement
    ↓
Go status event
    ↓
Laravel business command status and audit
```

Laravel decides whether a command may happen. Go and the adapter decide how to deliver an already-authorized command reliably.

## Rule Ownership

Laravel owns rule definitions, schedules, permissions, action configuration, approval requirements, and versioning.

Go owns per-message evaluation, duration thresholds, sliding windows, debouncing, counters, state transitions, and edge-capable execution.

When a rule fires, Go publishes a deterministic event. Laravel handles human workflows, notifications, tickets, and other control-plane side effects.

