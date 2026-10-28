import calendar
import json
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter

import pytest

from vendor_tracker_api import (
    MAX_BATCH,
    Fleet,
    create_server,
    format_time,
    history,
    page_body,
    parse_time,
    received_between,
)

NOW_S = calendar.timegm((2026, 10, 27, 9, 20, 0))
NOW_MS = NOW_S * 1000
DAY_MS = 86_400_000
KEY = 'test-key'
RECORD_FIELDS = ['id', 'deviceId', 'timestamp', 'receivedDate', 'lat', 'lon', 'accuracy_m',
                 'temperature_c', 'humidity_pct', 'pressure_hpa', 'light_lux', 'battery_pct']


def everything(fleet=None, now_ms=NOW_MS):
    return history(fleet or Fleet(), now_ms, limit=10**6)


def walk(fetch_page, limit):
    """Follow maxDate as the next start until a page comes back empty."""
    start, pages, seen = None, [], []
    while True:
        page = fetch_page(start, limit)
        pages.append(page)
        if not page['data']:
            assert page['maxDate'] is None and page['count'] == 0
            return pages, seen
        seen.extend(record['id'] for record in page['data'])
        start = page['maxDate']


class TestDeterminism:
    def test_two_fleets_with_the_same_seed_serve_identical_records(self):
        first = [row[2] for row in received_between(Fleet(seed=7), NOW_MS - 3 * DAY_MS, NOW_MS)]
        second = [row[2] for row in received_between(Fleet(seed=7), NOW_MS - 3 * DAY_MS, NOW_MS)]
        assert first and first == second

    def test_another_seed_serves_other_data(self):
        window = (NOW_MS - DAY_MS, NOW_MS)
        assert received_between(Fleet(seed=7), *window) != received_between(Fleet(seed=8), *window)

    def test_a_record_does_not_depend_on_the_moment_it_is_asked_for(self):
        early = {row[1]: row[2] for row in history(Fleet(), NOW_MS)}
        later = {row[1]: row[2] for row in history(Fleet(), NOW_MS + 3_600_000)}
        shared = early.keys() & later.keys()
        assert shared and all(early[key] == later[key] for key in shared)


