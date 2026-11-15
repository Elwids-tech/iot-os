# ADR-045: Tenant Adapter Runtimes Run the Platform's Nodes Without Node-RED

**Status:** Proposed
**Date:** 2026-11-14
**Amends:** [ADR-010](ADR-010-per-tenant-adapter-runtimes.md)
**Relates to:** [ADR-004](ADR-004-node-red-adapter-runtime.md), [ADR-022](ADR-022-webhook-receiver.md), [ADR-023](ADR-023-protocol-connectors.md)

## Context

Every organization that uses adapters gets a pair of containers: a Mosquitto ingress
broker and a Node-RED runtime (ADR-010). An architecture review asked whether a full
Node-RED per tenant is justified when all it runs is a decoder. This record answers
that from the code and from measurements.

### What Node-RED does here

The flow is generated and fixed. [`lib/flow.cjs`](../../services/adapters/lib/flow.cjs)
writes one tab and four nodes per adapter (source, decoder, publisher, reporter), always
wired the same way. Nobody edits a flow: the editor is disabled
([`runtime-settings.cjs`](../../services/adapters/runtime-settings.cjs)), the runtime
has no published port, and its admin API accepts only the manager's per-tenant token.

All four node types are the platform's own, in
[`nodes/adapter.js`](../../services/adapters/nodes/adapter.js). They use none of
Node-RED's nodes:

| Need | What serves it |
| --- | --- |
| MQTT to the source and to the platform broker | `mqtt.js` clients created in the source and publisher nodes |
| HTTP polling | [`lib/poll.cjs`](../../services/adapters/lib/poll.cjs) on `node:https` |
| Decoder sandbox | [`lib/decoder.cjs`](../../services/adapters/lib/decoder.cjs), a worker running QuickJS |
| Cursor, births, deduplication, `bdSeq` | Files in `/data` written by [`lib/state.cjs`](../../services/adapters/lib/state.cjs) |
| Sparkplug B encoding | [`lib/sparkplug.cjs`](../../services/adapters/lib/sparkplug.cjs) |
| Reports to the API | `fetch` in the reporter node |

What is left for Node-RED:

1. **Deploying.** The manager reads `/flows`, replaces one adapter's nodes and posts
   the result with the `flows` deployment type, so only changed nodes restart
   ([`manager.cjs`](../../services/adapters/manager.cjs), `admin` and `deploy`).
2. **Remembering.** `flows.json` and the encrypted `flows_cred.json` in `/data`
   restart the adapters after a container restart without Laravel. The encryption key
   sits beside them in the tenant's `manager.json` on the same host.
3. **Node lifecycle and wiring.** `close` on redeploy, and messages passed along the
   wires. The wiring does not fit: a source must wait until the publisher has settled
   an input, Node-RED passes messages and not callbacks, so the nodes keep their own
   registry of waiting sources (`waiting`, at the top of `nodes/adapter.js`).

The unit tests already run the four nodes without Node-RED, on a 23-line stand-in
([`test/fake-red.cjs`](../../services/adapters/test/fake-red.cjs)).

Node-RED has also been the cause of adapter failures that had nothing to do with
adapters: its entrypoint ignored `--settings`, so the platform nodes never loaded; its
image healthcheck reported every tenant runtime unhealthy (both noted in the
[`Dockerfile`](../../services/adapters/Dockerfile)); and a `null` credential crashed
`setFlows`, so no adapter could deploy on the pilot
([gotchas](../dev/gotchas.md)).

### What the per-tenant pair isolates

| Isolation | Provided by | A shared host would have to |
| --- | --- | --- |
| Tenants' fixed vendor topics do not collide | One broker per tenant | Give each tenant its own topic namespace on one broker |
| A device can publish only its adapter's topics; default deny | Dynamic Security clients and roles on the tenant broker, own CA and port | Keep per-tenant identities, CA and port on one broker |
| Tenant decoder code cannot reach the host | QuickJS in a worker, in `lib/decoder.cjs` | Nothing: this is not a container property |
| One tenant cannot starve another | 512 MiB and 1 CPU on the runtime, 256 MiB and 0.5 CPU on the broker (`manager.cjs`) | Schedule decoding and bound memory per tenant in process |
| One tenant's crash stops only its adapters | Separate processes | Nothing equivalent: one uncaught error is a node death for every tenant |
| One tenant's source and platform credentials are not in another's process | Separate containers and `/data` directories | Nothing equivalent |
| Polling budget of 60 requests a minute per organization | One process per organization: the bucket is a module global (`budget` in `nodes/adapter.js`) | Key it by tenant |

