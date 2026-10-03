import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
import monitoring_health


class MonitoringHealthTests(unittest.TestCase):
    def fixture(self, url):
        if url.endswith('/targets'):
            jobs = ['api', 'host', 'prometheus', 'containers', 'alertmanager', 'loki', 'alloy', 'blackbox', 'health', 'mqtt']
            return {'data': {'activeTargets': [{'labels': {'job': j}, 'health': 'up'} for j in jobs]}}
        if url.endswith('/rules'):
            return {'data': {'groups': [{'rules': [{'health': 'ok'}]}]}}
        q = parse_qs(urlsplit(url).query)['query'][0]
        count = 5 if q == 'probe_success' else 1
        value = 0 if 'notifications_failed' in q else 1
        return {'data': {'result': [{'value': [0, str(value)]} for _ in range(count)]}}

    def test_healthy_stack_allows_heartbeat(self):
        with patch.object(monitoring_health, 'get', side_effect=self.fixture):
            monitoring_health.check()

    def test_missing_or_failed_signals_fail_closed(self):
        for signal in ['targets', 'probe_success', 'iot_container_collector_up', 'iot_container_running', 'rules', 'notifications_failed', 'monitoring_canary']:
            with self.subTest(signal=signal):
                def broken(url):
                    result = self.fixture(url)
                    decoded = urlsplit(url).path+' '+str(parse_qs(urlsplit(url).query))
                    if signal in decoded:
                        if signal == 'targets': result['data']['activeTargets'] = []
                        elif signal == 'rules': result['data']['groups'] = []
                        else: result['data']['result'] = []
                    return result
                with patch.object(monitoring_health, 'get', side_effect=broken), self.assertRaises(AssertionError):
                    monitoring_health.check()


if __name__ == '__main__':
    unittest.main()
