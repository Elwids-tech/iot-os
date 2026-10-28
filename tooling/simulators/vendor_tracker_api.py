#!/usr/bin/env python3
"""Serve a cellular asset-tracker vendor's history REST API ("Example Tracker Cloud").

Mimics a vendor cloud that only offers polling: trackers record a reading every few
minutes, upload them in batches over a cellular link, and sometimes go out of coverage
and upload a backlog later. Clients page through `GET /accounts/<account>/streams/history`
by `receivedDate` (the vendor's receipt time) using `maxDate` as the next `start`.

The data is a pure function of the clock and --seed, so a restarted simulator serves
exactly the same records. Standard library only; no platform code is used here.

Test controls (no API key needed):
  POST /_control {"fault": "none|429|500|401|slow", "count": 3, "retry_after": 5}
  GET  /_served          every record id returned in a 200 response, in order
  POST /_served/reset    forget them
  GET  /_health
"""
import argparse
import hashlib
import hmac
import json
import math
import re
import signal
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, parse_qsl, urlencode, urlsplit

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
OUTAGE_CHANCE = 0.08  # chance that a tracker misses any given upload (and maybe the next ones)
MAX_BATCH = 900  # a tracker's memory holds this many readings; older ones are overwritten
LAP_SECONDS = 3600  # one circle of the centre point
MAX_LIMIT = 1000
FAULTS = ('none', '429', '500', '401', 'slow')
SECRET_PARAMS = {'api_key', 'apikey', 'key', 'token', 'x-api-key'}


@lru_cache(maxsize=1 << 18)
def unit(seed: int, label: str, a: int = 0, b: int = 0) -> float:
    """A stable pseudo-random number in [0, 1) for these inputs (same on every run)."""
    digest = hashlib.blake2b(f'{seed}:{label}:{a}:{b}'.encode(), digest_size=8).digest()
    return int.from_bytes(digest, 'big') / 2**64


