# Local release verification

Verified on the development workstation on 2026-09-26. This is local packaging
and recovery evidence, not acceptance of a provisioned Hetzner environment.

- PHP: 168 tests, 1,684 assertions passed, including staging refusal in production,
  preservation on bootstrap reruns, protected metrics and HTTP aggregation.
- Release tooling: seven unit tests passed. Runtime Go tests and portal/admin/API
  client type checks passed.
- Production API/PHP-FPM and Nginx images built. Affected development API,
  workers, runtime and both frontend containers were rebuilt and recreated.
  API `/up`, portal and admin returned HTTP 200. Separate browser tabs verified
  login rendering, theme controls and the staging label without touching user drafts.
- Prometheus validated all 18 alert rules. Ansible syntax, Caddy configuration,
  Loki and Alloy configuration checks passed.
- `tooling/release/verify_local.py --keep` completed against a disposable Compose
  project: separate migration jobs, least-privilege database roles, readiness,
  generated accounts, all five simulator activations and initial geofence runtime
  acknowledgements, repeat bootstrap, and protected metrics.
- The rehearsal restored a database dump into an independent Timescale instance,
  retained accounts/devices/history, quarantined queued side effects, and resumed
  the source deployment successfully. Disposable containers/volumes were removed.

## Remote pilot verification — 2026-10-04

The [Hetzner pilot runbook](../../docs/pilot-two-server-deployment.md) records
the deployed revision, actual provider/host layout, repository-scoped image
transfer and current launch limits. CI release/image export succeeded. Remote
HTTPS/readiness, key-only SSH, WireGuard, private database traffic, public IPv4
port checks, Brevo delivery, alert/watchdog notifications, certificate renewal
dry-run and separate host reboot recovery were exercised. The newest encrypted
off-site checkpoint restored into an isolated database, with 83 public tables
verified after side-effect quarantine. Local split-database container verification
and 19 release tests passed separately.

This does not establish full replacement-host/broker restoration, measured
recovery time, client hardware/tenant ACL/password-invitation acceptance, complete
public IPv6 checks, WAL/PITR, provider-wide external monitoring or a 48-hour soak.
Review the EMQX hosted/SaaS licensing gate before external use. Do not interpret
the older local fixture evidence as current client-environment acceptance.

The broad local `tooling/monitoring/verify.py --drills` run on this date could
not reach its failure drills because development API/runtime readiness failed.
The local runtime reports `workflow telemetry checkpoint lost continuity;
recovery required`. Its retained state was preserved; this is not a passing
local monitoring acceptance run. The parser configuration was validated with
Alloy itself and recreated in both local and remote environments separately.
