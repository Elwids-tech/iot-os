# Decoder Input and Output (additive)

Schemas `contracts/adapters/v1/decoder-input.v1` and `decoder-output.v1`.

## Input

Every source: `payload` (parsed JSON or `null`), `bytes`, `payloadBase64`, `topic`,
`receivedAt`, `retained`, `qos`, and the new `source` (`mqtt`, `webhook`, `poll`).

- Webhook: `topic` is the path below the ingest URL (`""` when none) and
  `http = {method, path, query, contentType, headers, deliveryId}`; `retained` is
  `false`, `qos` is `1`.
- Polling: `payload` is one record, `bytes`/`payloadBase64` its JSON, `topic` is `""`,
  `receivedAt` is when the page arrived, `poll = {page, index, count, cursor}`.

## Output

One result or a list of 1–500 results:

```js
{ sourceDeviceId, metrics: [{ name, value, unit? }], observedAt?, messageId? }
```

- Each result is validated alone; an invalid one fails alone with a diagnostic.
- Without `observedAt` a result is receipt-timed (FR-050).
- Results of one input are published oldest observation first; a result older than
  the newest already published for its source device is historical (FR-053).
- `messageId` deduplicates per adapter and source device for 7 days (FR-062).
