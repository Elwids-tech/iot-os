# Staging monitoring, domain and email setup

Status: locally tested implementation and remaining provider setup, updated 2026-10-02. The owner has confirmed purchasing
**elwids.xyz** for the platform, uses **GoDaddy DNS**, and has an existing,
unconfigured **Brevo account**. Public DNS was checked on 2026-10-02; staging
hosting and notification delivery remain unverified. This document defines the work to
perform. No server, DNS record or external sending account has been provisioned.
The owner is considering OVHcloud or Hetzner; the host and alert inbox are pending.

Target: staging handoff Sunday October 4 and client onboarding Monday October 5,
2026, America/Edmonton. Use the [readiness plan](../plan/tasks/staging-monitoring-readiness.md)
for acceptance gates and the [incident runbook](staging-incident-runbook.md) for response.

## Recommended tools

Reuse the monitoring components already packaged in release Compose. Add one
external monitoring provider and one transactional email provider; avoid another
metrics/logs stack before onboarding.

| Tool | Purpose | Location and configuration |
| --- | --- | --- |
| Grafana | Operations dashboard, searchable logs and rule visibility | Staging VM; VPN-only UI; provision dashboards/rules/data sources from Git |
| Prometheus | Metrics collection and service/resource alert rules | Staging VM, private network; seven days / 1 GB retention |
| node-exporter + host collector | Memory, disk, containers, restart/OOM and backup timestamps | Host/private monitoring network; missing expected data is unhealthy |
| blackbox exporter | HTTP readiness and MQTT TLS probes | Private monitoring network; supplements the independent external checks |
| Alloy → Loki | Central logs from applications, workers and infrastructure | Staging VM; three-day retention, bounded 4 GB log filesystem, Docker rotation |
| Alertmanager | Grouping, silences and routing of operational incidents | Private network; alerts must work without opening Grafana or relying on Laravel queues |
| Brevo transactional SMTP | Platform emails and operational alert emails | External delivery service; authenticated domain, STARTTLS and private credentials |
| Better Stack Uptime (proposed) | Public uptime checks and monitoring/backup heartbeats outside the VM | External account; provider-delivered notifications independent of our Brevo credentials |

Better Stack is the proposed external provider to consolidate uptime and heartbeat
checks. Confirm that the chosen subscription supports the required check interval,
heartbeats, recipients and notification channels before adopting it; current
pricing/features have not been checked. Preserve the overall hosting/backup/email
budget and record any added recurring cost. Do not assume SMS or phone escalation
is included. Email is the first delivery channel; mobile push/SMS can follow once
the operator chooses the channel and cost.

Prometheus evaluates metric alerts. Loki's ruler evaluates error patterns and
forwards to the same Alertmanager; Grafana displays both rule sets. Local firing
and resolved delivery was verified through Mailpit. Release rendering now reuses
these components with staging labels, URLs and longer evaluation windows, adding
backup/restore and certificate rules. Target-host delivery still needs testing.
Alertmanager sends directly through SMTP, so a stalled application queue cannot
prevent an infrastructure alert.

## Domain and DNS layout

Confirmed public DNS evidence (2026-10-02): nameservers are
`ns67.domaincontrol.com` and `ns68.domaincontrol.com`. Recursive lookups returned
NOERROR with no MX or root TXT answers. `_dmarc.elwids.xyz` returned
`v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;`.
Preserve that enforced policy and report destination unless the owner deliberately
changes reporting providers. These are point-in-time observations, not a full DNS
zone export; export/review the GoDaddy zone before any edits.

Confirmed platform domain: `elwids.xyz`. Recommended staging deployment base:
`DOMAIN=staging.elwids.xyz`. Release Compose, generated URLs and cookie settings
derive names from this value, so staging cookies remain scoped under the staging
subdomain. Reserve `app.elwids.xyz` and related production names for a later,
separate environment. Do not copy a production APP_KEY or service credentials.

| Name | Purpose | Planned DNS/access |
| --- | --- | --- |
| `app.staging.elwids.xyz` | Client portal | A record to staging VM; public HTTPS |
| `api.staging.elwids.xyz` | Public API and readiness endpoint | A record to staging VM; public HTTPS; internal endpoints denied |
| `admin.staging.elwids.xyz` | Platform administration | A record to staging VM; authenticated/authorized HTTPS; separate operator accounts |
| `mqtt.staging.elwids.xyz` | Device broker | DNS-only A record to staging VM; MQTTS on 8883 |
| `ops.staging.elwids.xyz` | Grafana | Public A record for the current ACME flow; public UI denied; operator split DNS points to VPN address |
| `elwids.xyz` / `www.elwids.xyz` | Future public website | Outside staging setup; preserve any existing records |

Use DNS-only records initially to keep certificate, probe and ingress behaviour
predictable. Add AAAA only when IPv6 routing/firewall have been verified. Public
ops DNS enables the existing Caddy HTTP/TLS certificate challenge; it does not
grant public dashboard access. Test public denial and VPN access separately.
Keep DNS at GoDaddy. The MQTT certificate tooling and Ansible timer now support
`MQTT_ACME_CHALLENGE=webroot` without DNS API credentials. Implemented flow:

- Add an HTTP-only Caddy virtual host for `mqtt.staging.elwids.xyz` that serves
  only `/.well-known/acme-challenge/` from a shared Certbot webroot and returns
  404 otherwise. Keep the broker listener on 8883 with TLS.
- Add a webroot mode to `manage.py certificates`, with a writable directory for
  Certbot and read-only mount in Caddy. Use HTTP-01 issuance; this requires the
  MQTT DNS A record and public port 80 to reach Caddy. Do not attempt wildcard
  certificates through HTTP-01.
- Bootstrap the Caddy challenge endpoint before initial broker issuance, then
  deploy EMQX with the obtained certificate. Adapt the host timer and inputs so
  webroot renewal does not require a Cloudflare token or GoDaddy API access.
- Preserve the existing secure certificate-copy/restart behaviour; test issuance,
  a renewal dry run, certificate reload and reconnect behaviour. Update the
  release runbook and tests before using this path.

The local HTTP challenge and unrelated-path denial have passed. Issuance failure
cleanup and dry-run behavior have tests. Public certificate issuance, renewal,
broker reload and device reconnect remain blocked on the host and DNS. Run
`manage.py certificates ... --dry-run` on that host before accepting the timer.

Caddy issues HTTPS certificates; Certbot provisions/renews the broker certificate.
Test renewal and reload, not only initial issuance. DNS access and the actual VM
address remain prerequisites; no DNS records have been changed by this plan.

## Email setup

