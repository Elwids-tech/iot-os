#!/usr/bin/env python3
"""Post a sensor vendor cloud's webhooks ("Example Sensor Cloud") to an ingest URL.

Mimics a vendor that pushes batches of device messages over HTTPS: a JSON array per
POST, signed with HMAC-SHA256 (optionally over "<timestamp>.<body>"), a bearer-style
header, or a token already in the URL. A failed delivery is retried the way a vendor's
queue would: network errors, 408, 429 and 5xx with exponential backoff that honours
Retry-After; other 4xx never. One line is printed per attempt.

The fault flags break deliveries on purpose so the receiver's rejections show up:
--bad-signature, --no-secret, --stale-timestamp, --oversize, --burst N, --duplicate and
--gzip. Standard library only; no platform code is used here.
"""
import argparse
import base64
import gzip
import hashlib
import hmac
import http.client
import json
import math
import random
import signal
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

MAX_ATTEMPTS = 6
MAX_BACKOFF = 60.0
MAX_RETRY_AFTER = 300.0  # a Retry-After beyond this is not waited out by a dev tool
OVERSIZE_BYTES = int(1.1 * 1024 * 1024)
STALE_SECONDS = 600
TIMEOUT_SECONDS = 30


@dataclass
class Response:
    status: int
    retry_after: str | None = None
    body: bytes = b''


@dataclass
class Delivery:
    kind: str  # delivery, duplicate, oversize or burst
    body: bytes  # the JSON that was signed
    wire: bytes  # what goes on the wire (gzipped with --gzip)
    headers: dict
    messages: int


def sign(secret: str, body: bytes, timestamp: str | None, encoding: str = 'hex', prefix: str = 'sha256=') -> str:
    """HMAC-SHA256 of the body (or of "<timestamp>.<body>"), encoded and prefixed."""
    message = body if timestamp is None else timestamp.encode() + b'.' + body
    digest = hmac.new(secret.encode(), message, hashlib.sha256).digest()
    text = digest.hex() if encoding == 'hex' else base64.b64encode(digest).decode()
    return prefix + text


def device_id(index: int) -> str:
    return f'SNS-{2001 + index}'


def make_message(index: int, now_ms: int, rng: random.Random, message_id: str) -> dict:
    """One environment reading from device `index`, slowly varying with the time of day."""
    hours = now_ms / 3_600_000
    daily = math.sin(math.tau * hours / 24 + index)
    drain_mv = (hours / 24 * 8 + index * 15) % 400
    return {
        'messageId': message_id,
        'deviceId': device_id(index),
        'type': 'environment',
        'ts': now_ms,
        'temperature_c': round(21 + 0.6 * index + 2.5 * daily + rng.uniform(-0.15, 0.15), 2),
        'humidity_pct': round(min(100.0, max(0.0, 46 - 7 * daily + rng.uniform(-0.4, 0.4))), 1),
        'battery_mv': int(3650 - drain_mv),
        'rssi': -72 + round(5 * math.sin(hours * 1.7 + index)) + rng.randint(-2, 2),
        'snr_db': round(8 + 2 * math.sin(hours * 1.3 + index) + rng.uniform(-0.5, 0.5), 1),
        'uptime_s': int(now_ms / 1000) % 2_592_000 + index * 600,
    }


def make_messages(first: int, size: int, devices: int, now_ms: int, rng: random.Random, new_id) -> list[dict]:
    """`size` messages, device after device round-robin, continuing from message number `first`."""
    return [make_message((first + offset) % devices, now_ms, rng, new_id()) for offset in range(size)]


def oversize_messages(now_ms: int, new_id) -> list[dict]:
    """A valid-looking array padded until the JSON body is exactly OVERSIZE_BYTES long."""
    message = {'messageId': new_id(), 'deviceId': device_id(0), 'type': 'environment', 'ts': now_ms, 'padding': ''}
    empty = len(encode([message]))
    message['padding'] = 'x' * (OVERSIZE_BYTES - empty)
    return [message]


def encode(messages: list[dict]) -> bytes:
    return json.dumps(messages, separators=(',', ':')).encode()


def auth_headers(args, body: bytes, now: float) -> dict:
    """The authentication headers for one delivery, after the fault flags are applied."""
    if args.auth == 'url' or args.no_secret:
        return {}
    secret = args.secret + '.wrong' if args.bad_signature else args.secret
    if args.auth == 'header':
        return {args.header: f'{args.scheme} {secret}' if args.scheme else secret}
    headers, timestamp = {}, None
    if args.timestamp_header:
        timestamp = str(int(now) - (STALE_SECONDS if args.stale_timestamp else 0))
        headers[args.timestamp_header] = timestamp
    headers[args.signature_header] = sign(secret, body, timestamp, args.encoding, args.prefix)
    return headers


