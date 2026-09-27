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

## Evidence still required before inviting testers

The GitHub release workflow has not run remotely. No cloud host or public release
has been deployed. Verify x86 image publishing, host provisioning/firewall/VPN,
DNS and real certificate renewal, SMTP delivery and password/invitation flows,
external alerts, MQTT ACL rejection, failure/reboot/upgrade/rollback recovery,
and AI provider controls on the target environment.

The successful database restore does **not** verify the complete encrypted
off-host Restic archive roundtrip, cold broker/JetStream state recovery, or the
one-working-day recovery target. Rehearse those on a disposable host. The 48-hour
soak and 25% memory-headroom acceptance gate have not been run. Review the EMQX
license before external use. See README.md for required private inputs and gates.
