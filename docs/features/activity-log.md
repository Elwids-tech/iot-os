# Activity log

The platform's one audit trail: who changed what, in which organization, and when
([spec 024](../../specs/024-activity-log/spec.md),
[ADR-028](../adr/ADR-028-activity-log.md)). Platform administrators read what people did
as a timeline in the admin app.

Code: Laravel [`Domain/Audit`](../../apps/api/app/Domain/Audit) (recording:
[`ActivityLog`](../../apps/api/app/Domain/Audit/Services/ActivityLog.php), changes:
[`ActivityChanges`](../../apps/api/app/Domain/Audit/Services/ActivityChanges.php), words:
[`ActivityCatalogue`](../../apps/api/app/Domain/Audit/Services/ActivityCatalogue.php), the
admin feed: [`ActivityFeed`](../../apps/api/app/Domain/Audit/Services/ActivityFeed.php));
admin [`ActivityPage`](../../apps/admin/src/pages/ActivityPage.tsx); kit
[`activity-timeline`](../../packages/ui/src/components/activity-timeline.tsx).

## Storage

Events live in `activity_log`, the table of
[`spatie/laravel-activitylog`](https://github.com/spatie/laravel-activitylog) 5, with
three columns of our own:

| Column | Holds |
| --- | --- |
| `event` | The action code, such as `device.updated` |
| `causer_type`, `causer_id` | The person who acted (a `User`, integer id); empty for system events |
| `organization_id` | The organization whose data changed; empty at platform level |
| `subject_type`, `subject_id` | The model acted on, when the recorder was given one |
| `subject_uuid`, `subject_name` | The subject's UUID and its name at the time |
| `attribute_changes` | `{attributes, old}`: new and old values of the fields an edit changed |
| `properties` | Details of the action; `changed` lists fields that changed but are not diffed |

`DeviceAudit::record()` still works and writes here. The table replaced
`device_audit_events`; its events were copied across in order.

## Recording

Record in the transaction of the change, so a rolled-back change leaves nothing:

```php
ActivityLog::record('site.updated', $organization, $request->user(), $site, [], ActivityChanges::between($before, $site->only($fields)));
```

- The actor is never taken from the signed-in user implicitly; pass it, or `null` for
  a system event.
- Fields named like secrets (`password`, `token`, `secret`, `api_key`, `private_key`,
  `client_secret`, `credentials`) are dropped from details and changes at any depth.
- Large documents (dashboard layouts and widgets, profile extensions) are listed in
  `details.changed` instead of diffed.
- A new action gets a sentence and a subject kind in `ActivityCatalogue`; without one
  it shows its code in words.

Recorded so far: devices, configurations, commands, sites, location bindings,
geofences, telemetry captures and retention; device profiles (created, edited, each
draft change, published, deleted); adapters; dashboards (created, edited, duplicated,
restored, sharing changed, deleted); automations and alerts; applications and
webhooks; organization members, roles, invitations, time zone, permission ceiling and
billing account; organizations created and edited by platform administrators; billing
accounts; platform administrators and super administrators; AI agent access; support
ticket deletion; assistant settings. Sign-ins and reads are not recorded.

## Reading

**Activity** in the admin app (`/activity`, platform administrators who manage
organizations) lists what people did, newest first, a heading per day: the person,
the action in words, the subject, the organization (or **Platform**), the time, and
what changed. Lists such as roles and permissions show the items added and removed.
**Person** and **Organization** are searchable selectors; the filters stay in the
address (`?user=7&organization=<uuid>`). **Load older activity** pages back 50 at a
time.

API: `GET /api/v1/admin/activity?user_id=&organization=&cursor=`
([contract](../../contracts/openapi/supplements/activity.yaml)). System events are left
out; billing account history and the retention page still read them.

A deleted person keeps their events and shows as "Deleted user". A subject shows its
current name, or the name it had when it is gone. Deleting an organization deletes its
events (spec 006). Nothing is pruned; `activitylog:clean` exists but no retention period
is decided.

## Not included

An activity view for organization admins in the portal, sign-in auditing, exporting
the log and an audit retention period.
