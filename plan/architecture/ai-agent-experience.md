# AI Agent Experience

**Status:** Accepted  
**Last updated:** 2026-08-22

## Principle

> The platform is AI-first but not AI-dependent.

AI is a primary way to configure, investigate, and operate the platform. Deterministic ingestion, rules, command safety, dashboards, and administration remain usable without an AI provider or internet connection.

## Architecture Position

Laravel AI owns agent orchestration because agents need close access to domain policies, tenancy, approvals, audit, queues, notifications, and versioned configuration.

```text
User in React
    ↓
Laravel AI agent
    ↓
Authorized domain tool
    ↓
Policy, tenant scope, approval, and audit
    ↓
Laravel domain service or scoped Go capability
```

Agents do not receive direct SQL, broker, Node-RED, or device credentials.

## Tool Contract

Every agent tool declares:

- Input and output schema
- Required permission
- Tenant and resource scope
- Read, configure, or control risk level
- Whether human approval is required
- Whether it creates a draft or performs an action
- Timeout and execution mode
- Audit and data-retention policy

### Risk Levels

| Level | Default behavior |
| --- | --- |
| Read | May execute automatically within the user's permissions. |
| Configure | Produces a draft for review and activation. |
| Control | Requires explicit confirmation, policy validation, and complete audit. |

## Initial Tool Families

### Operations

- Search and inspect assets
- Query recent measurements
- Compare periods
- Inspect active alarms and events
- Trace resource and dependency relationships
- Explain current device and gateway status

### Integration

- Inspect gateway diagnostics
- Inspect Sparkplug birth state
- Analyze sample payloads
- Draft a decoder or mapping
- Draft a device profile
- Generate fixtures
- Test an adapter revision

### Configuration

- Draft a rule
- Simulate a rule against recorded data
- Draft a dashboard
- Draft a report
- Propose an adapter configuration

### Control

- Prepare a device command request
- Explain command effect and risk
- Request explicit approval
- Submit through the normal Laravel command policy

## First Product Agents

1. **Integration assistant:** converts documentation and samples into tested draft mappings, decoders, and profiles.
2. **Operations investigator:** explains changes using authorized telemetry, events, alarms, and relationships.
3. **Dashboard and report assistant:** converts a user objective into a draft visualization or report.
4. **Rule authoring assistant:** drafts and simulates rules before activation.

Agents should appear inside relevant workflows with current asset, gateway, device, or report context rather than existing only as a generic chat page.

## Provider Strategy

The model provider is an adapter behind Laravel AI. Deployments may use:

- A supported cloud provider
- A customer-selected provider
- An OpenAI-compatible local inference gateway
- A future on-premise model runtime
- No AI provider

Provider choice must not alter domain tool contracts. Platform capability and safety do not depend on model-specific behavior.

## Data and Safety

- Tenant and authorization scope applies before any context is assembled.
- Tool outputs are minimized to the task.
- Raw telemetry is queried and summarized by deterministic services instead of copied wholesale into prompts.
- AI-generated definitions remain drafts until activated.
- Control tools use step-up confirmation and existing command policies.
- Every tool call records actor, tenant, resource scope, inputs, outcome, and approval.
- Sensitive prompts and model-provider retention settings are configurable for on-premise customers.

