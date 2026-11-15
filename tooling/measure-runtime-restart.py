#!/usr/bin/env python3
"""What a runtime restart or crash costs on the local stack (ADR-046).

Run it while devices are reporting (a simulator, or the embedded SDK check through
`EMBEDDED_WHILE_REPORTING`). It notes which devices stored a reading in the last
`--window` seconds, restarts the runtime container (`--mode restart`) or kills it and
starts it `--down` seconds later (`--mode kill`), waits `--settle` seconds and reports:

- how long the process was away, from Docker's finish and start times;
- how many of those devices stored a reading again, and how long after the process
  started the first, the median and the last of them did. A device's first reading
  after a start is its birth being handed on, and it takes commands from then;
- the readings each device missed, estimated from its usual interval before the stop;
- how often each edge node announced itself (NBIRTH) afterwards: once is right;
- when the control plane showed those devices unknown (presence other than online, or
  no runtime heartbeat for 20 s), sampled twice a second.

It reads `device_runtime` and `devices` through `psql` in the database container and
changes nothing but the runtime container's state. Outstanding commands are marked
uncertain by the restart, as by any restart.

    tooling/measure-runtime-restart.py --mode restart --label "500 meters"
    tooling/measure-runtime-restart.py --mode kill --down 30
"""
import argparse
import datetime
import json
import statistics
import subprocess
import threading
import time


