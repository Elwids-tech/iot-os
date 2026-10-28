# Quickstart: HTTP Adapter Sources

Runnable checks that prove the feature end to end in the local stack. They use the
simulators, never real vendor accounts.

## Prerequisites

- The devices stack with the adapter overlay ([local setup](../../docs/dev/local-setup.md)),
  rebuilt with `adapter-manager`, `webhook-receiver`, `adapter-runtime-image`, the API
  family, the runtime and the portal.
- The private adapter env file sets `IOT_WEBHOOK_PUBLIC_URL=http://localhost:8095`,
  `IOT_WEBHOOK_RECEIVER_TOKEN` (≥ 32 random bytes) and
  `IOT_ADAPTER_ALLOW_PRIVATE_BROKERS=true` (development only, so the runtime can reach
  simulators on the host).
- A published profile with the tracker parameters (`latitude`, `longitude`,
  `temperature`, `humidity`, `battery`) and one with the sensor parameters
  (`temperature`, `battery`).
- Simulators: `.local/devices/python/bin/python tooling/simulators/vendor_tracker_api.py --port 8096 --api-key <key>` and
  `tooling/simulators/vendor_webhook_cloud.py` (below).

## A. Webhook vendor cloud (US1, US2, US5)

1. Adapters → **New adapter**, name "Cloud sensors", the sensor profile, Source
   **Vendor cloud sends webhooks**, authentication **HMAC signature** with header
   `x-signature`, prefix `sha256=`, timestamp header `x-timestamp`. Save, then
   **Create secret**; copy the URL and the secret.
2. `python tooling/simulators/vendor_webhook_cloud.py --url <ingest URL> --secret <secret> --devices 3 --interval 5`.
   The checklist's Connect step turns done and Capture samples lists deliveries
   within 10 s; nothing is stored as telemetry.
3. **Add as fixture** on one delivery, write or let the assistant draft the decoder
   (the simulator posts a list of messages, so the decoder returns a list), run tests,
   deploy. Three sources appear under Devices; activate one; its readings appear on the
   device page with the simulator's timestamps.
4. `--bad-signature`, `--oversize`, `--burst 300` and `--no-secret`: each shows on the
   Activity tab with its reason within a minute; the simulator sees `401`, `413`, `429`.
5. `--duplicate` resends the same message id: one reading is stored.
6. **Rotate**: create a second secret; the simulator keeps working with the old one;
   restart it with the new one; **Revoke** the old one; old-secret deliveries get `401`
   within 10 s.
7. Stop the tenant runtime container while the simulator posts, start it again: every
   `202`-answered message is stored once.

## B. Polling a tracker history API (US3, US4)

1. New adapter "Trackers", the tracker profile, Source **Poll a vendor API**: `GET`
   `http://host.docker.internal:8096/accounts/A1/streams/history`, query
   `start={cursor}`, `end={now}`, `limit` as the page size parameter with 500, records
   `/data`, cursor **Timestamp** at `/maxDate`, API key in header `x-api-key`. Save,
   enter the key, **Fetch now**: status 200, the records, the next cursor; the stored
   cursor does not move.
2. Add two records as fixtures, decoder with `observedAt` from the record's time and
   `messageId` from its id; test; deploy with the cursor starting 2 hours back.
3. Within one interval every record of the last 2 hours is stored with its own time;
   the device map shows the newest fix with its record time; older fixes are history.
4. `curl -X POST localhost:8096/_control -d '{"fault":"500","count":3}'`: the
   Activity tab shows **Retrying** with the next attempt; then success resumes.
5. Restart the runtime container in the middle of a run: no gaps, no duplicates
   (compare the simulator's `GET /_served` with stored readings using
   `tooling/verify-http-adapters.mjs --check B`).
6. `{"fault":"401"}`: **Stopped: credentials rejected**; save a new key and redeploy,
   or **Resume**.
7. **Reset cursor** to 30 minutes ago: records fetched again are not stored twice.
8. Settings with `https://127.0.0.1/…` are refused at save; with the development switch
   off, a host resolving to a private address fails Fetch now.

## C. Onboarding assistant (US6)

With the assistant enabled: **Add device** → **Ask the onboarding assistant** →
"I have cellular asset trackers; their data is only in the vendor's REST API" plus the
simulator's `tooling/simulators/vendor_tracker_api.md` attached. Expect: questions with choices; a
recommendation for HTTP polling; a proposal to create the tracker profile (when absent)
reviewed section by section; a proposal to create the adapter; a request to enter the
API key in the form; a Fetch now shown in the chat; a change proposal with decoder,
records and cursor settings and two fixtures; buttons for Run tests and Deploy. Ask
"what is my API key?": the assistant declines and points to the form. Repeat with
"my sensor speaks Sparkplug B": it opens Add device in direct mode and creates nothing.

## D. Isolation and security (FR-080, SC-005)

`php artisan test --compact --filter=HttpAdapter` covers cross-organization secrets,
deliveries, runs, cursors and conversations; `npm test --prefix services/adapters`
covers address checks (literal, resolving, redirect, rebinding) and that one adapter's
secret cannot deliver to another's URL.

## E. With the assistant disabled

Repeat A and B with `IOT_ASSISTANT_ENABLED=false`: the checklist, samples, Fetch now
and every step work; no assistant entry points are shown.
