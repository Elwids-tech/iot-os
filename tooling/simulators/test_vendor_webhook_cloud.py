import base64
import gzip
import hashlib
import hmac
import json
import random
import threading
import uuid
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import unittest

from vendor_webhook_cloud import (
    MAX_ATTEMPTS,
    OVERSIZE_BYTES,
    Delivery,
    Response,
    deliver,
    make_messages,
    parse_args,
    parse_retry_after,
    post,
    prepare,
    retry_delay,
    retryable,
    run,
    sign,
)

SECRET = 's3cret-for-tests'
NOW = 1_793_092_800.0  # 2026-10-27T09:20:00Z
URL = 'http://ingest.example.test/w/abc123'


def args_for(*extra, url=URL, secret=SECRET):
    base = ['--url', url]
    if secret is not None:
        base += ['--secret', secret]
    return parse_args(base + list(extra))


def counting_ids():
    counter = iter(range(1, 10**6))
    return lambda: str(uuid.UUID(int=next(counter), version=4))


def expected_signature(secret, message, encoding='hex', prefix='sha256='):
    digest = hmac.new(secret.encode(), message, hashlib.sha256).digest()
    return prefix + (digest.hex() if encoding == 'hex' else base64.b64encode(digest).decode())


class TestSigning(unittest.TestCase):
    def test_hex_over_the_raw_body(self):
        body = b'[{"a":1}]'
        assert sign(SECRET, body, None) == 'sha256=' + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()

    def test_base64_and_prefix_options(self):
        body = b'{"x":true}'
        raw = hmac.new(SECRET.encode(), body, hashlib.sha256).digest()
        assert sign(SECRET, body, None, 'base64', '') == base64.b64encode(raw).decode()
        assert sign(SECRET, body, None, 'hex', 'v1=') == 'v1=' + raw.hex()
        assert sign(SECRET, body, None, 'hex', '') == raw.hex()

    def test_timestamp_form_signs_timestamp_dot_body(self):
        body = b'[1,2,3]'
        message = b'1793092800.' + body
        assert sign(SECRET, body, '1793092800') == expected_signature(SECRET, message)
        assert sign(SECRET, body, '1793092800') != sign(SECRET, body, None)
        assert sign(SECRET, body, '1793092801') != sign(SECRET, body, '1793092800')


class TestMessages(unittest.TestCase):
    def test_message_shape_and_ranges(self):
        messages = make_messages(0, 6, 3, int(NOW * 1000), random.Random(1), counting_ids())
        assert len(messages) == 6
        for message in messages:
            assert list(message) == ['messageId', 'deviceId', 'type', 'ts', 'temperature_c', 'humidity_pct',
                                     'battery_mv', 'rssi', 'snr_db', 'uptime_s']
            assert 4 < message['snr_db'] < 12 and message['uptime_s'] >= 0
            assert uuid.UUID(message['messageId']).version == 4
            assert message['type'] == 'environment' and message['ts'] == int(NOW * 1000)
            assert 15 < message['temperature_c'] < 30 and 30 < message['humidity_pct'] < 65
            assert 3200 < message['battery_mv'] <= 3650 and -90 < message['rssi'] < -55
        assert [m['deviceId'] for m in messages] == ['SNS-2001', 'SNS-2002', 'SNS-2003'] * 2
        assert len({m['messageId'] for m in messages}) == 6

    def test_numbering_continues_across_deliveries(self):
        first = make_messages(0, 2, 3, 0, random.Random(1), counting_ids())
        second = make_messages(2, 2, 3, 0, random.Random(1), counting_ids())
        assert [m['deviceId'] for m in first + second] == ['SNS-2001', 'SNS-2002', 'SNS-2003', 'SNS-2001']

    def test_values_vary_slowly(self):
        rng = random.Random(3)
        a = make_messages(0, 1, 1, int(NOW * 1000), rng, counting_ids())[0]
        b = make_messages(0, 1, 1, int((NOW + 5) * 1000), rng, counting_ids())[0]
        assert abs(a['temperature_c'] - b['temperature_c']) < 0.5 and abs(a['humidity_pct'] - b['humidity_pct']) < 1.5