def prepare(args, kind: str, messages: list[dict], now: float) -> Delivery:
    """Serialize, sign (over the uncompressed body) and optionally gzip one delivery."""
    body = encode(messages)
    headers = {'content-type': 'application/json', 'user-agent': 'ExampleSensorCloud/2.3'}
    headers.update(auth_headers(args, body, now))
    wire = body
    if args.gzip:
        wire = gzip.compress(body, mtime=0)
        headers['content-encoding'] = 'gzip'
    return Delivery(kind, body, wire, headers, len(messages))


def parse_retry_after(value: str | None, now: float) -> float | None:
    """Seconds from a Retry-After header (a number or an HTTP date); None when unusable."""
    if not value or not value.strip():
        return None
    text = value.strip()
    try:
        seconds = float(text)
    except ValueError:
        try:
            seconds = parsedate_to_datetime(text).timestamp() - now
        except (TypeError, ValueError, IndexError):
            return None
    return max(0.0, seconds) if math.isfinite(seconds) else None


def retryable(status: int | None) -> bool:
    """Network errors (None), 408, 429 and 5xx are retried; every other status is final."""
    return status is None or status in (408, 429) or 500 <= status <= 599


def retry_delay(status: int | None, attempt: int, retry_after: float | None = None,
                max_attempts: int = MAX_ATTEMPTS) -> float | None:
    """Seconds to wait before the next attempt, or None when the delivery is finished.

    `attempt` is the number of attempts made so far. Backoff is 1, 2, 4... up to 60
    seconds; a Retry-After longer than that wins (up to MAX_RETRY_AFTER).
    """
    if attempt >= max_attempts or not retryable(status):
        return None
    backoff = min(MAX_BACKOFF, 2.0 ** (attempt - 1))
    if retry_after is None:
        return backoff
    return min(max(backoff, retry_after), MAX_RETRY_AFTER)


def delivery_id_of(body: bytes) -> str | None:
    try:
        parsed = json.loads(body)
    except ValueError:
        return None
    value = parsed.get('delivery_id') if isinstance(parsed, dict) else None
    return value if isinstance(value, str) else None


def post(url: str, wire: bytes, headers: dict, timeout: float = TIMEOUT_SECONDS) -> Response:
    """POST once. Raises OSError or http.client.HTTPException on network failures."""
    parts = urlsplit(url)
    connection_class = http.client.HTTPSConnection if parts.scheme == 'https' else http.client.HTTPConnection
    connection = connection_class(parts.hostname, parts.port, timeout=timeout)
    target = (parts.path or '/') + (f'?{parts.query}' if parts.query else '')
    try:
        try:
            connection.request('POST', target, body=wire, headers=headers)
        except (BrokenPipeError, ConnectionResetError):
            # A receiver may answer (413) and hang up before the whole body is sent.
            pass
        response = connection.getresponse()
        return Response(response.status, response.getheader('Retry-After'), response.read(65536))
    finally:
        connection.close()


