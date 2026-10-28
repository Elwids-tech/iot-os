Example vendor documentation used by the IoT OS simulators.

# Example Tracker Cloud: History API

Example Tracker Cloud collects position and environment readings from battery-powered
cellular asset trackers. The History API returns the readings that your trackers have
uploaded to the cloud, oldest first, so that another system can copy them. It is a
read-only REST API that returns JSON.

## Overview

- Base URL: `https://tracker-api.example.com`
- Every request needs an API key in the `x-api-key` header.
- All times are UTC, in ISO 8601 with milliseconds and a trailing `Z`
  (for example `2026-10-27T09:20:00.000Z`).
- History is kept for 3 days. Older readings are not returned.
- Responses normally arrive in under a second. Use a client timeout of at least 30 seconds.

## How tracker data arrives

A tracker records a reading every 5 minutes and uploads its stored readings to the cloud
every 15 minutes over the cellular network. When a tracker is out of coverage (a
basement, a tunnel, a rural road) it keeps recording, and uploads everything it has
stored once it is back in coverage. A tracker can be out of coverage for up to 2 hours.

Each reading therefore has two times:

| Field | Meaning |
| --- | --- |
| `timestamp` | When the tracker took the reading. It can be minutes to hours older than the moment the cloud received it. |
| `receivedDate` | When the cloud received the reading. Readings uploaded together get consecutive milliseconds, so every reading has its own `receivedDate`. |

A reading is available from the API as soon as it is received. At any moment the newest
readings you can fetch are typically 10 to 120 minutes old (by `timestamp`). Readings
from different trackers can arrive out of order by `timestamp`, but they always arrive in
order of `receivedDate`. Use `receivedDate`, not `timestamp`, to page through history,
otherwise a backlog uploaded late would be missed.

## Authentication

Send your API key in the `x-api-key` request header:

```
x-api-key: <your API key>
```

Keys belong to one account and are created in the Example Tracker Cloud console. A
missing or wrong key returns `401`. Keep keys out of URLs and logs. Rotate a key in the
console if it may have been exposed.

## Get stream history

```
GET /accounts/{account}/streams/history
```

Returns the readings the cloud received for the account, ordered by `receivedDate`
ascending (then by `id`).

### Path parameter

| Name | Description |
| --- | --- |
| `account` | Your account identifier, for example `A1`. An unknown account returns `404`. |

### Query parameters

| Name | Required | Description |
| --- | --- | --- |
| `start` | No | Return only readings received **after** this time (exclusive). ISO 8601 (`2026-10-27T08:00:00Z`, with or without milliseconds, with `Z` or a numeric offset such as `%2B02:00`) or epoch milliseconds (`1793092800000`). Default: the oldest retained reading. |
| `end` | No | Return only readings received **up to and including** this time. Same formats as `start`. Default: now. Times in the future are treated as now. |
| `limit` | No | Maximum number of readings in one response, from 1 to 1000. Default and maximum: 1000. Any other value returns `400`. |

### Response

`200 OK` with a JSON object:

| Field | Type | Description |
| --- | --- | --- |
| `data` | array | The readings, ordered by `receivedDate` ascending. Empty when nothing new has arrived. |
| `count` | integer | Number of readings in `data`. |
| `maxDate` | string or `null` | The largest `receivedDate` in `data`, or `null` when `data` is empty. |

Each reading in `data`:

| Field | Type | Unit | Description |
| --- | --- | --- | --- |
| `id` | string | | Unique reading identifier, `<deviceId>-<sequence number>`. Never reused. |
| `deviceId` | string | | The tracker, for example `TRK-1001`. |
| `timestamp` | string | UTC | When the tracker took the reading. |
| `receivedDate` | string | UTC | When the cloud received the reading. |
| `lat` | number | degrees | Latitude, WGS 84, positive north. |
| `lon` | number | degrees | Longitude, WGS 84, positive east. |
| `accuracy_m` | number | metres | Horizontal accuracy of the position fix (radius). |
| `temperature_c` | number | degrees Celsius | Air temperature at the tracker. |
| `humidity_pct` | number | % relative humidity | 0 to 100. |
| `pressure_hpa` | number | hectopascals | Barometric pressure. |
| `light_lux` | integer | lux | Ambient light. `0` in the dark. |
| `battery_pct` | number | % | Remaining battery charge, 0 to 100. |

