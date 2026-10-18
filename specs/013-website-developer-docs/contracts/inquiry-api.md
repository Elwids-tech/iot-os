# Contract: `POST /api/inquiry`

Served by the website Worker on the marketing domain. It is not part of the platform
API or its OpenAPI document. The body schema ships in PR 2 as
`contracts/website/inquiry.v1.schema.json`, with golden fixtures in
`contracts/website/fixtures/` (valid, each invalid field, honeypot filled). Both the
form and the Worker tests read them (constitution IV).

## Request

`Content-Type: application/json`, at most 16 KiB.

```json
{
  "schema_version": "inquiry.v1",
  "id": "2f1c8a4e-7b1d-4c3e-9a55-0d6b2f3e8c11",
  "type": "demo",
  "name": "Ada Example",
  "email": "ada@example.com",
  "company": "Example Devices",
  "role": "hardware",
  "message": "We build LoRa gateways and want to publish Sparkplug B.",
  "source_page": "/engineers/hardware",
  "rendered_at": 1760700000000,
  "website": ""
}
```

| Field | Rule |
| --- | --- |
| `schema_version` | Exactly `inquiry.v1`; anything else answers 400 |
| `id` | UUID generated when the form renders; reused on retry |
| `type` | `demo`, `assessment` or `question` |
| `role` | `hardware`, `product` or `business` |
| `name`, `company`, `message`, `email`, `source_page` | As in the [data model](../data-model.md#inquiry) |
| `rendered_at` | Client time in milliseconds when the form rendered; used only for the timing check |
| `website` | Honeypot; hidden from people and assistive technology, must be empty |

Unknown fields answer 400. There are no cookies and no credentials.

## Responses

| Status | When | Body |
| --- | --- | --- |
| 202 | Stored or already stored (same `id`), or silently rejected as a bot | `{"status":"received"}` |
| 400 | Body is not JSON, fails the schema, or has an unknown `schema_version` | `{"status":"invalid","fields":["email"]}` (field names only, no values) |
| 403 | `Origin` is missing or is not the site URL | `{"status":"forbidden"}` |
| 413 | Body over 16 KiB | `{"status":"too_large"}` |
| 429 | More than 5 requests in 60 s from one address | `{"status":"rate_limited"}` with `Retry-After` |
| 503 | Storage unavailable | `{"status":"unavailable","contact":"<contactAddress>"}` |

- A bot gets the same 202 as a person, so the filter can't be probed. Its inquiry is
  neither stored nor sent.
- 202 means stored. Delivery happens afterwards and is retried
  ([states](../data-model.md#states)).
- The form shows the confirmation on 202, field errors on 400, and the contact
  address on 429, 503 or a network failure.
- Every response carries `Cache-Control: no-store`. Only same-origin requests are
  accepted (`Origin` must equal the site URL), so the endpoint sends no CORS headers.

## Delivery email

- **To**: the configured team address. The binding is restricted to it.
- **From**: a fixed sender on the marketing domain.
- **Reply-To**: the inquiry's `email`.
- **Subject**: `[<type>] <company>: <name>`
- **Body**: plain text with every field, `source_page`, `received_at` (UTC) and `id`.