Local development uses the project's Mailpit catcher instead of Brevo. See
[local email testing](../deploy/compose/README.md#local-email-testing): on this
workstation the inbox is `http://localhost:8026`, and application containers use
`mailpit:1025`. Local capture does not establish staging email deliverability.
The [local monitoring implementation](local-monitoring.md) also routes Prometheus
and Loki-ruler incidents through Alertmanager to this inbox, with firing/resolved
drills. Loki owns the local log rules; Grafana displays them. Keep this explicit
ownership when adapting the proposed staging design, avoiding duplicate evaluators.

SMTP sending and an inbox are different services. Brevo delivers outbound mail;
receiving mail at `support@elwids.xyz` or `ops@elwids.xyz` needs a mailbox or inbound
forwarding provider. An existing external inbox is sufficient for the initial
alert recipient and avoids making alerts depend on this new domain's inbound setup.

| Mail category | Proposed sender | Recipient and delivery |
| --- | --- | --- |
| Invitations, password resets and application notifications | `no-reply@elwids.xyz`, display name `Elwids Staging` | Explicitly invited/test users through Laravel → Brevo |
| Operational firing/resolved alerts | `alerts@elwids.xyz`, display name `Elwids Staging Alerts` | Confirmed operator inbox through Alertmanager → Brevo |
| Whole-host/monitoring heartbeat alerts | External monitoring provider's verified sender | Same operator's external inbox; optional independent mobile channel |
| Support replies | `support@elwids.xyz` (later, or before client use if promised) | Real mailbox/forwarder; configure and test before advertising the address |

Separate application and alert sender configuration is implemented. `manage.py`
accepts optional `ALERT_FROM_ADDRESS`, `ALERT_SMTP_USERNAME` and `ALERT_SMTP_PASSWORD`
with compatibility fallbacks to the existing mail values. Set both separate SMTP
credentials together and verify all senders. A minimal first setup
can use the same verified sender/key, explicitly documented; it still shares the
provider's outage/quota risk. External monitor delivery must remain independent.

### Account and domain authentication

1. Use the existing Brevo account and GoDaddy DNS; confirm the real operator recipient.
   Store SMTP
   credentials in `/srv/iot/private/environment` or the established private vault,
   never in Git, screenshots, browser frontend configuration or incident records.
2. Add and authenticate `elwids.xyz` in Brevo. Copy the exact verification/DKIM
   records supplied by that account; do not invent selector names or record values.
3. Inspect existing SPF first. If the provider requires an SPF update, merge its
   instructions into the single SPF policy at that name; do not publish multiple
   SPF TXT records. Respect the DNS lookup limit and existing authorized senders.
4. Preserve the observed DMARC `p=quarantine` policy at `_dmarc.elwids.xyz`.
   Complete aligned Brevo DKIM/domain authentication before sending and verify
   a delivered message's DMARC result. Avoid a second DMARC record or changing to
   `p=none` merely to make an incorrectly authenticated sender deliver.
5. Configure MX only if adding inbound mail, using the mailbox provider's exact
   records. Outbound SMTP alone does not require pointing MX records at Brevo.
6. Use `smtp-relay.brevo.com:587` with STARTTLS. Laravel currently uses the `smtp`
   scheme; Alertmanager requires TLS. Verify successful TLS negotiation and aligned
   DKIM/DMARC in a delivered message, plus SPF as applicable to the provider's envelope.
7. Confirm account sending activation, limits and bounce/suppression visibility.
   Reserve capacity for alerts; use grouping/rate control to avoid an error storm
   consuming the email allowance. Treat SMTP rejection and notification failures
   as incidents, with the independent monitor as the fallback.

Keep the initial recipient list small. A delivered notification needs a real
inbox check, not merely an SMTP acceptance log. With explicit authorization to
send test mail, verify an invitation, password reset and operational test alert;
confirm spam placement, links to staging and a resolved message. Do not send
acceptance traffic to a potential client before their onboarding invitation is due.

## Coverage and delivery policy

The detailed thresholds remain in the readiness plan. Configure these groups:

- **Availability:** portal, API readiness, admin sign-in availability, runtime,
  PostgreSQL, MQTT and JetStream. External checks run without VPN access and do
  not expose internal metrics or credentials.
- **Processing:** every enabled worker including automation, failed jobs, queue/
  outbox age, persisted telemetry freshness, DAG consumers and uncertain commands.
- **Capacity/recovery:** memory, CPU pressure, disk and log partition, OOM/restarts,
  certificate expiry/renewal, backup age and overdue restore drills.
- **Monitoring itself:** Prometheus scrapes/evaluation, Loki/Alloy ingestion,
  Alertmanager send failures and the external missing-heartbeat condition.

Proposed external checks: portal and API readiness every 60 seconds, two failures
before alerting, firing/resolved email. Add admin availability if supported by the
chosen quota. Expected detection plus delivery target is five minutes; measure it.
An uptime check does not prove login or data ingestion: rehearse those separately.

Send a monitoring heartbeat every minute to the external provider with a five-minute
missing-heartbeat threshold. The heartbeat job must check expected target health
and notification-path health before sending; a cron process that always pings
would conceal a monitoring failure. Test the exact semantics. Use a separate
backup heartbeat, sent only after successful encrypted off-host upload, with a
26-hour deadline. Never send success at backup start or after local-only output.

These jobs are implemented: configure `MONITORING_HEARTBEAT_URL` and
`BACKUP_HEARTBEAT_URL` privately. Monitoring success requires healthy scrapes,
service probes, expected containers, Prometheus/Loki rule evaluation, recent
notification-failure metrics and an end-to-end log canary. Tests confirm failures
withhold the ping. No external heartbeats or test emails have been sent; provider
setup, inbox acceptance and missed-heartbeat drills remain outstanding.

| Severity | Email handling | Operator action |
| --- | --- | --- |
| Critical | Immediate after evaluation/grouping; repeat every 30 minutes while unresolved; send recovery | Acknowledge within 10 minutes during agreed coverage; escalate to named backup |
| Warning | Group related issues; repeat no more than every four hours; send recovery | Review the same day and before client sessions |
| Informational | Dashboard/log only | No paging for ordinary restarts, successful jobs or validation errors |

Use `[STAGING][CRITICAL] service — symptom` subjects with start time, observed
value, impact, runbook and Grafana links. Group by environment/service/alert name.
Acknowledgement and human escalation need a supported incident tool or an explicit
manual process; Alertmanager email alone does not implement them. Maintenance
silences must expire, including the nightly backup window. Keep one named primary
operator and confirm a backup; do not imply round-the-clock coverage without one.

## Setup order and proof

1. **Inputs:** confirm host, GoDaddy access, alert inbox, Brevo sending activation, external monitor
   subscription and accepted demo scope. Record non-secret decisions in the plan.
2. **DNS/email:** create staging records in GoDaddy, authenticate Brevo senders,
   implement/test MQTT HTTP-01 issuance/renewal, establish TLS and
   authorized test delivery. Preserve existing DNS and mail records.
3. **Release integration:** add automation worker to release/lifecycle/backup and
   metrics, plus the planned SMTP separation and expected-service inventory.
4. **Monitoring:** provision collectors, labels, dashboards, alert routing and
   external uptime/heartbeat checks. Validate pinned-version compatibility.
5. **Failure drills:** stop a worker; emit a benign error fixture; interrupt ingress;
   stop the collector/notification service; simulate missing backup/monitor heartbeat.
   For each, record cause, firing time, receipt, recovery and resolved receipt.
6. **Handoff:** verify off-host restore, complete the applicable soak gate, rehearse
   Monday's client journey and record the exact release and operator contacts.

Store redacted acceptance evidence separately from secrets. The existing 48-hour
soak and Sunday schedule risk still apply; buying the domain resolves ownership,
not DNS, deployment, notification delivery or launch acceptance.

## Remaining decisions

- Staging VM address/provider and access to the confirmed GoDaddy DNS zone.
- Actual email recipient and optional backup recipient; urgent mobile channel.
- Configure the confirmed Brevo account; select an inbound mailbox only if needed.
- External monitor plan/cost and whether proposed one-minute checks fit the budget.
- Monday onboarding time and whether automation/AI are included in the demonstration.