def psql(args, sql):
    command = ["docker", "exec", "-i", args.db_container, "psql", "-U", args.user, "-d", args.database, "-q", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1"]
    output = subprocess.run(command, input=sql, text=True, capture_output=True, check=True).stdout
    return [line.split("|") for line in output.splitlines() if line]


def docker(*arguments):
    return subprocess.run(["docker", *arguments], text=True, capture_output=True, check=True).stdout.strip()


def docker_time(value):
    """Docker prints nanoseconds; Python reads microseconds."""
    head, _, fraction = value.rstrip("Z").partition(".")
    return datetime.datetime.fromisoformat(f"{head}.{(fraction + '000000')[:6]}+00:00")


def readings(args, since, until):
    """Per device, the receipt times of the messages stored in a range, oldest first."""
    rows = psql(args, f"""SELECT device_uuid, to_char(received_at AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')
 FROM device_runtime.telemetry_events WHERE received_at >= '{since.isoformat()}' AND received_at < '{until.isoformat()}' ORDER BY received_at""")
    by_device = {}
    for device, at in rows:
        by_device.setdefault(device, []).append(datetime.datetime.fromisoformat(at))
    return by_device


def sample_presence(args, devices, stop, samples):
    listed = ",".join(f"'{d}'" for d in devices)
    sql = f"""SELECT count(*) FILTER (WHERE presence <> 'online' OR runtime_seen_at IS NULL OR runtime_seen_at < now() - interval '20 seconds')
 FROM devices WHERE uuid IN ({listed})"""
    while not stop.is_set():
        try:
            samples.append((datetime.datetime.now(datetime.timezone.utc), int(psql(args, sql)[0][0])))
        except (subprocess.CalledProcessError, IndexError, ValueError):
            pass  # the control plane's tables are elsewhere, or the database is busy
        stop.wait(0.5)


def seconds(delta):
    return round(delta.total_seconds(), 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mode", choices=["restart", "kill"], default="restart")
    parser.add_argument("--down", type=float, default=30, help="Seconds a killed runtime stays down (default 30).")
    parser.add_argument("--window", type=int, default=60, help="Devices that stored a reading in this many seconds before the stop are measured (default 60).")
    parser.add_argument("--settle", type=int, default=90, help="Seconds to watch after the start (default 90).")
    parser.add_argument("--label", default="run", help="Names this run in the output.")
    parser.add_argument("--json", help="Also write the figures to this file.")
    parser.add_argument("--container", default="iot-os-dev-runtime-1")
    parser.add_argument("--db-container", default="iot-os-dev-timescaledb-1")
    parser.add_argument("--user", default="iot_os")
    parser.add_argument("--database", default="iot_os")
    args = parser.parse_args()

    now = datetime.datetime.now(datetime.timezone.utc)
    before = readings(args, now - datetime.timedelta(seconds=args.window), now)
    if not before:
        parser.error(f"no device stored a reading in the last {args.window} s: start a simulator first")
    devices = sorted(before)
    rate = sum(len(times) for times in before.values()) / args.window

    stop, samples = threading.Event(), []
    sampler = threading.Thread(target=sample_presence, args=(args, devices, stop, samples), daemon=True)
    sampler.start()
    time.sleep(2)

    stopped_at = datetime.datetime.now(datetime.timezone.utc)
    if args.mode == "restart":
        docker("restart", args.container)
    else:
        docker("kill", args.container)
        time.sleep(args.down)
        docker("start", args.container)
    finished, started = (docker_time(docker("inspect", "--format", "{{.State." + field + "}}", args.container)) for field in ("FinishedAt", "StartedAt"))
    time.sleep(args.settle)
    stop.set()
    sampler.join()
    end = datetime.datetime.now(datetime.timezone.utc)

    after = readings(args, started, end)
    back = sorted(seconds(after[d][0] - started) for d in devices if d in after)
    missed = 0
    for device in devices:
        times = before[device]
        if len(times) < 2 or device not in after:
            continue
        interval = statistics.median((b - a).total_seconds() for a, b in zip(times, times[1:]))
        if interval >= 1:
            missed += max(0, round((after[device][0] - times[-1]).total_seconds() / interval) - 1)
    births = psql(args, f"""SELECT event->'payload'->>'connection_uuid', event->'payload'->>'edge_node_id', count(*)
 FROM device_runtime.outbox WHERE event->>'type' = 'discovery.birth.v1' AND coalesce(event->'payload'->>'device_id', '') = ''
 AND created_at >= '{started.isoformat()}' GROUP BY 1, 2 ORDER BY 3 DESC""")
    unknown = [(at, count) for at, count in samples if count > 0 and at >= stopped_at]

    result = {
        "label": args.label, "mode": args.mode, "devices": len(devices), "messages_per_second_before": round(rate, 1),
        "process_down_s": seconds(started - finished), "devices_back": len(back), "devices_not_back": len(devices) - len(back),
        "first_back_s": back[0] if back else None, "median_back_s": statistics.median(back) if back else None, "last_back_s": back[-1] if back else None,
        "readings_missed_estimate": missed,
        "edge_nodes_announcing": len(births), "most_announcements_by_one_edge_node": int(births[0][2]) if births else 0,
        "unknown_from_s": seconds(unknown[0][0] - stopped_at) if unknown else None,
        "unknown_until_s": seconds(unknown[-1][0] - stopped_at) if unknown else None,
        "most_devices_unknown": max((count for _, count in unknown), default=0),
        "presence_samples": len(samples),
    }
    print(f"{args.label}: {args.mode}, {len(devices)} devices storing {result['messages_per_second_before']} messages a second")
    print(f"  process away                 {result['process_down_s']} s (stopped {finished.isoformat(timespec='seconds')}, started {started.isoformat(timespec='seconds')})")
    print(f"  devices storing again        {result['devices_back']} of {len(devices)} within {args.settle} s")
    if back:
        print(f"  after the start              first {result['first_back_s']} s, median {result['median_back_s']} s, last {result['last_back_s']} s")
    print(f"  readings missed (estimate)   {missed}")
    print(f"  edge nodes announcing        {result['edge_nodes_announcing']}, at most {result['most_announcements_by_one_edge_node']} time(s) each")
    if not samples:
        print("  presence                     not sampled (no devices table in this database)")
    elif unknown:
        print(f"  shown unknown                from {result['unknown_from_s']} s to {result['unknown_until_s']} s after the stop, up to {result['most_devices_unknown']} devices")
    else:
        print("  shown unknown                never")
    if args.json:
        with open(args.json, "w") as file:
            json.dump(result, file, indent=2)
            file.write("\n")


if __name__ == "__main__":
    main()