Network isolation is not provided today: tenant containers join the platform network
(a known risk in ADR-010). No option below changes that.

ADR-010 records the broker's limit as 128 MiB; the code sets 256 MiB.

### Measured cost

Measured on a development machine (Docker Desktop, arm64) on 2026-11-14. The dev
stack's one tenant pair was read with `docker stats`. The load figures come from a
throwaway copy of the runtime image with the manager's limits (512 MiB, 1 CPU), one
adapter, 20 activated sources and a four-metric decoder, publishing to a throwaway
broker. "Without Node-RED" is the same image and the same `nodes/adapter.js`, started
by a 20-line script in place of Node-RED.

| | Node-RED runtime | Same nodes without Node-RED | Tenant broker |
| --- | --- | --- | --- |
| Idle, dev stack, up 8 hours | 94 MiB | not measured | 2.7 MiB |
| Idle, fresh, one adapter | 59 to 62 MiB | 27 MiB | 1.4 MiB |
| 10 messages a second for 60 s | 89 to 109 MiB, 55 to 60% of a CPU | 47 to 74 MiB, 55 to 58% of a CPU | 2 to 3 MiB, 0.2% |
| 1,500 queued messages | 18.6 a second at 100% CPU, up to 134 MiB | 18.8 a second at 100% CPU, up to 88 MiB | |
| After the load | 112 MiB | 81 MiB | |
| Start until it accepts a deployment | 1.15 s | 0.29 s | |
| Image | 703 MB (base image 669 MB) | about 200 MB (the webhook receiver's image, same dependencies, is 197 MB) | 14 MB |

Three things follow.

- **Node-RED costs about 30 MiB a tenant and nothing in CPU.** The pair is about
  97 MiB idle; without Node-RED it would be about 65 MiB.
- **The decoder, not Node-RED, sets the CPU cost and the ceiling.** Each message
  starts a new worker that loads QuickJS: 60 ms of CPU a message, so a tenant tops out
  near 19 messages a second on its one CPU. Creating a fresh QuickJS runtime and
  context for each message on an engine already loaded took 1.2 ms in the same
  container. That is a fifty-fold difference and it is independent of this decision.
- **The broker is nearly free.** Sharing it would save under 3 MiB a tenant.

Not measured: the pilot host, more than one adapter per tenant, sources other than
MQTT, long-run memory growth without Node-RED, and a production-sized host. The dev
database has one adapter tenant among eight organizations.

### Options

**A. Keep Node-RED per tenant.** Isolation as today. About 97 MiB a tenant. No
change to decoders, no migration. The failures and the 700 MB image stay.

**B. A small platform-owned host per tenant.** The pair, the broker, the limits and
the manager's container handling stay. Node-RED is replaced by a host process that
loads the same four nodes. Isolation as today. About 65 MiB a tenant, a third less;
image about 200 MB; start under a second. Decoders: no change, because
`lib/decoder.cjs`, the decoder input and output and the publisher are the same files.

**C. One shared decoder host and one shared ingress broker.** Per-tenant idle cost
falls to a few MiB (connections and state). Decoders: no change. Everything in the
right-hand column of the isolation table has to be built, and two rows cannot be: a
crash and a credential leak become platform-wide. The broker would need one listener
per tenant with its own certificate and topic prefix and per-listener security;
whether Mosquitto's Dynamic Security plugin supports that was not verified. Migration
moves every tenant's devices to a new broker identity store at once, and rollback
means running both systems.

| Tenants | A | B | C (estimate) |
| --- | --- | --- | --- |
| 10 | 1.0 GiB | 0.65 GiB | 0.2 GiB |
| 100 | 9.5 GiB | 6.3 GiB | 0.6 GiB |
| 1,000 (the port range's limit) | 95 GiB | 63 GiB | 4 GiB |

## Decision

**Keep one broker and one runtime container per tenant. Replace Node-RED inside the
runtime with a small host owned by the platform (option B). Do not build a shared
host (option C).**

1. **The host.** A Node process in the tenant runtime image, built on `node:22-alpine`
   like the manager. It loads `nodes/adapter.js` and wires the four nodes of each
   adapter directly. The nodes keep their code; the `waiting` registry can later
   become a plain callback.
2. **Its API.** HTTP on the container's private port, behind the same per-tenant
   bearer token: put one adapter's definition, remove one adapter, list what runs with
   each adapter's revision, and a health answer. Putting an adapter restarts only that
   adapter, as the `flows` deployment type does today. The manager's `deploy` and
   `remove` call it in place of `/flows` and still confirm the applied revision.
3. **Its memory.** The host stores each adapter's last definition, secrets included,
   in one file in `/data` (mode 0600) and starts from it. Secrets are encrypted with
   the tenant's existing credential secret, as now.
4. **Unchanged.** The decoder contract and its limits, the Sparkplug output, the
   state files and their names, the ingress broker and its identities, the webhook
   hand-off, the container limits and security options, the manager's API towards
   Laravel, and everything in Laravel except the migration command below.
5. **Not Node-RED compatible.** Flows, the Node-RED admin API and Node-RED palette
   nodes are no longer available in a tenant runtime. ADR-023's tenant connectors are
   written as platform nodes on protocol libraries.

### Migration and rollback

- The manager already recreates a tenant runtime when its image changes
  (`ensureContainer`). The new host starts with no adapters, so a Laravel command
  queues a deployment of the applied revision for every running adapter after the
  release. Laravel owns the desired state; nothing is read from `flows.json`.
- Each adapter's publisher sends a node death and a node birth once, as on any
  redeploy today. Births, deduplication, cursors and `bdSeq` are read from the same
  files, so sources come back with their births and polling resumes from its cursor.
  Webhook deliveries wait in the broker session meanwhile (ADR-022).
- `flows.json` and `flows_cred.json` are left in `/data`. Rolling back is the previous
  runtime image and the same command: Node-RED starts from its own files, then takes
  the redeploys.
- The release must pull the tenant runtime image, which `manage.py` does not do today
  ([pilot](../ops/pilot.md)).

## Consequences

**Easier**

- About 30 MiB less per tenant, a 500 MB smaller image and a start under a second.
- The runtime is code the platform owns end to end: no Node-RED settings, entrypoint,
  healthcheck or credential handling to work around, and about 116 MB of dependencies
  leave the image.
- The integration test no longer needs a Node-RED installation.
- The host API can report what an adapter is doing (revision, source state), which
  the Node-RED admin API could not.

**Harder**

- The platform now owns deployment and persistence that Node-RED supplied: atomic
  replacement of one adapter, restart from disk, orderly close. They are small, but
  they are ours to test.
- One planned interruption per adapter at the upgrade.
- The option of dropping a community Node-RED node into a tenant runtime is given up.
  Nothing uses one, and such a node would not honour the settle-before-acknowledge
  rule, but ADR-004 counted it as a reason for Node-RED.

**What the owner must weigh**

- The memory saved is small at today's tenant counts: 0.3 GiB at ten tenants. If
  memory were the only reason, keeping Node-RED (option A) would be the right call
  until there are several dozen tenants. The case for B is ownership and fewer
  failure modes, with memory as a side benefit.
- Option C is the only one that changes the cost curve, and it gives up crash and
  credential isolation between tenants. It is worth reopening only if per-tenant cost
  near 65 MiB blocks a plan, and then for the decoder host alone, keeping per-tenant
  brokers.

**Follow-up, not decided here**

- Reuse a decoder worker across messages with a fresh QuickJS runtime and context
  each time, replacing the worker only when it overruns. ADR-010 specifies a
  disposable worker per message, so this needs its own decision. It is worth more than
  this record: about fifty times less CPU per message and a far higher ceiling per
  tenant.
- Correct ADR-010's broker limit (128 MiB recorded, 256 MiB in code).
- The atlas diagrams (`adapter-runtime`, `adapter-deploy`, `http-sources`, `data-in`)
  and [adapters](../features/adapters.md) change with the implementation, not with
  this record.
