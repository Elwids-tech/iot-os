#!/usr/bin/env python3
"""Run on the deployed Linux host: python3 soak.py --env ... --manifest ... --output ... ."""
import argparse
import json
from pathlib import Path
import time
from urllib.parse import urlencode

from manage import Deployment, private_write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--hours', type=float, default=48)
    args = parser.parse_args()
    if args.hours <= 0:
        parser.error('Hours must be positive')
    deployment = Deployment(args.env, args.manifest)
    output = Path(args.output)
    if output.exists():
        parser.error('Evidence output must be a new file')
    started = time.time()
    samples = []
    errors = []

    def query(expression):
        result = deployment.compose('exec', '-T', 'api', 'curl', '--fail', '--silent', '--max-time', '10',
                                    'http://prometheus:9090/api/v1/query?'+urlencode({'query': expression}), capture_output=True, text=True)
        data = json.loads(result.stdout)
        values = data.get('data', {}).get('result', [])
        if data.get('status') != 'success' or not values:
            raise RuntimeError('Required monitoring evidence is unavailable')
        return float(values[0]['value'][1])

    while True:
        try:
            sample = {
                'at': time.time(),
                'memory_headroom': query('min(node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)'),
                'disk_free': query('min(node_filesystem_avail_bytes{mountpoint="/"})'),
                'oom': query('sum(iot_container_oom)'),
                'restarts': query('sum(iot_container_restarts_total{service!~".*-worker"})'),
                'down': query('sum(1 - iot_container_running)'),
                'telemetry_age': query('time() - iot_simulator_oldest_observation_timestamp_seconds'),
                'simulators': query('iot_simulator_active_devices'),
                'failed_probes': query('sum(1 - probe_success)'),
            }
            samples.append(sample)
            if sample['memory_headroom'] < .25: errors.append('Host memory headroom below 25%')
            if sample['oom'] or sample['down']: errors.append('Container OOM or stopped service')
            if sample['failed_probes']: errors.append('A dependency or TLS probe failed')
            if sample['simulators'] < 5 or sample['telemetry_age'] > 120: errors.append('Simulator telemetry missing/stale')
            if len(samples) > 1 and sample['restarts'] > samples[0]['restarts']: errors.append('Container restarted during soak')
        except (RuntimeError, ValueError, KeyError) as error:
            errors.append(str(error))
        elapsed = time.time()-started
        growth = (samples[0]['disk_free']-samples[-1]['disk_free'])/elapsed if len(samples) > 1 else 0
        if elapsed >= 3600 and growth > 0 and samples[-1]['disk_free']/growth < 7*86400:
            errors.append('Less than seven days projected disk runway')
        done = elapsed >= args.hours*3600
        report = {'started_at': started, 'elapsed_seconds': elapsed, 'required_hours': args.hours,
                  'passed': done and args.hours >= 48 and not errors, 'complete': done,
                  'errors': sorted(set(errors)), 'samples': samples}
        private_write(output, json.dumps(report, indent=2)+'\n')
        if done:
            raise SystemExit(0 if report['passed'] else 1)
        time.sleep(min(60, max(.1, args.hours*3600-elapsed)))


if __name__ == '__main__':
    main()
