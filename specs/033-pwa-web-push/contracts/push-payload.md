# Contract: Push Payload v1

The encrypted JSON body of every push, from the API's push sender to the portal's
service worker. It crosses from PHP to TypeScript, so it lives as a JSON Schema with
golden fixtures (principle IV):

```text
contracts/push/v1/alert-push.v1.schema.json
contracts/push/v1/alert-push.v1.fixture.json   # an activation, the golden example
contracts/push/v1/alert-push.v1.cases.json     # activated, cleared, summary, test, no device, and invalid cases
```

They follow the repository's contract layout (`contracts/README.md`) and are checked by
`tooling/verify-devices-contracts.py`. PHP tests build the fixture's payload and
validate every builder's output against the schema; Vitest renders each case through
the worker's formatter.

## Shape

```json
{
  "v": 1,
  "kind": "activated",
  "organization": { "uuid": "0f9c…", "name": "Workshop" },
  "alert": {
    "uuid": "6a1e…",
    "severity": "warning",
    "automation": "Freezer temperature",
    "device": "Freezer 2"
  },
  "occurred_at": "2026-11-21T02:14:03Z",
  "count": null,
  "url": "/organizations/0f9c…/alerts/6a1e…"
}
```

| Field | Rules |
| --- | --- |
| `v` | `1`. The worker shows a generic notification for any other value |
| `kind` | `activated`, `cleared`, `summary` or `test` |
| `organization` | Always present for `activated`, `cleared` and `summary`; null for `test` |
| `alert` | Present for `activated` and `cleared`; null otherwise. `severity` is `critical`, `warning` or `info`. `device` may be null |
| `occurred_at` | ISO 8601 UTC: the transition time, the summary window's end, or the test's send time |
| `count` | Summary only: number of further alerts, at least 1 |
| `url` | A path on the portal's origin, starting with `/organizations/` or `/settings/` |

Nothing else is sent. There are no readings, no comments and no user data beyond the
names above. The whole body stays under 2 KB; the API cuts names longer than 120
characters.

## How the worker shows it

| Kind | Title | Body | Tag |
| --- | --- | --- | --- |
| `activated` | `{Severity} · {automation}` | `{device} · Activated {time} · {organization}` | `alert-{alert.uuid}` |
| `cleared` | `Cleared · {automation}` | `{device} · Cleared {time} · {organization}` | `alert-{alert.uuid}` |
| `summary` | `1 more alert`, or `{count} more alerts` when `count` is 2 or more | `{organization} · since {time}` | `summary-{organization.uuid}` |
| `test` | `Push is on` | `This device will get your alerts.` | `test` |
| unknown `v` | `New alerts` | `Open the app to see them.` | `unknown` |

- `{time}` is `occurred_at` in the phone's own time zone and locale, as hours and
  minutes, with the date added when it is not today.
- When `device` is null, its part and the separator after it are left out.
- `renotify` is false. There are no `actions` and no `requireInteraction`. The icon and
  badge are the app's icons.
- `data.url` carries `url` to the click handler.

## Push service headers

| Header | Value |
| --- | --- |
| `TTL` | `86400` |
| `Urgency` | `high` for `activated`, `normal` otherwise |
| `Topic` | `activated` and `cleared`: the alert uuid without dashes. `summary`: the organization uuid without dashes. `test`: none |