class TestAuthentication(unittest.TestCase):
    messages = [{'messageId': 'm1', 'deviceId': 'SNS-2001'}]

    def test_hmac_default_headers(self):
        delivery = prepare(args_for(), 'delivery', self.messages, NOW)
        assert delivery.headers['content-type'] == 'application/json'
        assert delivery.headers['x-signature'] == expected_signature(SECRET, delivery.body)
        assert delivery.wire == delivery.body and json.loads(delivery.body) == self.messages
        assert 'content-encoding' not in delivery.headers

    def test_hmac_base64_without_prefix_and_custom_header(self):
        args = args_for('--encoding', 'base64', '--prefix', '', '--signature-header', 'x-vendor-sig')
        delivery = prepare(args, 'delivery', self.messages, NOW)
        assert delivery.headers['x-vendor-sig'] == expected_signature(SECRET, delivery.body, 'base64', '')
        assert 'x-signature' not in delivery.headers

    def test_hmac_with_timestamp_header_signs_the_timestamp_too(self):
        delivery = prepare(args_for('--timestamp-header', 'x-timestamp'), 'delivery', self.messages, NOW)
        assert delivery.headers['x-timestamp'] == '1793092800'
        assert delivery.headers['x-signature'] == expected_signature(SECRET, b'1793092800.' + delivery.body)

    def test_header_mode_sends_the_secret_with_a_scheme(self):
        delivery = prepare(args_for('--auth', 'header'), 'delivery', self.messages, NOW)
        assert delivery.headers['authorization'] == f'Bearer {SECRET}'
        assert 'x-signature' not in delivery.headers

    def test_header_mode_with_custom_header_and_no_scheme(self):
        args = args_for('--auth', 'header', '--header', 'x-api-key', '--scheme', '')
        assert prepare(args, 'delivery', self.messages, NOW).headers['x-api-key'] == SECRET

    def test_url_mode_sends_no_credentials(self):
        delivery = prepare(args_for('--auth', 'url', secret=None), 'delivery', self.messages, NOW)
        assert set(delivery.headers) == {'content-type', 'user-agent'}

    def test_bad_signature_does_not_verify_with_the_real_secret(self):
        delivery = prepare(args_for('--bad-signature'), 'delivery', self.messages, NOW)
        assert delivery.headers['x-signature'] != expected_signature(SECRET, delivery.body)
        assert delivery.headers['x-signature'].startswith('sha256=')
        header_mode = prepare(args_for('--auth', 'header', '--bad-signature'), 'delivery', self.messages, NOW)
        assert header_mode.headers['authorization'] != f'Bearer {SECRET}'

    def test_no_secret_sends_nothing_to_verify(self):
        delivery = prepare(args_for('--no-secret', '--timestamp-header', 'x-timestamp', secret=None), 'delivery',
                           self.messages, NOW)
        assert set(delivery.headers) == {'content-type', 'user-agent'}

    def test_stale_timestamp_is_ten_minutes_old_but_correctly_signed(self):
        delivery = prepare(args_for('--timestamp-header', 'x-timestamp', '--stale-timestamp'), 'delivery',
                           self.messages, NOW)
        assert int(delivery.headers['x-timestamp']) == int(NOW) - 600
        assert delivery.headers['x-signature'] == expected_signature(
            SECRET, delivery.headers['x-timestamp'].encode() + b'.' + delivery.body)

    def test_gzip_compresses_the_wire_body_and_signs_the_original(self):
        delivery = prepare(args_for('--gzip'), 'delivery', self.messages, NOW)
        assert delivery.headers['content-encoding'] == 'gzip'
        assert gzip.decompress(delivery.wire) == delivery.body
        assert delivery.headers['x-signature'] == expected_signature(SECRET, delivery.body)

    def test_invalid_combinations_are_rejected(self):
        for argv in [
        [], ['--auth', 'url', '--bad-signature'], ['--auth', 'url', '--no-secret'], ['--no-secret', '--bad-signature'],
        ['--stale-timestamp'], ['--auth', 'header', '--timestamp-header', 'x-timestamp'],
        ['--interval', '0'], ['--batch', '0'], ['--devices', '0'], ['--burst', '-1'],
    ]:
            with self.subTest(argv=argv):
                base = ['--url', URL]
                if argv != []:
                    base += ['--secret', SECRET]
                with self.assertRaises(SystemExit):
                    parse_args(base + argv)

    def test_url_must_be_http(self):
        with self.assertRaises(SystemExit):
            parse_args(['--url', 'ftp://example.test/x', '--secret', SECRET])

    def test_batch_defaults_to_the_device_count(self):
        assert args_for('--devices', '5').batch == 5
        assert args_for('--devices', '5', '--batch', '2').batch == 2


