"""Render the locally exercised monitoring stack for a private release network."""
import json
from pathlib import Path
import yaml


def render(root, output, environment, domain, write):
    local = root / 'deploy/monitoring/local'
    release = root / 'deploy/release/monitoring'
    # These non-secret directories are bind-mounted into unprivileged services.
    for relative in ('dashboards', 'loki-rules', 'loki-rules/fake'):
        path = output/relative
        path.mkdir(parents=True, exist_ok=True, mode=0o755)
        path.chmod(0o755)
    dashboard_url = 'https://ops.'+domain+'/d/iot-platform/platform-operations'
    runbook_url = 'https://ops.'+domain+'/runbook'
    rules = yaml.safe_load((local/'alerts.yml').read_text())
    names = {r['alert'] for g in rules['groups'] for r in g['rules']}
    for group in yaml.safe_load((release/'alerts.yml').read_text())['groups']:
        rules['groups'][0]['rules'] += [r for r in group['rules'] if r['alert'] not in names]
    for group in rules['groups']:
        group['name'] = 'platform'
        for rule in group['rules']:
            rule.setdefault('labels', {})['environment'] = environment
            rule.setdefault('annotations', {}).update(dashboard_url=dashboard_url, runbook_url=runbook_url)
            if rule.get('for') in ('15s', '30s', '1m'):
                rule['for'] = '2m'
            if rule['alert'] == 'WorkerStalled':
                rule['expr'] = rule['expr'].replace('45', '180')
    write(output/'alerts.yml', yaml.safe_dump(rules), 0o644)
    logs = yaml.safe_load((local/'rules/fake/errors.yml').read_text())
    for group in logs['groups']:
        group['name'] = 'platform-logs'
        group['interval'] = '30s'
        for rule in group['rules']:
            rule['expr'] = rule['expr'].replace('environment="local"', 'environment="'+environment+'"').replace('[2m]', '[5m]')
            rule['for'] = '1m'
            rule['labels']['environment'] = environment
            rule['annotations'].update(dashboard_url=dashboard_url, runbook_url=runbook_url)
    write(output/'loki-rules/fake/errors.yml', yaml.safe_dump(logs), 0o644)
    alloy = (local/'config.alloy').read_text().replace('replacement = "local"', 'replacement = "'+environment+'"')
    write(output/'config.alloy', alloy, 0o644)
    dashboard = json.loads((local/'grafana/dashboards/local.json').read_text().replace('environment=\\"local\\"', 'environment=\\"'+environment+'\\"'))
    dashboard.update(uid='iot-platform', title='Platform operations')
    dashboard['links'] = [{'title': 'Incident runbook', 'url': runbook_url}, {'title': 'Alertmanager', 'url': 'https://ops.'+domain+'/alertmanager/'}]
    write(output/'dashboards/platform.json', json.dumps(dashboard, indent=2)+'\n', 0o644)
