# Integration API: applications follow entities (PR 8)

Changes to the integration API of spec 030 (`/api/integration/v1/organizations/{org}`)
and the portal's application management. Everything else in ADR-032 is unchanged:
grants resolve afresh on every request, feed page, webhook delivery and stream
re-resolution, and a scope change bumps `grant_revision`. The owner chose this on 2026-11-25 (Q1).

## Application management (portal)

`POST/PATCH integration-applications` accept `entity_uuids` (1–50 active entities of the
organization, any type) or the existing `site_uuids` (Site-type entities only), never
both, and never with `device_uuids`. The view returns `entities: [{uuid, name, path,
type_key}]` and, for compatibility, `site_uuids` and `sites` when every scoped entity is
a Site entity.

## Reads under `entities:read`

`GET entities?page=` lists what the application may see: each scoped entity's branch
and the ancestors of each scoped entity (a device-list grant: the anchors of its
devices and their ancestors). 100 a page, ordered by path.

```json
{
  "schema_version": "integration-entities.v1",
  "data": [
    { "uuid": "…", "name": "Feeder 12", "path": "North/EastgateSS/Feeder12",
      "type_key": "feeder", "parent_uuid": "…", "in_scope": true }
  ],
  "next_cursor": null
}
```

`in_scope` is false for ancestors shown only to complete paths; their devices are not
granted.

The device read (`GET devices/{uuid}`, `devices:read`) gains, when the application also
holds `entities:read`, `entity: {uuid, path}` and `points: [{parameter_uuid, leaf_name,
path}]`. `GET sites` stays (compatibility).

## Contracts and tests

- `contracts/openapi/supplements/integration.yaml` and the generated description; the
  drift check passes. `packages/integration-sdk`: `entities()`, `Device.points`.
- Tests: a scope on a Zone grants devices placed below it and not its siblings'; moving
  a branch out of a scope revokes at once; archived devices at their last anchor stay
  granted; another organization's entity UUID is `404`; `in_scope: false` ancestors
  expose no device.