### Paging

Page by `receivedDate`. To copy the history and then keep up with new readings:

1. Make a first request with `start` set to how far back you want to begin
   (at most 3 days).
2. Process `data`, then use `maxDate` as the `start` of the next request.
   `start` is exclusive, so no reading is returned twice.
3. If `count` equals the `limit` you asked for, there may be more: request the next page
   straight away. If `count` is lower, you have caught up; wait before polling again.
4. If `data` is empty, `maxDate` is `null`: keep your previous `start` and try again
   later.

Because `receivedDate` is unique per reading and never goes backwards, this loop does not
skip or repeat readings. If you want an extra safeguard, ignore any reading whose `id`
you have already stored.

### Example

Request:

```
curl -H "x-api-key: $API_KEY" \
  "https://tracker-api.example.com/accounts/A1/streams/history?start=2026-10-27T08:00:00Z&limit=3"
```

Response:

```json
{
  "data": [
    {
      "id": "TRK-1002-5976958",
      "deviceId": "TRK-1002",
      "timestamp": "2026-10-27T07:49:58.775Z",
      "receivedDate": "2026-10-27T08:02:48.000Z",
      "lat": 51.01433,
      "lon": -114.006027,
      "accuracy_m": 22.8,
      "temperature_c": 4.0,
      "humidity_pct": 70.6,
      "pressure_hpa": 1012.2,
      "light_lux": 0,
      "battery_pct": 63.1
    },
    {
      "id": "TRK-1002-5976959",
      "deviceId": "TRK-1002",
      "timestamp": "2026-10-27T07:54:59.609Z",
      "receivedDate": "2026-10-27T08:02:48.001Z",
      "lat": 51.015,
      "lon": -114.01,
      "accuracy_m": 23.8,
      "temperature_c": 3.6,
      "humidity_pct": 71.3,
      "pressure_hpa": 1012.1,
      "light_lux": 0,
      "battery_pct": 63.1
    },
    {
      "id": "TRK-1002-5976960",
      "deviceId": "TRK-1002",
      "timestamp": "2026-10-27T07:59:58.338Z",
      "receivedDate": "2026-10-27T08:02:48.002Z",
      "lat": 51.01433,
      "lon": -114.013973,
      "accuracy_m": 8.7,
      "temperature_c": 3.6,
      "humidity_pct": 69.8,
      "pressure_hpa": 1012.2,
      "light_lux": 0,
      "battery_pct": 63.1
    }
  ],
  "count": 3,
  "maxDate": "2026-10-27T08:02:48.002Z"
}
```

The next request would use `start=2026-10-27T08:02:48.002Z`.

## Errors

Errors return a JSON object with an `error` code (and sometimes a `message`).

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | `start`, `end` or `limit` is not valid. The `message` says which. |
| 401 | `unauthorized` | The API key is missing, wrong or revoked. Do not retry with the same key. |
| 404 | `account_not_found` or `not_found` | Unknown account or path. |
| 429 | `rate_limited` | Too many requests. The `Retry-After` header gives the number of seconds to wait. |
| 500 | `internal_error` | A problem on our side. Retry later. |

## Rate limits and polling advice

- The limit is 60 requests per minute per API key. Over the limit, requests return `429`
  with a `Retry-After` header; wait at least that many seconds before the next request.
- Trackers upload every 15 minutes, so polling more often than once every 5 minutes
  gains nothing. A poll interval of 5 minutes is recommended.
- Request the largest `limit` you can handle (up to 1000) and follow `maxDate` rather
  than asking for the same window again.
- On `500` and on network errors, retry with exponential backoff (for example 1, 2, 4,
  8 seconds, up to a minute). Do not retry `400` or `401`.
- Keep the `maxDate` of the last page you processed, so that you can resume exactly
  where you stopped after an outage on either side.
