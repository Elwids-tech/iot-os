# Site Compatibility View

Every reader of sites on `main` (`ed6edee9`) and what serves it after pull request 2.
Shapes do not change; each is marked deprecated in the OpenAPI description and the
agent tool catalogue, naming its replacement (FR-015). SC-004: the existing tests for
these pass unchanged.

| Reader | Today | After PR 2 | Replacement |
| --- | --- | --- | --- |
| `GET/POST sites`, `PATCH/DELETE sites/{site}` (`SiteController`, `Device.view`/`Device.manage`) | `sites` rows | Site-type entities through the `Site` model (a scope on `entities`) and the hierarchy's services; `POST` creates a top-level Site entity; `DELETE` refuses with children, else ends placements, archives the entity and calls `ApplicationGrants::entityArchived`; activity `site.*` as today; name unique among active Site entities | `entities`, `entity-types` |
| `PUT settings/timezone` | organization zone | unchanged | — |
| Device view `site`, `reporting_timezone` (`DeviceView`) | `site_id` → `sites` | `site_id` → Site entity (derived, R5); zone from the tree (R6) | `entity`, `path` |
| Device create/update `site_uuid` | sets `site_id` | places the device at the Site entity | `entity_uuid` |
| `GET devices?site_uuid=` (`DeviceDirectory`) | `whereHas('site')` | unchanged query, derived `site_id` | `entity_uuid` |
| Alert `site`; agent `site` filter (`AlertQuery`) | device's site; gateway's shared site | unchanged, derived `site_id` | `entity_uuid` filter |
| Move preview `devices.*.site_uuid`, `target_site_id` (`MovePreview`, `MoveCutover`) | target's site | a Site entity of the target, or `devices.*.entity_uuid` for any place that accepts devices; stored as `target_entity_id`; the review's `successor.site_uuid` is the site above the chosen place | `entity_uuid` |
| Integration grants `site_uuids` (`ApplicationGrant`) | `site_id` in scope | `site_id` in the scoped sites or any site inside their branches (R8): a device placed anywhere in a scoped site is its site's | `entity_uuids` |
| Integration `GET sites`, device `site` (`SiteReadController`, `ReadController`) | `sites` rows | Site-type entities with `granted_devices_count` | `GET entities` |
| Agent tools `list_sites`, `find_devices` (`site_uuid`, `site`), `list_alerts` (`site_uuid`), `get_device_health` (`site`, `reporting_timezone`), `get_measurements` (`reporting_timezone`) | `sites` and `site_id` | Site entities and derived `site_id`; `contracts/agents/tools.json` unchanged except deprecation notes | none in this spec |
| Organization deletion preview "Sites" count (`OrganizationDeletion`) | `sites` count | "Entities" count (admin label changes) | — |
| Activity feed site names (`ActivityFeed`) | `sites.name` | entity names (same UUIDs) | — |
| Portal: Locations tab, site picker, directory site filter and column, overview site, alert site, move target picker, settings time zone, integration site scopes | sites API | Hierarchy page (PR 6) and entity pickers; the column shows the site until PR 6 | — |