class TestUploads:
    def test_record_shape_and_value_ranges(self):
        rows = everything()
        assert rows
        for _, _, record in rows[:200]:
            assert list(record) == RECORD_FIELDS
            assert record['deviceId'].startswith('TRK-') and record['id'].startswith(record['deviceId'] + '-')
            assert 50.9 < record['lat'] < 51.1 and -114.1 < record['lon'] < -113.9
            assert 0 <= record['humidity_pct'] <= 100 and 0 <= record['battery_pct'] <= 100
            assert 900 < record['pressure_hpa'] < 1100 and record['light_lux'] >= 0

    def test_timestamps_are_iso_utc_with_milliseconds(self):
        record = everything()[0][2]
        for field in ('timestamp', 'receivedDate'):
            assert len(record[field]) == 24 and record[field].endswith('Z') and record[field][19] == '.'
        assert format_time(NOW_MS + 5) == '2026-10-27T09:20:00.005Z'

    def test_observation_is_older_than_receipt_and_receipt_is_not_in_the_future(self):
        for received_ms, _, record in received_between(Fleet(), NOW_MS - 3 * DAY_MS, NOW_MS):
            assert parse_time(record['timestamp']) < parse_time(record['receivedDate']) == received_ms <= NOW_MS

    def test_every_receipt_is_unique_across_all_trackers(self):
        rows = received_between(Fleet(), NOW_MS - 3 * DAY_MS, NOW_MS)
        assert len({row[0] for row in rows}) == len(rows)
        assert len({row[1] for row in rows}) == len(rows)

    def test_records_of_one_upload_get_consecutive_milliseconds(self):
        uploads = {}
        for received_ms, _, record in received_between(Fleet(), NOW_MS - DAY_MS, NOW_MS):
            uploads.setdefault((record['deviceId'], received_ms // 1000), []).append(received_ms % 1000)
        assert any(len(parts) > 1 for parts in uploads.values())
        assert all(parts == list(range(len(parts))) for parts in uploads.values())

    def test_normal_uploads_carry_three_readings_and_outages_leave_backlogs(self):
        sizes = Counter(Counter((r['deviceId'], ms // 1000) for ms, _, r in
                                received_between(Fleet(), NOW_MS - 3 * DAY_MS, NOW_MS)).values())
        assert sizes[3] > 100
        backlogs = [size for size in sizes.elements() if size > 3]
        assert backlogs and max(backlogs) <= 7200 // 300 + 900 // 300 + 3  # offline-max plus a period

    def test_no_outages_when_offline_max_is_zero(self):
        fleet = Fleet(offline_max=0)
        sizes = Counter((r['deviceId'], ms // 1000) for ms, _, r in received_between(fleet, NOW_MS - DAY_MS, NOW_MS))
        assert set(sizes.values()) == {3}

    def test_a_batch_never_exceeds_the_tracker_memory(self):
        fleet = Fleet(reading_every=1, upload_every=60, offline_max=3600, trackers=1)
        sizes = Counter(ms // 1000 for ms, _, _ in received_between(fleet, NOW_MS - 3 * 3_600_000, NOW_MS))
        assert 60 < max(sizes.values()) <= MAX_BATCH

    def test_a_reading_appears_only_once_its_upload_has_happened(self):
        fleet = Fleet()
        slot = (NOW_S - fleet.offset(0)) // fleet.upload_every
        while not fleet.online(0, slot):
            slot -= 1
        upload_s = fleet.slot_time(0, slot)
        before, after = (upload_s * 1000 - 1), (upload_s * 1000 + 3000)
        late = {row[1] for row in everything(fleet, before) if row[0] // 1000 == upload_s}
        now = {row[1] for row in everything(fleet, after) if row[0] // 1000 == upload_s}
        assert not late and len(now) >= 3

    def test_history_depth_drops_older_receipts(self):
        rows = everything(Fleet(days=1))
        assert rows and min(row[0] for row in rows) > NOW_MS - DAY_MS
        deeper = everything(Fleet(days=3))
        assert len(deeper) > len(rows)

    def test_fleet_rejects_nonsense(self):
        for bad in ({'trackers': 0}, {'reading_every': 0}, {'upload_every': 2}, {'offline_max': -1}, {'days': 0}):
            with pytest.raises(ValueError):
                Fleet(**bad)


class TestPaging:
    @pytest.mark.parametrize('limit', [1000, 250, 50])
    def test_maxdate_walks_every_record_exactly_once(self, limit):
        fleet = Fleet(days=1)  # keeps the small-page walk short
        def fetch(start, size):
            return page_body(history(fleet, NOW_MS, None if start is None else parse_time(start), None, size))

        pages, seen = walk(fetch, limit)
        expected = [row[1] for row in received_between(fleet, NOW_MS - DAY_MS - 1, NOW_MS)]
        assert seen == expected
        assert len(set(seen)) == len(seen)
        assert all(page['count'] == len(page['data']) <= limit for page in pages)

    def test_start_is_exclusive_and_end_is_inclusive(self):
        rows = everything()
        received = rows[10][0]
        after = history(Fleet(), NOW_MS, received)
        assert after[0][0] > received and rows[10][1] not in {row[1] for row in after}
        through = history(Fleet(), NOW_MS, rows[0][0] - 1, received)
        assert through[-1][1] == rows[10][1] and len(through) == 11

    def test_end_in_the_future_means_now(self):
        assert history(Fleet(), NOW_MS, None, NOW_MS + 10 * DAY_MS) == history(Fleet(), NOW_MS)

    def test_empty_page_has_a_null_max_date(self):
        assert page_body(history(Fleet(), NOW_MS, NOW_MS)) == {'data': [], 'count': 0, 'maxDate': None}

    def test_pages_are_ordered_by_receipt_then_id(self):
        rows = everything()
        assert [(row[0], row[1]) for row in rows] == sorted((row[0], row[1]) for row in rows)


class TestTimeParameters:
    def test_iso_forms_and_epoch_milliseconds_agree(self):
        for text in ('2026-10-27T09:20:00Z', '2026-10-27T09:20:00.000Z', '2026-10-27T09:20:00+00:00',
                     '2026-10-27T11:20:00+02:00', '2026-10-27T11:20:00 02:00', '2026-10-27T09:20:00',
                     str(NOW_MS)):
            assert parse_time(text) == NOW_MS, text

    def test_milliseconds_are_kept(self):
        assert parse_time('2026-10-27T09:20:00.125Z') == NOW_MS + 125

    @pytest.mark.parametrize('text', ['', 'yesterday', '2026-13-45T00:00:00Z', '12.5', '1' * 30])
    def test_invalid_times_are_rejected(self, text):
        with pytest.raises(ValueError):
            parse_time(text)


class Clock:
    def __init__(self, now_s=NOW_S):
        self.now_s = now_s

    def __call__(self):
        return self.now_s


class Sleeps(list):
    def __call__(self, seconds):
        self.append(seconds)


@pytest.fixture
def api():
    clock, sleeps = Clock(), Sleeps()
    server = create_server(Fleet(), KEY, 'A1', '127.0.0.1', 0, clock=clock, sleep=sleeps)
    thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_address[1]}'
    yield base, server.state, clock, sleeps
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def call(base, path, method='GET', key=KEY, body=None):
    headers = {'x-api-key': key} if key is not None else {}
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, dict(response.headers), json.loads(response.read() or b'null')
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), json.loads(error.read() or b'null')


def history_path(**params):
    query = urllib.parse.urlencode({name: value for name, value in params.items() if value is not None})
    return '/accounts/A1/streams/history' + (f'?{query}' if query else '')


class TestHttpApi:
    def test_history_response_shape(self, api):
        base, *_ = api
        status, headers, body = call(base, history_path(limit=5))
        assert status == 200 and headers['Content-Type'] == 'application/json'
        assert list(body) == ['data', 'count', 'maxDate']
        assert body['count'] == len(body['data']) == 5
        assert body['maxDate'] == body['data'][-1]['receivedDate']
        assert list(body['data'][0]) == RECORD_FIELDS

    def test_api_key_is_required(self, api):
        base, *_ = api
        for key in (None, 'wrong', ''):
            assert call(base, history_path(), key=key)[::2] == (401, {'error': 'unauthorized'})
        assert call(base, history_path())[0] == 200

    def test_unknown_account_is_404_and_unknown_path_is_404(self, api):
        base, *_ = api
        assert call(base, '/accounts/ZZ/streams/history')[0] == 404
        assert call(base, '/nope')[0] == 404
        assert call(base, '/accounts/ZZ/streams/history', key='wrong')[0] == 401

    def test_only_get_is_allowed_on_history(self, api):
        base, *_ = api
        assert call(base, history_path(), method='POST', body={})[0] == 405

    @pytest.mark.parametrize('params', [{'limit': 0}, {'limit': 1001}, {'limit': 'many'}, {'limit': ''},
                                        {'limit': -3}, {'start': 'yesterday'}, {'end': '2026-99-01'}])
    def test_invalid_parameters_are_400(self, api, params):
        base, *_ = api
        status, _, body = call(base, history_path(**params))
        assert status == 400 and body['error'] == 'bad_request' and body['message']

    def test_limit_defaults_to_and_is_capped_at_1000(self, api):
        base, *_ = api
        assert call(base, history_path())[2]['count'] == 1000
        assert call(base, history_path(limit=1000))[2]['count'] == 1000

    @pytest.mark.parametrize('style', ['iso', 'epoch'])
    def test_paging_over_http_visits_every_record_once(self, api, style):
        base, state, *_ = api

        def fetch(start, limit):
            if start is not None and style == 'epoch':
                start = parse_time(start)
            return call(base, history_path(start=start, limit=limit))[2]

        pages, seen = walk(fetch, 400)
        expected = [row[1] for row in received_between(state.fleet, NOW_MS - 3 * DAY_MS - 1, NOW_MS)]
        assert seen == expected and len(pages) == -(-len(expected) // 400) + 1
        assert call(base, '/_served')[2] == {'ids': expected}

    def test_offset_in_the_query_works_encoded_or_not(self, api):
        base, *_ = api
        expected = call(base, history_path(start='2026-10-27T08:20:00Z', limit=3))[2]
        assert expected['count'] == 3
        path = '/accounts/A1/streams/history?limit=3&start=2026-10-27T10:20:00'
        assert call(base, path + '%2B02:00')[2] == expected
        assert call(base, path + '+02:00')[2] == expected

    def test_end_bounds_the_page(self, api):
        base, state, *_ = api
        rows = received_between(state.fleet, NOW_MS - 3 * DAY_MS - 1, NOW_MS)
        end = format_time(rows[4][0])
        body = call(base, history_path(end=end))[2]
        assert [r['id'] for r in body['data']] == [row[1] for row in rows[:5]]

    def test_new_uploads_show_up_when_the_clock_advances(self, api):
        base, _, clock, _ = api
        cursor = call(base, history_path())[2]['maxDate']  # a full page; follow it to the end
        while True:
            page = call(base, history_path(start=cursor))[2]
            if not page['data']:
                break
            cursor = page['maxDate']
        clock.now_s += 3 * 3600
        fresh = call(base, history_path(start=cursor))[2]
        assert fresh['count'] > 0 and fresh['maxDate'] > cursor

    def test_two_servers_serve_identical_bytes(self, api):
        base, *_ = api
        other = create_server(Fleet(), 'another-key', 'A1', '127.0.0.1', 0, clock=Clock())
        thread = threading.Thread(target=other.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
        thread.start()
        try:
            path = history_path(start='2026-10-27T05:00:00Z', limit=300)
            second = call(f'http://127.0.0.1:{other.server_address[1]}', path, key='another-key')
            assert call(base, path)[2] == second[2]
        finally:
            other.shutdown()
            other.server_close()

    def test_health(self, api):
        base, *_ = api
        assert call(base, '/_health', key=None)[::2] == (200, {'status': 'ok'})


class TestControls:
    def test_each_fault_applies_to_the_next_n_history_requests_only(self, api):
        base, *_ = api
        for fault, status in (('500', 500), ('429', 429), ('401', 401)):
            assert call(base, '/_control', 'POST', None, {'fault': fault, 'count': 2, 'retry_after': 7})[0] == 200
            assert [call(base, history_path(limit=1))[0] for _ in range(3)] == [status, status, 200]

    def test_429_carries_retry_after(self, api):
        base, *_ = api
        call(base, '/_control', 'POST', None, {'fault': '429', 'count': 1, 'retry_after': 7})
        status, headers, body = call(base, history_path())
        assert status == 429 and headers['Retry-After'] == '7' and body['error'] == 'rate_limited'

    def test_defaults_to_one_request(self, api):
        base, *_ = api
        call(base, '/_control', 'POST', None, {'fault': '500'})
        assert [call(base, history_path(limit=1))[0] for _ in range(2)] == [500, 200]

    def test_none_clears_a_pending_fault(self, api):
        base, *_ = api
        call(base, '/_control', 'POST', None, {'fault': '500', 'count': 5})
        assert call(base, '/_control', 'POST', None, {'fault': 'none'})[0] == 200
        assert call(base, history_path(limit=1))[0] == 200

    def test_faults_are_not_used_up_by_requests_that_fail_authentication(self, api):
        base, *_ = api
        call(base, '/_control', 'POST', None, {'fault': '500', 'count': 1})
        assert call(base, history_path(), key='wrong')[0] == 401
        assert call(base, history_path(limit=1))[0] == 500

    def test_slow_delays_then_answers_normally(self, api):
        base, _, _, sleeps = api
        call(base, '/_control', 'POST', None, {'fault': 'slow', 'count': 1})
        status, _, body = call(base, history_path(limit=2))
        assert status == 200 and body['count'] == 2 and sleeps == [35.0]
        assert call(base, history_path(limit=1))[0] == 200 and sleeps == [35.0]

    @pytest.mark.parametrize('body', [{'fault': 'explode'}, {'fault': '500', 'count': -1}, {'fault': '500', 'count': 'x'},
                                      {'fault': '429', 'retry_after': -2}, ['500']])
    def test_invalid_control_requests_are_400(self, api, body):
        base, *_ = api
        assert call(base, '/_control', 'POST', None, body)[0] == 400

    def test_served_lists_only_ids_from_200_responses_and_can_be_reset(self, api):
        base, *_ = api
        call(base, '/_control', 'POST', None, {'fault': '500', 'count': 1})
        call(base, history_path(limit=3))
        first = call(base, history_path(limit=3))[2]
        assert call(base, '/_served', key=None)[2] == {'ids': [r['id'] for r in first['data']]}
        assert call(base, '/_served/reset', 'POST', None, {})[0] == 200
        assert call(base, '/_served', key=None)[2] == {'ids': []}