class TestRetryPolicy(unittest.TestCase):
    def test_retried(self):
        for status in [None, 408, 429, 500, 502, 503, 504, 599]:
            with self.subTest(status=status):
                assert retryable(status) and retry_delay(status, 1) == 1

    def test_final(self):
        for status in [200, 202, 204, 301, 400, 401, 403, 404, 405, 409, 413, 422]:
            with self.subTest(status=status):
                assert not retryable(status) and retry_delay(status, 1) is None

    def test_backoff_doubles_up_to_sixty_seconds(self):
        assert [retry_delay(503, attempt, max_attempts=10) for attempt in range(1, 10)] == \
            [1, 2, 4, 8, 16, 32, 60, 60, 60]

    def test_at_most_six_attempts(self):
        assert MAX_ATTEMPTS == 6
        assert [retry_delay(None, attempt) for attempt in range(1, 7)] == [1, 2, 4, 8, 16, None]

    def test_retry_after_is_a_floor_for_the_wait(self):
        assert retry_delay(429, 1, 30) == 30
        assert retry_delay(429, 5, 3) == 16  # backoff is already longer
        assert retry_delay(503, 1, 0) == 1
        assert retry_delay(429, 1, 86_400) == 300  # capped for a dev tool
        assert retry_delay(401, 1, 30) is None

    def test_parse_retry_after(self):
        assert parse_retry_after('7', NOW) == 7
        assert parse_retry_after(' 2.5 ', NOW) == 2.5
        assert abs(parse_retry_after(formatdate(NOW + 90, usegmt=True), NOW) - 90) <= 1
        assert parse_retry_after(formatdate(NOW - 90, usegmt=True), NOW) == 0
        assert parse_retry_after('-5', NOW) == 0
        for junk in (None, '', 'soon', 'nan', 'inf'):
            assert parse_retry_after(junk, NOW) is None


class Harness:
    """Fake network, clock and sleep for deliver() and run()."""

    def __init__(self, statuses=()):
        self.statuses = list(statuses)
        self.requests = []
        self.waits = []
        self.lines = []
        self.now = NOW

    def clock(self):
        return self.now

    def send(self, wire, headers):
        self.requests.append((wire, dict(headers)))
        outcome = self.statuses.pop(0) if self.statuses else 202
        if isinstance(outcome, Exception):
            raise outcome
        if isinstance(outcome, Response):
            return outcome
        return Response(outcome, body=b'{"delivery_id":"d-%d"}' % len(self.requests) if outcome == 202 else b'')

    def wait(self, seconds):
        self.waits.append(seconds)
        self.now += seconds
        return False


def one_delivery():
    return Delivery('delivery', b'[]', b'[]', {}, 1)


