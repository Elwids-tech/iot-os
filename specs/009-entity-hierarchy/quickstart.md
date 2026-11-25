# Quickstart: Entity Hierarchy

Validation scenarios for each pull request, run against the rebuilt local stack
(`./taskw devices:up`, then rebuild the API family and the portal as
[docs/dev/local-setup.md](../../docs/dev/local-setup.md#rebuild-one-service) shows).
Sign in to the portal as an organization admin of the seeded demo organization. API
calls use that session's token; routes are in [contracts/api.md](contracts/api.md).
Example names are neutral and invented.

## A. Types, presets and the tree (PR 1)

1. `POST entity-presets/manufacturing/apply`, then `POST entity-presets/buildings/apply`.
   `GET entity-types`: one `site` type whose allowed children include `area` and
   `building`; running either apply again changes nothing and logs nothing.
2. Create `Riverside plant` (site, time zone `Europe/Berlin`) → `Packaging` (area) →
   `Line 2` (line) → `Filler pump P-201` (asset). The path-name suggestion for the last
   is `FillerPumpP201`; the asset's path is `RiversidePlant/Packaging/Line2/FillerPumpP201`.
3. `POST entities` with type `line` and no parent: `422`, rule `parent_type`, naming the
   allowed parent types.
4. Create `Assembly` (area); move `Line 2` under it without `confirm_impact`: `409` with
   the impact; confirm: the line's and pump's paths change, `entity_changes` has a
   `moved` row, the activity log one `entity.moved`.
5. Move `Packaging` under `Filler pump P-201`'s branch: `422`, rule `cycle`.
6. Add the naming template `Feeder<number>` to a `feeder` type (power distribution
   preset); `feeder-12` is refused with the description and example, `Feeder12` accepted.

## B. Sites become entities (PR 2)

Before rebuilding, record for the demo organization: `GET sites`, each device's
`reporting_timezone`, `GET devices?site_uuid=…` for one site, one
`counter-increase` result per counter parameter over a fixed day, the agent tools
`find_devices` and `list_alerts` with a `site_uuid`, and each integration
application's resolved devices (`GET integration/v1/organizations/{org}/devices` with
its token). Rebuild (migration runs), then repeat.

- Every recorded value is identical (SC-002, SC-004).
- `GET entities` lists each site at the top level with the same UUID and a Site type.
- `GET devices/{device}/placements`: one open placement with `started_at: null`.
- Place a device at a new zone inside its site: `GET devices?site_uuid=` still lists it,
  and an application following the site still reads it.
- `DELETE sites/{uuid}` of a site with a child entity: `422`.
- Roll back one migration and the previous image runs on the restored `sites` table
  (record this in the pull request; see the pilot rollback note in the plan).

## C. Hierarchy operations (PR 3)

Run `php artisan test --compact --filter=HierarchyOperations` and the tinker-free script
`tooling/verify-entity-batch.php` against the stack's database:

- a batch of one building, four floors, sixteen zones (refs) and twenty placements:
  `check` reports every item accepted, row counts and the activity log are unchanged;
- change one zone's parent to a type that may not hold zones: that zone and its
  placement are refused (`parent_type`, `parent_refused`), the others accepted;
- `apply` of the refused batch commits nothing; `apply` after dropping the two items
  commits all, one activity entry each, with `context.batch` (SC-007).

## D. Parameter placements and points (PR 4)

1. Place the seeded three-channel energy meter at `Zone B`; move channel 3's energy to
   `Floor 3` with leaf `Ch3Energy`. `GET entities/{zone-b}/points` no longer lists it;
   `GET entities/{floor-3}/points` does, with value, unit and freshness.
2. Place a second device with a `temperature` parameter at the pump: `422 leaf_clash`
   listing `temperature`; with `leaf_names` renaming it, accepted.
3. Stop the meter's simulator: after the stale period its points show their age; a
   parameter that never reported shows `latest: null`.

## E. Memberships and filters (PR 5)

Apply the power distribution preset; build `North/EastgateSS/Feeder12/Transformer05`,
place a transformer monitor with leaf `OilTemperature`, create `EastDivision` under
`North`, and make `Feeder12` its member. The point's path is
`North/EastgateSS/Feeder12/Transformer05/OilTemperature`; `GET devices?entity_uuid=
{EastDivision}` includes the monitor; its path is unchanged (SC-005). Making
`Feeder12` a member of a second division ends the first membership.

## F. Portal (PR 6)

In the portal: **Devices → Hierarchy** replaces **Locations**. Repeat A.2–A.4 and D.1 in
the UI; measure SC-001 (under 10 minutes for a first-time user). The device form's
entity picker searches by path; the directory and alerts filter by an entity. Check
light and dark themes and a phone width; run axe on the hierarchy and entity pages.

## G. History (PR 7)

Move a device from Line 1 to Line 2, rename Line 2, move Line 2 under another area. The
device's history lists both placements; the entity's history lists the move and the
rename; `branch-at` for Line 1 before the move includes the device and after it does
not.

## H. Applications follow entities (PR 8)

Scope an integration application to `Zone B`. The SDK's `entities()` lists Zone B, its
descendants and its ancestors (`in_scope: false`); the device read shows points with
paths; moving the meter out of Zone B removes it from the next read and the stream
within a minute.

## Scale (SC-003)

`php artisan entities:seed-scale {organization} --entities=100000 --devices=20000`
(test-only command, refuses outside `local`): opening any branch under 1 s, search under
2 s, a 50-entity scope adding under 50 ms to an integration read. Record the numbers in
the pull request that adds the command (PR 5).
