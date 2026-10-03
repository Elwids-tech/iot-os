"""Fail closed before an independent monitoring heartbeat is sent."""
import json
import urllib.parse
import urllib.request


def get(url):
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.load(response)


def check():
    targets = get('http://prometheus:9090/api/v1/targets')['data']['activeTargets']
    jobs = {t['labels']['job'] for t in targets}
    expected = {'api', 'host', 'prometheus', 'containers', 'alertmanager', 'loki', 'alloy', 'blackbox', 'health', 'mqtt'}
    assert expected <= jobs and all(t['health'] == 'up' for t in targets), 'Unhealthy or missing scrape target'
    query = lambda expr: get('http://prometheus:9090/api/v1/query?query='+urllib.parse.quote(expr))['data']['result']
    probes = query('probe_success')
    assert len(probes) >= 5 and all(float(r['value'][1]) == 1 for r in probes), 'Unhealthy service probe'
    inventory = query('iot_container_collector_up')
    assert inventory and all(float(r['value'][1]) == 1 for r in inventory), 'Container inventory unavailable'
    containers = query('iot_container_running')
    assert containers and all(float(r['value'][1]) == 1 for r in containers), 'Expected container missing'
    rules = get('http://prometheus:9090/api/v1/rules')['data']['groups']
    assert rules and all(r['health'] == 'ok' for g in rules for r in g['rules']), 'Metric rule evaluation failure'
    log_rules = get('http://loki:3100/prometheus/api/v1/rules')['data']['groups']
    assert log_rules and all(r['health'] == 'ok' for g in log_rules for r in g['rules']), 'Log rule evaluation failure'
    # Withhold during real notification failure, not merely while SMTP is idle.
    notification = query('sum(increase(alertmanager_notifications_failed_total[5m]))')
    assert notification and all(float(r['value'][1]) == 0 for r in notification), 'Notification delivery failure or unknown'
    canary = get('http://loki:3100/loki/api/v1/query?query='+urllib.parse.quote('sum(count_over_time({service="container-metrics"} |= "monitoring_canary" [2m]))'))['data']['result']
    assert canary and float(canary[0]['value'][1]) > 0, 'Log pipeline canary missing'


if __name__ == '__main__':
    check()