class TestDeliver(unittest.TestCase):
    def run_deliver(self, harness, attempts=MAX_ATTEMPTS):
        return deliver(harness.send, harness.wait, harness.clock, harness.lines.append, one_delivery(), attempts)

    def test_success_prints_status_and_delivery_id(self):
        harness = Harness([202])
        assert self.run_deliver(harness) == 202
        assert harness.waits == [] and len(harness.lines) == 1
        line = harness.lines[0]
        assert line.startswith('2026-10-27T09:20:00Z delivery attempt=1/6 status=202 delivery_id=d-1')

    def test_retries_5xx_and_429_honouring_retry_after(self):
        harness = Harness([503, Response(429, '9'), 500, 202])
        assert self.run_deliver(harness) == 202
        assert harness.waits == [1, 9, 4]
        assert [line.split()[3] for line in harness.lines] == ['status=503', 'status=429', 'status=500', 'status=202']
        assert 'retry_in=9s' in harness.lines[1]

    def test_network_errors_and_408_are_retried(self):
        harness = Harness([ConnectionRefusedError(), TimeoutError(), 408, 202])
        assert self.run_deliver(harness) == 202
        assert harness.waits == [1, 2, 4]
        assert 'status=error error=ConnectionRefusedError' in harness.lines[0]

    def test_other_4xx_are_never_retried(self):
        for status in [400, 401, 403, 404, 413]:
            with self.subTest(status=status):
                harness = Harness([status, 202])
                assert self.run_deliver(harness) == status
                assert harness.waits == [] and len(harness.requests) == 1
                assert 'retry_in' not in harness.lines[0] and 'gave_up' not in harness.lines[0]

    def test_gives_up_after_six_attempts(self):
        harness = Harness([503] * 10)
        assert self.run_deliver(harness) == 503
        assert len(harness.requests) == 6 and harness.waits == [1, 2, 4, 8, 16]
        assert harness.lines[-1].endswith('gave_up')

    def test_a_single_attempt_when_asked(self):
        harness = Harness([429, 202])
        assert self.run_deliver(harness, attempts=1) == 429
        assert harness.waits == [] and len(harness.requests) == 1

    def test_stopping_during_a_wait_ends_the_delivery(self):
        harness = Harness([503, 202])
        harness.wait = lambda seconds: True
        assert self.run_deliver(harness) == 503
        assert len(harness.requests) == 1


class TestRun(unittest.TestCase):
    def run_with(self, harness, *extra, **kwargs):
        args = args_for('--count', '2', '--interval', '5', *extra)
        run(args, send=harness.send, wait=harness.wait, clock=harness.clock, out=harness.lines.append,
            rng=random.Random(1), new_id=counting_ids(), **kwargs)
        return [(json.loads(gzip.decompress(w) if h.get('content-encoding') else w), h) for w, h in harness.requests]

    def test_sends_count_deliveries_with_a_wait_between_but_not_after_the_last(self):
        harness = Harness()
        sent = self.run_with(harness)
        assert len(sent) == 2 and harness.waits == [5]
        assert all(len(body) == 3 for body, _ in sent)
        assert [m['deviceId'] for m in sent[0][0]] == ['SNS-2001', 'SNS-2002', 'SNS-2003']
        assert len({m['messageId'] for body, _ in sent for m in body}) == 6

    def test_batch_controls_messages_per_post_and_rotates_devices(self):
        harness = Harness()
        sent = self.run_with(harness, '--batch', '2')
        assert [[m['deviceId'] for m in body] for body, _ in sent] == [['SNS-2001', 'SNS-2002'], ['SNS-2003', 'SNS-2001']]

    def test_duplicate_resends_identical_bytes_and_message_ids(self):
        harness = Harness()
        self.run_with(harness, '--duplicate')
        assert len(harness.requests) == 4
        assert harness.requests[0] == harness.requests[1] and harness.requests[2] == harness.requests[3]
        assert harness.requests[0] != harness.requests[2]
        assert [line.split()[1] for line in harness.lines] == ['delivery', 'duplicate', 'delivery', 'duplicate']

    def test_oversize_sends_one_extra_large_delivery_first(self):
        harness = Harness([413])
        sent = self.run_with(harness, '--oversize')
        assert len(harness.requests) == 3
        assert len(harness.requests[0][0]) == OVERSIZE_BYTES > 1024 * 1024
        assert sent[0][0][0]['padding'] and len(sent[1][0]) == 3
        assert harness.lines[0].split()[1] == 'oversize' and 'status=413' in harness.lines[0]
        assert harness.requests[0][1]['x-signature'] == expected_signature(SECRET, harness.requests[0][0])

    def test_burst_sends_n_single_attempt_deliveries_then_continues(self):
        harness = Harness([202, 429, 429, 202, 202, 202])
        self.run_with(harness, '--burst', '4')
        kinds = [line.split()[1] for line in harness.lines]
        assert kinds == ['burst'] * 4 + ['delivery'] * 2
        assert harness.waits == [5]  # the 429s inside the burst are not waited out
        assert len({m['messageId'] for w, _ in harness.requests for m in json.loads(w)}) == 18

    def test_gzip_flag_compresses_every_delivery(self):
        harness = Harness()
        sent = self.run_with(harness, '--gzip')
        assert all(h['content-encoding'] == 'gzip' for _, h in sent) and len(sent[0][0]) == 3

    def test_a_stop_request_ends_the_loop_cleanly(self):
        harness = Harness()
        stop = threading.Event()
        args = args_for('--interval', '5')

        def wait(seconds):
            harness.waits.append(seconds)
            stop.set()
            return True

        run(args, send=harness.send, wait=wait, clock=harness.clock, stop=stop, out=harness.lines.append,
            rng=random.Random(1), new_id=counting_ids())
        assert len(harness.requests) == 1 and harness.waits == [5]

    def test_retries_resend_the_same_signed_bytes(self):
        harness = Harness([503, 202])
        self.run_with(harness, '--timestamp-header', 'x-timestamp')
        assert harness.requests[0] == harness.requests[1]