def stamp(now: float) -> str:
    return datetime.fromtimestamp(now, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def deliver(send, wait, clock, out, delivery: Delivery, max_attempts: int = MAX_ATTEMPTS) -> int | None:
    """Send one delivery with retries and print a line per attempt; returns the last status.

    `wait(seconds)` sleeps and returns True when the program was asked to stop.
    """
    status = None
    for attempt in range(1, max_attempts + 1):
        detail = ''
        retry_after = None
        try:
            response = send(delivery.wire, delivery.headers)
            status = response.status
            retry_after = parse_retry_after(response.retry_after, clock())
            delivery_id = delivery_id_of(response.body)
            detail = f' delivery_id={delivery_id}' if delivery_id else ''
        except (OSError, http.client.HTTPException) as error:
            status = None
            detail = f' error={type(error).__name__}'
        delay = retry_delay(status, attempt, retry_after, max_attempts)
        if delay is not None:
            suffix = f' retry_in={delay:g}s'
        else:
            suffix = ' gave_up' if retryable(status) else ''
        print_status = 'error' if status is None else status
        out(f'{stamp(clock())} {delivery.kind} attempt={attempt}/{max_attempts} status={print_status}'
            f'{detail} messages={delivery.messages} bytes={len(delivery.wire)}{suffix}')
        if delay is None or wait(delay):
            break
    return status


def run(args, send=None, wait=None, clock=time.time, stop: threading.Event | None = None, out=None,
        rng: random.Random | None = None, new_id=lambda: str(uuid.uuid4())) -> None:
    """Post the oversize delivery, the burst, then deliveries every --interval."""
    stop = stop or threading.Event()
    send = send or (lambda wire, headers: post(args.url, wire, headers))
    wait = wait or stop.wait
    out = out or (lambda line: print(line, flush=True))
    rng = rng or random.Random()

    def deliver_fresh(kind: str, count_messages: int, numbered: int, attempts: int = MAX_ATTEMPTS) -> Delivery:
        now = clock()
        messages = make_messages(numbered, count_messages, args.devices, int(now * 1000), rng, new_id)
        delivery = prepare(args, kind, messages, now)
        deliver(send, wait, clock, out, delivery, attempts)
        return delivery

    numbered = 0
    if args.oversize:
        now = clock()
        deliver(send, wait, clock, out, prepare(args, 'oversize', oversize_messages(int(now * 1000), new_id), now))
    for _ in range(args.burst):
        if stop.is_set():
            return
        # Burst deliveries are attempted once, so the receiver's 429s are visible.
        deliver_fresh('burst', args.batch, numbered, attempts=1)
        numbered += args.batch
    sent = 0
    while not stop.is_set() and (args.count == 0 or sent < args.count):
        delivery = deliver_fresh('delivery', args.batch, numbered)
        numbered += args.batch
        if args.duplicate and not stop.is_set():
            duplicate = Delivery('duplicate', delivery.body, delivery.wire, delivery.headers, delivery.messages)
            deliver(send, wait, clock, out, duplicate)
        sent += 1
        if args.count and sent >= args.count:
            break
        if wait(args.interval):
            break


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--url', required=True, help='Ingest URL of the adapter, e.g. http://localhost:8095/w/<id>')
    parser.add_argument('--secret', help='Signing secret (hmac) or token (header); not needed with --auth url')
    parser.add_argument('--auth', choices=('hmac', 'header', 'url'), default='hmac',
                        help='hmac signs the body; header sends the secret in a header; url means the token is in the URL')
    parser.add_argument('--signature-header', default='x-signature', help='hmac: header carrying the signature')
    parser.add_argument('--prefix', default='sha256=', help='hmac: text before the signature')
    parser.add_argument('--encoding', choices=('hex', 'base64'), default='hex', help='hmac: signature encoding')
    parser.add_argument('--timestamp-header', help='hmac: send epoch seconds in this header and sign "<timestamp>.<body>"')
    parser.add_argument('--header', default='authorization', help='header mode: header carrying the secret')
    parser.add_argument('--scheme', default='Bearer', help='header mode: text before the secret ("" for none)')
    parser.add_argument('--devices', type=int, default=3, help='Number of simulated sensors (SNS-2001...)')
    parser.add_argument('--interval', type=float, default=5, help='Seconds between deliveries')
    parser.add_argument('--count', type=int, default=0, help='Deliveries to send; zero keeps sending until stopped')
    parser.add_argument('--batch', type=int, help='Messages per POST (default: one per device)')
    parser.add_argument('--bad-signature', action='store_true', help='Sign with the wrong secret')
    parser.add_argument('--no-secret', action='store_true', help='Send no signature or secret at all')
    parser.add_argument('--stale-timestamp', action='store_true',
                        help='Send a signed timestamp 10 minutes old (needs --timestamp-header)')
    parser.add_argument('--oversize', action='store_true', help='Send one 1.1 MiB delivery first')
    parser.add_argument('--burst', type=int, default=0, metavar='N',
                        help='Send N deliveries as fast as possible, once each, then continue normally')
    parser.add_argument('--duplicate', action='store_true', help='Send every delivery twice, same body and message ids')
    parser.add_argument('--gzip', action='store_true', help='Compress bodies (the signature covers the uncompressed body)')
    args = parser.parse_args(argv)
    parts = urlsplit(args.url)
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        parser.error('--url must be an http or https URL')
    if args.batch is None:
        args.batch = args.devices
    if args.devices < 1 or args.batch < 1 or args.count < 0 or args.burst < 0:
        parser.error('Use at least one device and batch message, and nonnegative --count and --burst')
    if not math.isfinite(args.interval) or args.interval < 0.1:
        parser.error('Use an --interval of at least 0.1 seconds')
    if args.bad_signature and args.no_secret:
        parser.error('--bad-signature and --no-secret cannot be combined')
    if args.auth != 'url' and not args.secret and not args.no_secret:
        parser.error('--secret is required unless --auth url or --no-secret is used')
    if args.auth == 'url' and (args.bad_signature or args.no_secret):
        parser.error('--bad-signature and --no-secret need --auth hmac or header')
    if args.timestamp_header and args.auth != 'hmac':
        parser.error('--timestamp-header only applies to --auth hmac')
    if args.stale_timestamp and not (args.auth == 'hmac' and args.timestamp_header):
        parser.error('--stale-timestamp needs --auth hmac and --timestamp-header')
    return args


def main(argv=None):
    args = parse_args(argv)
    stop = threading.Event()

    def request_stop(*_):
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    print(f'Example Sensor Cloud posting {args.batch} message(s) per delivery from {args.devices} sensor(s) '
          f'every {args.interval:g}s ({args.auth} auth)', flush=True)
    run(args, stop=stop)
    sys.stdout.flush()


if __name__ == '__main__':
    main()