@dataclass(frozen=True)
class Fleet:
    seed: int = 7
    trackers: int = 3
    reading_every: int = 300
    upload_every: int = 900
    offline_max: int = 7200
    days: float = 3.0

    def __post_init__(self):
        if self.trackers < 1:
            raise ValueError('--trackers must be at least 1')
        if self.reading_every < 1:
            raise ValueError('--reading-every must be at least 1 second')
        if self.upload_every < self.trackers:
            raise ValueError('--upload-every must be at least the number of trackers, in seconds')
        if self.offline_max < 0:
            raise ValueError('--offline-max must not be negative')
        if not math.isfinite(self.days) or self.days <= 0:
            raise ValueError('--days must be positive')

    def device_id(self, tracker: int) -> str:
        return f'TRK-{1001 + tracker}'

    def offset(self, tracker: int) -> int:
        """Seconds into the upload period at which this tracker uploads.

        Trackers get disjoint slices of the period, so two trackers never upload in the
        same second and receivedDate values are unique across the whole account.
        """
        stride = self.upload_every // self.trackers
        base = int(unit(self.seed, 'upload-base') * self.upload_every)
        jitter = int(unit(self.seed, 'upload-jitter', tracker) * stride)
        return (base + tracker * stride + jitter) % self.upload_every

    def slot_time(self, tracker: int, slot: int) -> int:
        return slot * self.upload_every + self.offset(tracker)

    def outage(self, tracker: int, slot: int) -> int:
        """Seconds out of coverage starting at upload slot `slot` (0 = none)."""
        return outage_length(self, tracker, slot)

    def reach(self) -> int:
        """How many upload slots back an outage can still cover the current one."""
        return -(-self.offline_max // self.upload_every)

    def online(self, tracker: int, slot: int) -> bool:
        """Whether the tracker manages the upload at this slot."""
        for earlier in range(slot - self.reach(), slot + 1):
            length = self.outage(tracker, earlier)
            if length and (slot - earlier) * self.upload_every < length:
                return False
        return True

    def previous_online(self, tracker: int, slot: int) -> int:
        earlier = slot - 1
        while not self.online(tracker, earlier):
            earlier -= 1
        return earlier


@lru_cache(maxsize=1 << 18)
def outage_length(fleet: Fleet, tracker: int, slot: int) -> int:
    """Seconds an outage starting at this upload slot lasts (0 = none).

    Outages never overlap or run back to back, so a tracker is never dark for more than
    --offline-max in a row: a slot inside an earlier outage, or the first one after it,
    cannot start another.
    """
    if fleet.offline_max < 1 or unit(fleet.seed, 'outage', tracker, slot) >= OUTAGE_CHANCE:
        return 0
    for earlier in range(slot - fleet.reach() - 1, slot):
        length = outage_length(fleet, tracker, earlier)
        if length and (slot - earlier - 1) * fleet.upload_every < length:
            return 0
    return 1 + int(unit(fleet.seed, 'outage-length', tracker, slot) * fleet.offline_max)


def format_time(ms: int) -> str:
    """ISO 8601 UTC with milliseconds and a Z, computed without float rounding."""
    moment = EPOCH + timedelta(milliseconds=ms)
    return moment.strftime('%Y-%m-%dT%H:%M:%S.') + f'{ms % 1000:03d}Z'


def parse_time(value: str) -> int:
    """Epoch milliseconds from ISO 8601 (no zone means UTC) or from epoch milliseconds."""
    text = value.strip()
    if 'T' in text:
        # A '+' offset that was not URL-encoded arrives as a space.
        text = re.sub(r' (\d{2}:?\d{2})$', r'+\1', text)
    if re.fullmatch(r'-?\d+', text):
        if len(text) > 15:
            raise ValueError(f'{value!r} is not an ISO 8601 time or epoch milliseconds')
        return int(text)
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(f'{value!r} is not an ISO 8601 time or epoch milliseconds') from None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    delta = moment - EPOCH
    return (delta.days * 86400 + delta.seconds) * 1000 + delta.microseconds // 1000


def reading_values(fleet: Fleet, tracker: int, seq: int) -> dict:
    """Position and sensor values of reading `seq`, a pure function of the observation time."""
    seed, seconds = fleet.seed, seq * fleet.reading_every
    centre_lat, centre_lon = 51.0 + 0.01 * tracker, -114.0 - 0.01 * tracker
    radius = 0.004 + 0.001 * tracker
    angle = math.tau * ((seconds % LAP_SECONDS) / LAP_SECONDS + tracker / 3)
    local_hour = (seconds / 3600 + centre_lon / 15) % 24
    daily = math.sin(math.tau * (local_hour - 9) / 24)
    sun = math.sin(math.pi * (local_hour - 6) / 12) if 6 <= local_hour <= 18 else 0.0
    cycle_days = 21
    drained = ((seconds / 86400) + tracker * 5) % cycle_days / cycle_days
    return {
        'lat': round(centre_lat + radius * math.sin(angle), 6),
        'lon': round(centre_lon + radius / math.cos(math.radians(centre_lat)) * math.cos(angle), 6),
        'accuracy_m': round(4 + unit(seed, 'accuracy', tracker, seq) * 26, 1),
        'temperature_c': round(8 + tracker + 7 * daily + (unit(seed, 'temperature', tracker, seq) - 0.5) * 0.6, 1),
        'humidity_pct': round(min(100.0, max(5.0, 60 - 15 * daily + (unit(seed, 'humidity', tracker, seq) - 0.5) * 4)), 1),
        'pressure_hpa': round(1013 + 8 * math.sin(math.tau * seconds / (4.3 * 86400) + tracker)
                              + (unit(seed, 'pressure', tracker, seq) - 0.5) * 0.4, 1),
        'light_lux': int(sun * 45000 * (0.4 + 0.6 * unit(seed, 'cloud', tracker, seq))),
        'battery_pct': round(100 - 75 * drained, 1),
    }


def make_record(fleet: Fleet, tracker: int, seq: int, received_ms: int) -> dict:
    jitter_ms = 1 + int(unit(fleet.seed, 'jitter', tracker, seq) * 1999)
    observed_ms = seq * fleet.reading_every * 1000 - jitter_ms
    device = fleet.device_id(tracker)
    return {
        'id': f'{device}-{seq}',
        'deviceId': device,
        'timestamp': format_time(observed_ms),
        'receivedDate': format_time(received_ms),
        **reading_values(fleet, tracker, seq),
    }


def upload(fleet: Fleet, tracker: int, slot: int) -> list[tuple[int, str, dict]]:
    """(receivedDate ms, id, record) for the readings a tracker uploads at `slot`.

    The upload carries every reading since the last successful one; each record gets
    its own millisecond so a `start` cursor on receivedDate never skips a tie.
    """
    if not fleet.online(tracker, slot):
        return []
    since = fleet.slot_time(tracker, fleet.previous_online(tracker, slot))
    until = fleet.slot_time(tracker, slot)
    first = since // fleet.reading_every + 1
    last = until // fleet.reading_every
    first = max(first, last - MAX_BATCH + 1)
    rows = []
    for index, seq in enumerate(range(first, last + 1)):
        received_ms = until * 1000 + index
        record = make_record(fleet, tracker, seq, received_ms)
        rows.append((received_ms, record['id'], record))
    return rows


def received_between(fleet: Fleet, after_ms: int, until_ms: int) -> list[tuple[int, str, dict]]:
    """Records with after_ms < receivedDate <= until_ms, ordered by receivedDate then id."""
    rows = []
    for tracker in range(fleet.trackers):
        offset = fleet.offset(tracker)
        # An upload's records span under a second, so start one slot early to be safe.
        first = (after_ms // 1000 - 1 - offset) // fleet.upload_every
        last = (until_ms // 1000 - offset) // fleet.upload_every
        for slot in range(first, last + 1):
            rows.extend(row for row in upload(fleet, tracker, slot) if after_ms < row[0] <= until_ms)
    rows.sort(key=lambda row: (row[0], row[1]))
    return rows


def history(fleet: Fleet, now_ms: int, start_ms: int | None = None, end_ms: int | None = None,
            limit: int = MAX_LIMIT) -> list[tuple[int, str, dict]]:
    """The page a client sees: start exclusive, end inclusive, only what was already uploaded."""
    oldest = now_ms - int(fleet.days * 86_400_000)
    after = oldest - 1 if start_ms is None else max(start_ms, oldest - 1)
    until = now_ms if end_ms is None else min(end_ms, now_ms)
    if until <= after:
        return []
    return received_between(fleet, after, until)[:limit]


def page_body(rows: list[tuple[int, str, dict]]) -> dict:
    return {
        'data': [row[2] for row in rows],
        'count': len(rows),
        'maxDate': format_time(rows[-1][0]) if rows else None,
    }


def parse_limit(value: str) -> int:
    if not re.fullmatch(r'\d{1,6}', value) or not 1 <= int(value) <= MAX_LIMIT:
        raise ValueError(f'limit must be a whole number from 1 to {MAX_LIMIT}')
    return int(value)


class TrackerState:
    """Everything the request handlers share; the clock and sleep are injectable for tests."""

    def __init__(self, fleet: Fleet, api_key: str, account: str = 'A1', clock=time.time,
                 sleep=time.sleep, slow_seconds: float = 35.0):
        self.fleet, self.api_key, self.account = fleet, api_key, account
        self.clock, self.sleep, self.slow_seconds = clock, sleep, slow_seconds
        self.lock = threading.Lock()
        self.fault, self.fault_count, self.retry_after = 'none', 0, 5.0
        self.served: list[str] = []

    def now_ms(self) -> int:
        return int(self.clock() * 1000)

    def set_fault(self, fault: str, count: int, retry_after: float) -> None:
        with self.lock:
            self.fault, self.fault_count, self.retry_after = fault, (count if fault != 'none' else 0), retry_after

    def take_fault(self) -> tuple[str, float] | None:
        with self.lock:
            if self.fault == 'none' or self.fault_count < 1:
                return None
            self.fault_count -= 1
            return self.fault, self.retry_after

    def record_served(self, ids: list[str]) -> None:
        with self.lock:
            self.served.extend(ids)


@dataclass
class Reply:
    status: int
    body: dict
    headers: dict | None = None
    count: int | None = None
    served: list[str] | None = None
    note: str = ''


HISTORY_PATH = re.compile(r'^/accounts/([^/]+)/streams/history/?$')


def handle_history(state: TrackerState, account: str, supplied_key: str, query: str) -> Reply:
    if not hmac.compare_digest(supplied_key.encode(), state.api_key.encode()):
        return Reply(401, {'error': 'unauthorized'})
    if account != state.account:
        return Reply(404, {'error': 'account_not_found'})
    note = ''
    fault = state.take_fault()
    if fault:
        kind, retry_after = fault
        note = f' fault={kind}'
        if kind == '429':
            return Reply(429, {'error': 'rate_limited'}, {'Retry-After': f'{retry_after:g}'}, note=note)
        if kind == '500':
            return Reply(500, {'error': 'internal_error'}, note=note)
        if kind == '401':
            return Reply(401, {'error': 'unauthorized'}, note=note)
        state.sleep(state.slow_seconds)
    params = {name: values[0] for name, values in parse_qs(query, keep_blank_values=True).items()}
    try:
        start = parse_time(params['start']) if 'start' in params else None
        end = parse_time(params['end']) if 'end' in params else None
        limit = parse_limit(params['limit']) if 'limit' in params else MAX_LIMIT
    except ValueError as error:
        return Reply(400, {'error': 'bad_request', 'message': str(error)}, note=note)
    rows = history(state.fleet, state.now_ms(), start, end, limit)
    return Reply(200, page_body(rows), count=len(rows), served=[row[1] for row in rows], note=note)


def handle_control(state: TrackerState, raw: bytes) -> Reply:
    try:
        request = json.loads(raw or b'{}')
        if not isinstance(request, dict):
            raise ValueError('the body must be a JSON object')
        fault = request.get('fault', 'none')
        if fault not in FAULTS:
            raise ValueError(f'fault must be one of {", ".join(FAULTS)}')
        count, retry_after = request.get('count', 1), request.get('retry_after', 5)
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError('count must be a whole number, zero or more')
        if isinstance(retry_after, bool) or not isinstance(retry_after, (int, float)) or not 0 <= retry_after <= 3600:
            raise ValueError('retry_after must be a number of seconds from 0 to 3600')
    except ValueError as error:
        return Reply(400, {'error': 'bad_request', 'message': str(error)})
    state.set_fault(fault, count, float(retry_after))
    return Reply(200, {'fault': fault, 'count': count if fault != 'none' else 0, 'retry_after': retry_after})


def route(state: TrackerState, method: str, path: str, query: str, key: str, body: bytes) -> Reply:
    if path == '/_health':
        return Reply(200, {'status': 'ok'}) if method == 'GET' else Reply(405, {'error': 'method_not_allowed'})
    if path == '/_control':
        return handle_control(state, body) if method == 'POST' else Reply(405, {'error': 'method_not_allowed'})
    if path == '/_served':
        if method != 'GET':
            return Reply(405, {'error': 'method_not_allowed'})
        with state.lock:
            return Reply(200, {'ids': list(state.served)})
    if path == '/_served/reset':
        if method != 'POST':
            return Reply(405, {'error': 'method_not_allowed'})
        with state.lock:
            state.served.clear()
        return Reply(200, {'ok': True})
    match = HISTORY_PATH.match(path)
    if match:
        if method != 'GET':
            return Reply(405, {'error': 'method_not_allowed'})
        return handle_history(state, match.group(1), key, query)
    return Reply(404, {'error': 'not_found'})


def loggable(path: str, query: str) -> str:
    """The request target for the log line, with anything that looks like a key removed."""
    pairs = [(name, value) for name, value in parse_qsl(query, keep_blank_values=True)
             if name.lower() not in SECRET_PARAMS]
    return f'{path}?{urlencode(pairs, safe=":")}' if pairs else path


class TrackerHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'ExampleTrackerCloud/1.0'

    def log_message(self, format, *args):  # noqa: A002 - one line per request is logged below
        pass

    def handle_request(self, method: str) -> None:
        state: TrackerState = self.server.state
        parts = urlsplit(self.path)
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = 0
        if length > 65536:
            self.close_connection = True  # the rest of an oversized body is never read
        body = self.rfile.read(min(max(length, 0), 65536)) if length else b''
        try:
            reply = route(state, method, parts.path, parts.query, self.headers.get('x-api-key', ''), body)
        except Exception as error:  # a simulator bug must not look like a vendor outage
            reply = Reply(500, {'error': 'internal_error', 'message': type(error).__name__})
        payload = json.dumps(reply.body, separators=(',', ':')).encode()
        self.send_response(reply.status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        for name, value in (reply.headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        try:
            self.wfile.write(payload)
            self.wfile.flush()
            if reply.served:
                state.record_served(reply.served)
        except OSError:
            reply.note += ' client_gone'
        count = '-' if reply.count is None else reply.count
        stamp = format_time(state.now_ms())[:-5] + 'Z'
        print(f'{stamp} {method} {loggable(parts.path, parts.query)} {reply.status} count={count}{reply.note}',
              flush=True)

    def do_GET(self):
        self.handle_request('GET')

    def do_POST(self):
        self.handle_request('POST')

    def do_PUT(self):
        self.handle_request('PUT')

    def do_DELETE(self):
        self.handle_request('DELETE')

    def do_PATCH(self):
        self.handle_request('PATCH')


class TrackerServer(ThreadingHTTPServer):
    def __init__(self, address, state: TrackerState):
        super().__init__(address, TrackerHandler)
        self.state = state


def create_server(fleet: Fleet, api_key: str, account: str = 'A1', host: str = '127.0.0.1', port: int = 0,
                  clock=time.time, sleep=time.sleep, slow_seconds: float = 35.0) -> TrackerServer:
    return TrackerServer((host, port), TrackerState(fleet, api_key, account, clock, sleep, slow_seconds))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--host', default='127.0.0.1', help='Bind address; use 0.0.0.0 so Docker containers can reach it')
    parser.add_argument('--port', type=int, default=8096)
    parser.add_argument('--api-key', required=True, help='Value clients must send in the x-api-key header')
    parser.add_argument('--account', default='A1', help='The one account id the API serves')
    parser.add_argument('--trackers', type=int, default=3)
    parser.add_argument('--reading-every', type=int, default=300, help='Seconds between a tracker\'s readings')
    parser.add_argument('--upload-every', type=int, default=900, help='Seconds between a tracker\'s uploads')
    parser.add_argument('--offline-max', type=int, default=7200,
                        help='Longest time in seconds a tracker stays out of coverage; 0 disables outages')
    parser.add_argument('--days', type=float, default=3, help='History depth: receipts older than this are dropped')
    parser.add_argument('--seed', type=int, default=7)
    parser.add_argument('--slow-seconds', type=float, default=35, help='How long the "slow" fault delays a response')
    args = parser.parse_args(argv)
    try:
        fleet = Fleet(seed=args.seed, trackers=args.trackers, reading_every=args.reading_every,
                      upload_every=args.upload_every, offline_max=args.offline_max, days=args.days)
    except ValueError as error:
        parser.error(str(error))
    if not args.api_key or args.slow_seconds < 0:
        parser.error('Use a non-empty API key and a nonnegative --slow-seconds')
    server = create_server(fleet, args.api_key, args.account, args.host, args.port, slow_seconds=args.slow_seconds)

    def stop(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print(f'Example Tracker Cloud on http://{args.host}:{server.server_address[1]}/accounts/{args.account}/streams/history '
          f'({fleet.trackers} trackers, reading every {fleet.reading_every}s, upload every {fleet.upload_every}s, '
          f'{fleet.days:g} days of history)', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
