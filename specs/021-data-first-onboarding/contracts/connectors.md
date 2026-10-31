# Connector Definitions

A definition is platform configuration, not tenant data. Each one is a class in
`apps/api/app/Domain/Onboarding/Connectors` implementing `Connector`, listed in
`config/onboarding.php`, and served by `GET connectors` ([API](api.md#connectors-new)).
The portal pairs each key with a settings form in `apps/portal/src/sources/connectors.tsx`.

## Start screen

The answers are plain words; no answer names a protocol (FR-001).

| Answer | Then | Connector |
| --- | --- | --- |
| The device can send to a server address I choose | It speaks Sparkplug B, by itself | `sparkplug_direct` |
| | It speaks Sparkplug B through a gateway | `sparkplug_gateway` |
| | It sends its own format, or I don't know | `tenant_mqtt` |
| It's in the manufacturer's cloud or app | Their cloud can send to a web address | `webhook` |
| | They give me an API key | `poll` |
| | They give me an MQTT server | `vendor_mqtt` |
| It's on a local plant network | Explains the edge gateway path with a Sparkplug B uplink (ADR-023) | `sparkplug_gateway` |
| It's already sending data | The waiting sources, as in Discovery | Each source's own |
| I'm not sure | Describe it, paste a message or attach the datasheet | The assistant, if enabled, or the pasted message's shape |

With the assistant disabled, "I'm not sure" takes a pasted message and asks the
three questions that decide the path: where the data is, whether the device can be
pointed at an address, and whether it speaks Sparkplug B. The person picks the
answer, and the pasted message becomes a pasted sample.

## The definitions

| Key | Source type | Capture | Readings | Needs | Availability | Reason codes (beyond `no_input`) |
| --- | --- | --- | --- | --- | --- | --- |
| `tenant_mqtt` | `platform` | `broker_capture` | `field_mapping` | The device's MQTT settings screen | Adapters enabled; `Device.manage-connections` for the kit | `credentials_rejected`, `not_connected`, `off_filter`, `other_source_topic`, `sparkplug_detected` |
| `vendor_mqtt` | `vendor` | `broker_capture` | `field_mapping` | The vendor's broker address, username, password, topics | Adapters enabled | `credentials_rejected`, `not_connected`, `subscribe_refused`, `client_id_refused`, `private_address` |
| `webhook` | `webhook` | `webhook_samples` | `field_mapping` | Access to the vendor cloud's webhook settings | Adapters enabled and `adapters.webhook_public_url` set | `signature_invalid`, `secret_missing`, `too_large`, `rate_limited`, `method_not_allowed` |
| `poll` | `poll` | `fetch_now` | `field_mapping` | An API key and the API documentation | Adapters enabled | `http_401`, `http_403`, `http_404`, `http_429`, `http_5xx`, `timeout`, `records_not_found`, `private_address` |
| `sparkplug_direct` | none | `sparkplug_birth` | `profile_metrics` | The device's MQTT settings screen | Always | `no_birth`, `credentials_rejected` |
| `sparkplug_gateway` | none | `sparkplug_birth` | `profile_metrics` | A gateway already added, or its settings | Always | `no_birth`, `gateway_offline` |
| `lab_mqtt` (test only) | `platform` | `broker_capture` | `field_mapping` | Nothing | `IOT_ONBOARDING_TEST_CONNECTORS=true` | `no_input` |

Each reason has a `title`, `explanation` and `fix` in plain words. Here is
`credentials_rejected` for `tenant_mqtt`:

- **Title**: "The device's password was refused"
- **Explanation**: "Your device reached the server, but its username or password does
  not match a credential for this data source."
- **Fix**: "Copy the username and password from the connection kit again. If you
  downloaded a new kit, the old password stopped working."

## Adding a connector (FR-082)

A new connector needs only these four things, with no change to the start screen,
steps, summary, success state or Manage:

1. A definition class and its `config/onboarding.php` entry.
2. A settings form registered in `sources/connectors.tsx`.
3. A capture method, either an existing one or a new one implementing
   `CaptureMethod`.
4. A readings mode. `point_map` is reserved for typed protocols (ADR-023), and its
   editor is specified with the first typed connector.

`lab_mqtt` exists to prove this list in CI (SC-008).