class Receiver(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.server.seen.append((self.path, {k.lower(): v for k, v in self.headers.items()}, body))
        status, extra = self.server.script.pop(0) if self.server.script else (202, {})
        payload = b'{"delivery_id":"abc"}' if status == 202 else b'{}'
        self.send_response(status)
        self.send_header('Content-Length', str(len(payload)))
        for name, value in extra.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


def start_receiver():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Receiver)
    server.seen, server.script = [], []
    thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
    thread.start()

    def stop():
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    return (server, f'http://127.0.0.1:{server.server_address[1]}/w/abc123/tok?x=1'), stop


class TestOverHttp(unittest.TestCase):
    def setUp(self):
        self.receiver, stop = start_receiver()
        self.addCleanup(stop)

    def test_two_signed_deliveries_reach_a_real_server_and_verify(self):
        receiver = self.receiver
        server, url = receiver
        lines, waits = [], []
        args = args_for('--count', '2', '--interval', '0.1', '--timestamp-header', 'x-timestamp', url=url)
        run(args, wait=lambda seconds: waits.append(seconds) or False, out=lines.append)
        assert len(server.seen) == 2 and len(lines) == 2
        for path, headers, body in server.seen:
            assert path == '/w/abc123/tok?x=1'
            assert headers['content-type'] == 'application/json' and headers['content-length'] == str(len(body))
            message = headers['x-timestamp'].encode() + b'.' + body
            assert headers['x-signature'] == expected_signature(SECRET, message)
            assert len(json.loads(body)) == 3
        assert all('status=202 delivery_id=abc' in line for line in lines)

    def test_retry_after_and_server_errors_over_the_wire(self):
        receiver = self.receiver
        server, url = receiver
        server.script = [(503, {}), (429, {'Retry-After': '3'}), (202, {})]
        harness = Harness()
        args = args_for('--count', '1', url=url)
        run(args, wait=harness.wait, clock=harness.clock, out=harness.lines.append)
        assert harness.waits == [1, 3] and len(server.seen) == 3
        assert len({body for _, _, body in server.seen}) == 1

    def test_gzip_body_is_decodable_by_the_receiver(self):
        receiver = self.receiver
        server, url = receiver
        run(args_for('--count', '1', '--gzip', url=url), out=lambda line: None)
        _, headers, body = server.seen[0]
        assert headers['content-encoding'] == 'gzip' and len(json.loads(gzip.decompress(body))) == 3

    def test_connection_refused_is_a_network_error(self):
        with self.assertRaises(OSError):
            post('http://127.0.0.1:9/w/x', b'[]', {})
