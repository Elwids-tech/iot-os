# Contract: SDK event types (integration SDK 0.6.0)

The public TypeScript surface of `@iot-os/integration-sdk` for integration events after
this feature (FR-029, clarification Q5). Names that exist in 0.5.0 keep their names.

## Types

```ts
// Generated from the integration bundle (src/generated/contract.ts).
export const CONTRACT_VERSION: string;                 // info.version, e.g. "1.0.0"
export const INTEGRATION_EVENT_TYPES: readonly [       // from the contract's enum (--enum-values)
  "alert.activated.v1", "alert.cleared.v1", "alert.acknowledged.v1",
  "geofence.entered.v1", "geofence.exited.v1",
  "geofence.wandering_started.v1", "geofence.wandering_resolved.v1",
  "automation.triggered.v1",
];

// Re-exported from src/index.ts.
export type KnownIntegrationEventType = typeof INTEGRATION_EVENT_TYPES[number];

export type KnownIntegrationEvent =                     // alias of the generated union
  | AlertEvent        // type: "alert.*.v1",    data: Alert
  | GeofenceEvent     // type: "geofence.*.v1", data: GeofenceEventData
  | AutomationEvent;  // type: "automation.triggered.v1", data: { workflow_uuid, action_id, name, node_id }

export interface UnknownIntegrationEvent {
  id: string;
  schema_version: "integration-event.v1";
  type: "unknown";          // distinct literal so narrowing on `type` keeps working
  event_type: string;       // the type the platform sent
  occurred_at: string;
  recorded_at: string;
  data: unknown;
}

export type IntegrationEvent = KnownIntegrationEvent | UnknownIntegrationEvent;

export interface EventPage { data: IntegrationEvent[]; next_cursor: string; has_more: boolean }

export function verifyWebhook(options: VerifyWebhookOptions): Promise<IntegrationEvent>;
```

`Alert`, `Device`, `Page`, `TelemetryRecords` and the other 0.5.0 exports keep their
names and become aliases of generated types.

## Behaviour

| Input (feed page item or verified webhook body) | 0.5.0 | 0.6.0 |
| --- | --- | --- |
| Valid envelope, known type, valid `data` | Typed event | Typed event (unchanged) |
| Valid envelope, `automation.triggered.v1` | `IotContractError` | Typed `AutomationEvent` |
| Valid envelope, type not in `INTEGRATION_EVENT_TYPES` | `IotContractError` | `UnknownIntegrationEvent`; the page and its `next_cursor` are returned normally |
| `schema_version` other than `integration-event.v1` | `IotContractError` | `IotContractError` (unchanged) |
| Missing or mistyped envelope field (`id`, `type`, `occurred_at`, `recorded_at`) | `IotContractError` | `IotContractError` (unchanged) |
| Known type with invalid `data` | `IotContractError` | `IotContractError` (unchanged) |

"Valid envelope" means: `id` is a string, `schema_version` is exactly
`integration-event.v1`, `type` is a non-empty string of at most 128 characters,
`occurred_at` and `recorded_at` are strings, and `data` is present.

## Compatibility notes for the release

- A minor release (0.5.0 → 0.6.0). Code that switches exhaustively on `event.type` must
  add a `case "unknown"`; the README and release notes say so with an example.
- Consumers should record an unknown event's `id` as processed and keep applying later
  events; the feed's cursor already moved past it.
- `CONTRACT_VERSION` lets an integrator log which contract the SDK was built from.
