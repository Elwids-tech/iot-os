# Contract: Integration event types follow abilities

Spec User Story 4, FR-024, SC-010 and clarification Q1. Design:
[research.md](../research.md) D8.

## Type → ability

| Event type | Needs |
| --- | --- |
| `alert.activated.v1`, `alert.cleared.v1`, `alert.acknowledged.v1` | `alerts:read` |
| `geofence.entered.v1`, `geofence.exited.v1`, `geofence.wandering_started.v1`, `geofence.wandering_resolved.v1` | `geofences:read` |
| `automation.triggered.v1` | nothing beyond `events:read` |

The map lives in `App\Domain\Integrations\IntegrationEventType::ability()`. Every
journal writer (`EventJournal::alert`, `GeofenceEventJournal::record`,
`DagActions::journal`) passes an `IntegrationEventType` case, so a new type cannot be
written without declaring its ability. A test asserts that the enum covers every type
the writers produce, and that `docs/reference/events.md` lists the same types.

## Event feed (`GET /integration/v1/organizations/{organization}/events`)

- **Unchanged.** Reaching the feed needs `events:read` plus `alerts:read` or
  `geofences:read`, on both the application and the token.
- **New.** A page includes an event only when its device is granted and its type's
  ability is held on **both** the application and the token.
- **Positions.** Skipped events advance `next_cursor` the way ungranted devices already
  do, and empty pages still return a position. Cursors stay bound to `grant_revision`;
  this change does not alter it, so existing cursors stay valid.
- **History.** The filter applies to every event read after deployment, including events
  recorded earlier (spec edge case "Events from before the ability filter").
- `GET events/checkpoint` is unchanged.

## Webhooks

- **Unchanged.** Configuring a webhook needs `events:read` and `alerts:read` on the
  application.
- **New.** The scan selects the next event whose device is granted and whose type's
  ability the application holds. Tokens play no part in webhooks.
- **New.** The send-time re-check (`WebhookDispatch`, today `:62-66`) also checks the
  type. A pending delivery whose type is no longer readable becomes `cancelled` with the
  diagnostic "The application no longer reads this event type." and is never sent.

## Examples

| Application abilities (and token) | Receives on the feed | Receives by webhook |
| --- | --- | --- |
| `events:read`, `alerts:read` | alert, automation | alert, automation |
| `events:read`, `geofences:read` | geofence, automation | no webhook (cannot configure) |
| `events:read`, `alerts:read`, `geofences:read` | all 8 types | all 8 types |
| application `events:read`, `alerts:read`, `geofences:read`; token `events:read`, `alerts:read` | alert, automation (token lacks `geofences:read`) | all 8 types (webhooks use application abilities) |

## Documentation and contract changes (same pull request)

- `docs/features/integrations.md:125`: "The feed filters by device, not by event type."
  becomes: the feed filters by granted device and by the ability each event type needs
  (table above).
- `docs/reference/events.md`: an ability column in the integration events table.
- `contracts/openapi/supplements/integration.yaml`: the `GET events` description and the
  webhook description state the rule. Then `php artisan contract:export`. `x-abilities`
  is unchanged. No schema changes, so spec 001's breaking-change gate (G5) sees a
  description change only.
- Release note for integrators (`packages/integration-sdk` README "Changes" section).
  The SDK code is unchanged.
- `docs/roadmap.md`: close "Event feed scoping".
