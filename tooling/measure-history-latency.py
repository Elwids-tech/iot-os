#!/usr/bin/env python3
"""Ingestion-to-history latency on the local stack (spec 029 SC-004, constitution IX).

Waits `--minutes`, then reads, for each message received after `--warmup` seconds, when
its storing transaction committed: the commit timestamp of its observation rows, which
commit in that transaction and are never updated (`track_commit_timestamp` must be on;
the telemetry outbox row is no use, as the relay updates it). It reports messages per
second and, from the runtime receiving a message (p50/p95/p99/max):

- `visible`: to its storing transaction committing, when the readings are in history;
- `queued`: to the transaction writing its outbox row, near its start;
- `storing`: from that outbox row to the commit, the part counting adds an upsert to.

Nothing polls, so the figures carry no probe delay. Run it once per runtime build under
the same simulator load and compare.

    docker exec iot-os-dev-timescaledb-1 psql -U iot_os -c "ALTER SYSTEM SET track_commit_timestamp = on"
    docker restart iot-os-dev-timescaledb-1
    tooling/measure-history-latency.py --label counting
"""
import argparse
import datetime
import subprocess
import time

REPORT = """
WITH messages AS (
  SELECT o.event_uuid, min(o.received_at) AS received_at, pg_xact_commit_timestamp((array_agg(o.xmin))[1]) AS committed_at
  FROM device_runtime.observations o
  WHERE o.received_at >= :'start'::timestamptz AND o.received_at < :'end'::timestamptz
  GROUP BY o.event_uuid
), m AS (
  SELECT extract(epoch FROM m.committed_at - m.received_at) AS visible,
         extract(epoch FROM t.created_at - m.received_at) AS queued,
         extract(epoch FROM m.committed_at - t.created_at) AS storing
  FROM messages m JOIN device_runtime.telemetry_outbox t ON t.telemetry_uuid = m.event_uuid
  WHERE m.committed_at IS NOT NULL
)
SELECT count(*) AS messages,
       round(count(*) / extract(epoch FROM :'end'::timestamptz - :'start'::timestamptz), 1) AS per_second,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY visible)::numeric * 1000, 1) AS visible_p50_ms,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY visible)::numeric * 1000, 1) AS visible_p95_ms,
       round(percentile_cont(0.99) WITHIN GROUP (ORDER BY visible)::numeric * 1000, 1) AS visible_p99_ms,
       round(max(visible)::numeric * 1000, 1) AS visible_max_ms,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY queued)::numeric * 1000, 1) AS queued_p50_ms,
       round(percentile_cont(0.99) WITHIN GROUP (ORDER BY queued)::numeric * 1000, 1) AS queued_p99_ms,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY storing)::numeric * 1000, 1) AS storing_p50_ms,
       round(percentile_cont(0.99) WITHIN GROUP (ORDER BY storing)::numeric * 1000, 1) AS storing_p99_ms
FROM m;
"""


def psql(args, sql, variables):
    command = ["docker", "exec", "-i", args.container, "psql", "-U", args.user, "-d", args.database, "-q", "-v", "ON_ERROR_STOP=1"]
    for name, value in variables.items():
        command += ["-v", f"{name}={value}"]
    return subprocess.run(command + ["-x"], input=sql, text=True, capture_output=True, check=True).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--label", default="run", help="Names this run in the output.")
    parser.add_argument("--minutes", type=float, default=12, help="How long the run lasts (default 12).")
    parser.add_argument("--warmup", type=int, default=120, help="Seconds left out at the start (default 120).")
    parser.add_argument("--container", default="iot-os-dev-timescaledb-1")
    parser.add_argument("--user", default="iot_os")
    parser.add_argument("--database", default="iot_os")
    args = parser.parse_args()

    if "on" not in psql(args, "SHOW track_commit_timestamp;", {}):
        parser.error("track_commit_timestamp is off: turn it on and restart the database (see --help)")

    start = datetime.datetime.now(datetime.timezone.utc)
    time.sleep(args.minutes * 60)
    end = datetime.datetime.now(datetime.timezone.utc)
    # Messages received just before the end are still being stored.
    time.sleep(5)
    window = {"start": (start + datetime.timedelta(seconds=args.warmup)).isoformat(), "end": end.isoformat()}
    print(f"{args.label}: {window['start']} to {window['end']}")
    print(psql(args, REPORT, window))


if __name__ == "__main__":
    main()
