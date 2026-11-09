#!/usr/bin/env python3
"""Ingestion-to-history latency on the local stack (spec 029 SC-004, constitution IX).

Polls the runtime's committed telemetry every 100 ms for `--minutes` and records when
each message first becomes visible in history: its `telemetry_outbox` row commits in
the same transaction as its observations. After `--warmup` seconds it reports messages
per second, the time from the runtime receiving a message to it being visible
(p50/p95/p99/max; the 100 ms polling adds about 50 ms to each), and the time to its
storing transaction starting (the queue). Run it once per runtime build under the same
simulator load and compare. The probe's rows go in an unlogged scratch table in the
dev database; `--drop` removes it.

    tooling/measure-history-latency.py --label counting
    tooling/measure-history-latency.py --drop
"""
import argparse
import datetime
import subprocess

TABLE = "public.history_latency_probe"

PROBE = f"""
CREATE UNLOGGED TABLE IF NOT EXISTS {TABLE} (
  seq bigint PRIMARY KEY, seen_at timestamptz NOT NULL, received_at timestamptz NOT NULL, run text NOT NULL);
INSERT INTO {TABLE}(seq, seen_at, received_at, run)
SELECT o.sequence, clock_timestamp(), (o.event->'readings'->0->>'received_at')::timestamptz, :'run'
FROM device_runtime.telemetry_outbox o
WHERE o.sequence > (SELECT coalesce(max(seq), (SELECT max(sequence) FROM device_runtime.telemetry_outbox)) - 300 FROM {TABLE})
  AND jsonb_array_length(o.event->'readings') > 0
  AND NOT EXISTS (SELECT 1 FROM {TABLE} s WHERE s.seq = o.sequence)
\\watch interval=0.1 count=:polls
"""

REPORT = f"""
WITH probe AS (
  SELECT extract(epoch FROM seen_at - received_at) AS visible FROM {TABLE}
  WHERE run = :'run' AND received_at >= :'start'::timestamptz AND received_at < :'end'::timestamptz
), outbox AS (
  SELECT extract(epoch FROM created_at - (event->'readings'->0->>'received_at')::timestamptz) AS queued
  FROM device_runtime.telemetry_outbox
  WHERE created_at >= :'start'::timestamptz AND created_at < :'end'::timestamptz AND jsonb_array_length(event->'readings') > 0
)
SELECT (SELECT count(*) FROM probe) AS messages,
       round((SELECT count(*) FROM probe) / extract(epoch FROM :'end'::timestamptz - :'start'::timestamptz), 1) AS per_second,
       (SELECT round(avg(visible)::numeric * 1000) FROM probe) AS visible_mean_ms,
       (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY visible)::numeric * 1000) FROM probe) AS visible_p50_ms,
       (SELECT round(percentile_cont(0.95) WITHIN GROUP (ORDER BY visible)::numeric * 1000) FROM probe) AS visible_p95_ms,
       (SELECT round(percentile_cont(0.99) WITHIN GROUP (ORDER BY visible)::numeric * 1000) FROM probe) AS visible_p99_ms,
       (SELECT round(max(visible)::numeric * 1000) FROM probe) AS visible_max_ms,
       (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY queued)::numeric * 1000) FROM outbox) AS queued_p50_ms,
       (SELECT round(percentile_cont(0.95) WITHIN GROUP (ORDER BY queued)::numeric * 1000) FROM outbox) AS queued_p95_ms;
"""


def psql(args, sql, variables):
    command = ["docker", "exec", "-i", args.container, "psql", "-U", args.user, "-d", args.database, "-q", "-v", "ON_ERROR_STOP=1"]
    for name, value in variables.items():
        command += ["-v", f"{name}={value}"]
    return subprocess.run(command + ["-x"], input=sql, text=True, capture_output=True, check=True).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--label", default="run", help="Names this run in the probe table.")
    parser.add_argument("--minutes", type=float, default=12, help="How long to poll (default 12).")
    parser.add_argument("--warmup", type=int, default=120, help="Seconds left out at the start (default 120).")
    parser.add_argument("--container", default="iot-os-dev-timescaledb-1")
    parser.add_argument("--user", default="iot_os")
    parser.add_argument("--database", default="iot_os")
    parser.add_argument("--drop", action="store_true", help="Drop the probe table and stop.")
    args = parser.parse_args()

    if args.drop:
        psql(args, f"DROP TABLE IF EXISTS {TABLE};", {})
        print(f"Dropped {TABLE}.")
        return

    start = datetime.datetime.now(datetime.timezone.utc)
    psql(args, PROBE, {"run": args.label, "polls": int(args.minutes * 600)})
    end = datetime.datetime.now(datetime.timezone.utc)
    window = {"run": args.label, "start": (start + datetime.timedelta(seconds=args.warmup)).isoformat(), "end": end.isoformat()}
    print(f"{args.label}: {window['start']} to {window['end']}")
    print(psql(args, REPORT, window))


if __name__ == "__main__":
    main()
