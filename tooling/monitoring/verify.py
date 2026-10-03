#!/usr/bin/env python3
"""Verify local monitoring; --drills briefly interrupts API/automation worker."""
import argparse
import datetime
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from local import ROOT, PRIVATE, compose


def get(url):
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.load(response)


def until(label, read, predicate, timeout=150):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            last = read()
            if predicate(last):
                return last
        except (OSError, ValueError):
            pass
        time.sleep(3)
    raise RuntimeError(f'Timed out: {label}')


def api_php(code):
    # docker exec stderr is separate from the container's main log stream.
    # Capture the real Laravel formatter, then inject that synthetic record into
    # the main container log. No request path or permanent app config is added.
    preamble = "<?php require '/var/www/html/vendor/autoload.php'; $app = require '/var/www/html/bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); config(['logging.channels.stderr.handler_with.stream' => 'php://stdout']); "
    result = compose('exec', '-T', 'api', 'php', input=preamble+code, text=True, capture_output=True)
    compose('exec', '-T', 'api', 'sh', '-c', 'cat > /proc/1/fd/2', input=result.stdout, text=True, capture_output=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--drills', action='store_true')
    args = parser.parse_args()
    env = dict(line.split('=', 1) for line in (ROOT/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
    mail = 'http://localhost:'+env.get('IOT_MAILPIT_UI_PORT', '8025')
    api_port = env.get('IOT_API_PORT', '8001')
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    evidence = {'started_at': started, 'scope': 'local only', 'checks': [], 'drills': []}
    run_id = uuid.uuid4().hex

    def messages(alert):
        return get(mail+'/api/v1/search?query='+urllib.parse.quote('subject:'+alert)).get('messages', [])

    def email(alert, status, previous, fragment):
        def matching():
            for message in messages(alert):
                if message['ID'] in previous or f'[{status}]' not in message['Subject']:
                    continue
                detail = get(mail+'/api/v1/message/'+message['ID'])
                body = str(detail.get('HTML', ''))+str(detail.get('Text', ''))
                if fragment in body:
                    return {'id': message['ID'], 'subject': message['Subject'], 'received_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
            return None
        return until(alert+' '+status+' email', matching, bool)

    def firing(alert, labels):
        return until(alert+' firing', lambda: get('http://localhost:9093/api/v2/alerts'),
                     lambda rows: any(r['labels'].get('alertname') == alert and all(r['labels'].get(k) == v for k, v in labels.items()) for r in rows))

    def service_drill(service, alert, labels, fragment):
        running = compose('ps', '--status', 'running', '--services', service, capture_output=True, text=True).stdout
        if service not in running.split():
            raise RuntimeError('Refusing to drill a service that was not running: '+service)
        previous = {m['ID'] for m in messages(alert)}
        result = {'service': service, 'alert': alert, 'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        try:
            compose('stop', '--timeout', '10', service)
            firing(alert, labels)
            result['firing_email'] = email(alert, 'FIRING', previous, fragment)
        finally:
            compose('start', service)
        result['resolved_email'] = email(alert, 'RESOLVED', previous, fragment)
        evidence['drills'].append(result)
        print('PASS firing and resolved email:', service, flush=True)

    try:
        until('all scrape targets healthy', lambda: get('http://localhost:9090/api/v1/targets')['data']['activeTargets'],
              lambda targets: len(targets) >= 15 and all(t['health'] == 'up' for t in targets))
        # A successful blackbox scrape alone does not establish a successful probe.
        probes = until('all service probes successful', lambda: get('http://localhost:9090/api/v1/query?query=probe_success')['data']['result'],
                       lambda rows: len(rows) >= 10 and all(float(r['value'][1]) == 1 for r in rows))
        evidence['checks'].append({'probes': len(probes), 'all_scrapes': 'up'})
        try:
            urllib.request.urlopen('http://localhost:'+api_port+'/internal/ops/metrics', timeout=5)
            raise RuntimeError('Metrics endpoint accepted an unauthenticated request')
        except urllib.error.HTTPError as error:
            if error.code != 403:
                raise
        evidence['checks'].append('unauthenticated metrics rejected with 403')
        api_php("Illuminate\\Support\\Facades\\Log::info('monitoring_canary_"+run_id+" token:local-redaction-canary');")
        query = '{environment="local",service="api"} |= "monitoring_canary_'+run_id+'"'
        logs = until('correlated redacted log', lambda: get('http://localhost:3100/loki/api/v1/query_range?query='+urllib.parse.quote(query))['data']['result'], bool)
        if 'local-redaction-canary' in json.dumps(logs):
            raise RuntimeError('Synthetic token was not redacted')
        evidence['checks'].append('project/service log capture and synthetic token redaction')
        if args.drills:
            service_drill('automation-worker', 'WorkerStalled', {'worker': 'automation'}, 'automation')
            service_drill('api', 'ProbeFailed', {'instance': 'http://api:8000/health/ready'}, 'http://api:8000/health/ready')
            previous = {m['ID'] for m in messages('ServiceErrorLogs')}
            api_php("Illuminate\\Support\\Facades\\Log::error('monitoring_verification_"+run_id+"', ['synthetic' => true]);")
            firing('ServiceErrorLogs', {'service': 'api'})
            result = {'service': 'api', 'alert': 'ServiceErrorLogs', 'synthetic': True}
            result['firing_email'] = email('ServiceErrorLogs', 'FIRING', previous, 'api')
            result['resolved_email'] = email('ServiceErrorLogs', 'RESOLVED', previous, 'api')
            evidence['drills'].append(result)
            print('PASS firing and resolved email: controlled API error log', flush=True)
        evidence['remaining_alerts'] = [{k: row['labels'].get(k) for k in ('alertname', 'service', 'worker', 'instance')} for row in get('http://localhost:9093/api/v2/alerts')]
        evidence['result'] = 'passed'
    except BaseException as error:
        evidence['result'] = 'failed'
        evidence['error'] = str(error)
        raise
    finally:
        evidence['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        PRIVATE.mkdir(parents=True, exist_ok=True)
        (PRIVATE/'verification.json').write_text(json.dumps(evidence, indent=2)+'\n')
    print('PASS local monitoring. Evidence: .local/monitoring/verification.json')


if __name__ == '__main__':
    main()
