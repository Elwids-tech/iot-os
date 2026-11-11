<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\BillingAccounts;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceLink;
use App\Domain\Devices\Models\DeviceMove;
use App\Domain\Devices\Models\TelemetryRetentionSetting;
use App\Domain\Devices\Services\Moves\MovePreview;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Spatie\Activitylog\Models\Activity;

/**
 * History across a move (spec 031 US6, research R18): with the option, the successor's
 * history includes its predecessor's readings from before the cutover, read from the
 * source under its retention and labelled as recorded there. The runtime is a small
 * in-memory store answering history and records the way the runtime does.
 */
final class HistoryAcrossMoveTest extends MoveTestCase
{
    private CarbonImmutable $t0;

    private Device $x;

    /** Stored readings: organization, device, parameter, time, value. */
    private array $stored = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->t0 = CarbonImmutable::parse('2026-11-10T12:00:00Z');
        $this->travelTo($this->t0);
        $this->x = $this->adapterFed('WM-1001', 'Tracker X');
        // A day of readings before the move, every 30 minutes, and one from two days back.
        foreach ([...range(30, 24 * 60, 30), 48 * 60] as $minutes) {
            $this->store($this->a, $this->x, $this->t0->subMinutes($minutes), 10.0);
        }
    }

    public function test_with_the_option_the_successor_reads_the_readings_from_before_the_move_labelled(): void
    {
        $review = $this->review($this->a, $this->b, [$this->x], ['include_history' => true])->assertOk()->json();
        $this->assertSame(['offered' => true, 'include' => true], $review['history']);
        $this->assertContains('Harbour Shop can read the readings from before the move. They stay stored in Integrator, for as long as Integrator keeps readings.', $review['summary']);
        $move = $this->moved($this->a, $this->b, [$this->x], ['include_history' => true]);
        $successor = $this->arrive($this->x, 20.0);
        $this->assertTrue(DeviceLink::where('device_move_id', DeviceMove::where('uuid', $move['uuid'])->value('id'))->value('history_included'));

        $this->actingAs($this->bOnly, 'sanctum');
        $this->assertSame(['included' => true, 'stopped_at' => null, 'stopped_reason' => null], $this->getJson($this->in($this->b).'/devices/'.$successor->uuid)->assertOk()->json('data.link.history'));
        $series = $this->history($this->b, $successor);
        $this->assertCount(1, $series);
        $points = collect($series[0]['points'])->where('count', '>', 0);
        $before = $points->where('recorded_in', 'source');
        $after = $points->where('recorded_in', 'self');
        $this->assertSame(49, $before->sum('count'));
        $this->assertSame(10.0, (float) $before->avg('value'));
        $this->assertSame(6, $after->sum('count'));
        $this->assertSame(20.0, (float) $after->avg('value'));
        $this->assertTrue($before->every(fn (array $point): bool => CarbonImmutable::parse($point['at'])->lessThan($this->t0)));
        $this->assertTrue($after->every(fn (array $point): bool => CarbonImmutable::parse($point['at'])->greaterThanOrEqualTo($this->t0->subMinutes(30))));
        // The line breaks only where the readings paused: after the one from two days back, not at the cutover.
        $gaps = collect($series[0]['points'])->where('count', 0);
        $this->assertCount(1, $gaps);
        $this->assertTrue(CarbonImmutable::parse($gaps->first()['at'])->lessThan($this->t0->subDay()));

        // Laravel asked the runtime twice: for the predecessor under the source, its retention and
        // its own parameter, up to the cutover; both with one bucket width.
        $asked = $this->asked('/internal/measurements/history');
        $source = $asked->firstWhere('organization_uuid', $this->a->uuid);
        $own = $asked->firstWhere('organization_uuid', $this->b->uuid);
        $this->assertSame([$this->x->uuid, $this->parameter($this->x), app(RetentionService::class)->effective($this->a)['days']], [$source['device_uuid'], $source['parameter_uuid'], (int) $source['retention_days']]);
        $this->assertTrue(CarbonImmutable::parse($source['to'])->equalTo($this->t0));
        $this->assertSame($source['bucket_seconds'], $own['bucket_seconds']);
        $this->assertSame([$successor->uuid, $this->parameter($successor)], [$own['device_uuid'], $own['parameter_uuid']]);

        // The records and the CSV export page through the device's own, then the predecessor's.
        $records = $this->records($this->b, $successor, 10);
        $this->assertCount(6 + 49, $records);
        $this->assertSame(array_fill(0, 6, 'self'), array_column(array_slice($records, 0, 6), 'recorded_in'));
        $earlier = array_slice($records, 6);
        $this->assertSame(['source'], array_values(array_unique(array_column($earlier, 'recorded_in'))));
        $this->assertSame([$this->parameter($successor)], array_values(array_unique(array_column($earlier, 'parameter_uuid'))));
        $this->assertSame(['WM-1001'], array_values(array_unique(array_column($earlier, 'manufacturer_serial'))));
        foreach ($earlier as $record) {
            $this->assertArrayNotHasKey('installation_uuid', $record);
            $this->assertArrayNotHasKey('adapter_revision_uuid', $record);
        }
        $this->assertSame(collect($records)->sortByDesc('received_at')->pluck('event_uuid')->all(), array_column($records, 'event_uuid'));
        // The limit counts both: the newest 20 are 6 of its own and 14 from before.
        $limited = $this->records($this->b, $successor, 50, 20);
        $this->assertSame([6, 14], [collect($limited)->where('recorded_in', 'self')->count(), collect($limited)->where('recorded_in', 'source')->count()]);
        $this->assertStringNotContainsString($this->a->uuid, json_encode([$series, $records]));
        $this->assertStringNotContainsString($this->x->uuid, json_encode([$series, $records]));
    }

    public function test_without_the_option_the_successor_reads_nothing_from_before_the_move(): void
    {
        $review = $this->review($this->a, $this->b, [$this->x])->assertOk()->json();
        $this->assertSame(['offered' => true, 'include' => false], $review['history']);
        $this->moved($this->a, $this->b, [$this->x]);
        $successor = $this->arrive($this->x, 20.0);

        $series = $this->as($this->bOnly, fn () => $this->history($this->b, $successor));
        $this->assertSame(['self'], collect($series[0]['points'])->pluck('recorded_in')->unique()->values()->all());
        $this->assertSame(6, collect($series[0]['points'])->sum('count'));
        $this->assertCount(6, $this->as($this->bOnly, fn () => $this->records($this->b, $successor, 10)));
        $this->assertNull($this->asked('/internal/measurements/history')->firstWhere('organization_uuid', $this->a->uuid));
        $this->assertNull($this->asked('/internal/measurements/records')->firstWhere('organization_uuid', $this->a->uuid));
        $this->assertFalse($this->getJson($this->in($this->b).'/devices/'.$successor->uuid)->json('data.link.history.included'));
    }

    public function test_a_review_and_a_confirmation_must_agree_on_the_option(): void
    {
        $this->review($this->a, $this->b, [$this->x], ['include_history' => 'please'])->assertUnprocessable()->assertJsonValidationErrors('include_history');
        $hash = $this->review($this->a, $this->b, [$this->x])->assertOk()->json('preview_hash');

        $this->postJson($this->in($this->a).'/device-moves', ['target_organization_uuid' => $this->b->uuid, 'device_uuids' => [$this->x->uuid], 'include_history' => true,
            'operation_uuid' => (string) Str::uuid(), 'preview_hash' => $hash])->assertConflict()->assertJsonPath('review.history.include', true);
    }

    public function test_a_source_member_with_move_permission_stops_sharing_on_the_predecessor(): void
    {
        $this->moved($this->a, $this->b, [$this->x], ['include_history' => true]);
        $successor = $this->arrive($this->x, 20.0);
        $stop = '/devices/'.$this->x->uuid.'/link/history';

        // Not from the target, not on the successor, not back on.
        $this->as($this->bOnly, fn () => $this->postJson($this->in($this->b).$stop, ['enabled' => false])->assertNotFound());
        $this->as($this->bOnly, fn () => $this->postJson($this->in($this->a).$stop, ['enabled' => false])->assertForbidden());
        $this->as($this->mover, fn () => $this->postJson($this->in($this->b).'/devices/'.$successor->uuid.'/link/history', ['enabled' => false])->assertNotFound());
        $this->as($this->aOnly, fn () => $this->postJson($this->in($this->a).$stop, ['enabled' => true])->assertUnprocessable()->assertJsonValidationErrors('enabled'));

        $link = $this->as($this->aOnly, fn () => $this->postJson($this->in($this->a).$stop, ['enabled' => false])->assertOk()->json('data'));
        $this->assertSame(['moved_to', true, 'stopped'], [$link['direction'], $link['history']['included'], $link['history']['stopped_reason']]);
        $this->assertNotNull($link['history']['stopped_at']);
        $this->as($this->aOnly, fn () => $this->postJson($this->in($this->a).$stop, ['enabled' => false])->assertOk());
        $this->assertSame(2, Activity::where('event', 'device_link.history_stopped')->count());
        $this->assertSame($this->aOnly->id, DeviceLink::where('predecessor_device_id', $this->x->id)->value('history_stopped_by'));

        $series = $this->as($this->bOnly, fn () => $this->history($this->b, $successor));
        $this->assertSame(['self'], collect($series[0]['points'])->pluck('recorded_in')->unique()->values()->all());
        $this->assertCount(6, $this->as($this->bOnly, fn () => $this->records($this->b, $successor, 10)));
        $this->assertSame('stopped', $this->as($this->bOnly, fn () => $this->getJson($this->in($this->b).'/devices/'.$successor->uuid)->json('data.link.history.stopped_reason')));
    }

    public function test_a_records_cursor_from_before_stopping_ends_the_pages(): void
    {
        $this->moved($this->a, $this->b, [$this->x], ['include_history' => true]);
        $successor = $this->arrive($this->x, 20.0);
        $page = $this->as($this->bOnly, fn () => $this->recordsPage($this->b, $successor, ['limit' => 500, 'page_size' => 10]));
        $cursor = $page['meta']['next_cursor'];
        $this->assertStringStartsWith('earlier.6.', $cursor);
        $this->as($this->aOnly, fn () => $this->postJson($this->in($this->a).'/devices/'.$this->x->uuid.'/link/history', ['enabled' => false])->assertOk());

        $next = $this->as($this->bOnly, fn () => $this->recordsPage($this->b, $successor, ['limit' => 500, 'page_size' => 10, 'cursor' => $cursor]));
        $this->assertSame([[], false, null], [$next['data'], $next['meta']['has_more'], $next['meta']['next_cursor']]);
        $this->as($this->bOnly, fn () => $this->getJson($this->in($this->b).'/devices/'.$successor->uuid.'/measurements/records?'.http_build_query(['from' => $this->t0->subDays(3)->toJSON(), 'to' => now()->toJSON(),
            'parameter_uuid' => $this->parameter($successor), 'limit' => 5, 'cursor' => 'earlier.9.x']))->assertUnprocessable()->assertJsonValidationErrors('cursor'));
    }

    public function test_leaving_the_account_stops_sharing_for_good(): void
    {
        $device = $this->profiled('Bench meter');
        foreach ([60, 120] as $minutes) {
            $this->store($this->a, $device, $this->t0->subMinutes($minutes), 5.0);
        }
        $this->moved($this->a, $this->b, [$device], ['include_history' => true]);
        $successor = $this->successor($device);
        $this->travelTo($this->t0->addHour());
        $this->assertSame(['source'], collect($this->history($this->b, $successor)[0]['points'] ?? [])->pluck('recorded_in')->unique()->values()->all());

        $home = $this->b->billing_account_id;
        $elsewhere = BillingAccount::findOrFail($this->c->billing_account_id);
        app(BillingAccounts::class)->move($this->b->fresh(), $elsewhere, $this->mover, confirmRetention: true);
        $this->assertSame('left_account', DeviceLink::where('successor_device_id', $successor->id)->value('history_stopped_reason'));
        app(BillingAccounts::class)->move($this->b->fresh(), BillingAccount::findOrFail($home), $this->mover, confirmRetention: true);

        $this->assertSame([], $this->history($this->b, $successor));
        $this->assertCount(1, $this->asked('/internal/measurements/history')->where('organization_uuid', $this->a->uuid));
    }

    public function test_a_chain_of_moves_gives_each_successor_only_its_own_predecessors_readings(): void
    {
        $this->moved($this->a, $this->b, [$this->x], ['include_history' => true]);
        $inB = $this->arrive($this->x, 20.0);
        $this->moved($this->b, $this->d, [$inB], ['include_history' => true]);
        $inD = $this->arrive($inB, 30.0, $this->t0->addHour());
        $this->runtimeQueries = [];

        $series = $this->history($this->d, $inD);
        $points = collect($series[0]['points'])->where('count', '>', 0);
        $this->assertSame([20.0], $points->where('recorded_in', 'source')->pluck('value')->map(fn ($v) => (float) $v)->unique()->values()->all());
        $this->assertSame([30.0], $points->where('recorded_in', 'self')->pluck('value')->map(fn ($v) => (float) $v)->unique()->values()->all());
        $this->assertEqualsCanonicalizing([$this->b->uuid, $this->d->uuid], $this->asked('/internal/measurements/history')->pluck('organization_uuid')->all());
        $this->assertNull(collect($this->runtimeQueries)->first(fn (array $request): bool => ($request[1]['organization_uuid'] ?? null) === $this->a->uuid));
        $this->assertCount(6 + 6, $this->records($this->d, $inD, 50));
        // B still reads its archived device's history from before its first move.
        $this->assertContains(10.0, collect($this->history($this->b, $inB)[0]['points'])->where('count', '>', 0)->pluck('value')->map(fn ($v) => (float) $v)->unique()->all());
    }

    public function test_an_organization_outside_the_account_reaches_none_of_it(): void
    {
        $this->moved($this->a, $this->b, [$this->x], ['include_history' => true]);
        $successor = $this->arrive($this->x, 20.0);
        $this->actingAs($this->cAdmin, 'sanctum');
        $c = $this->in($this->c);
        $window = http_build_query(['from' => $this->t0->subDays(2)->toJSON(), 'to' => now()->toJSON(), 'parameter_uuid' => $this->parameter($successor)]);

        $this->getJson($c.'/devices/'.$successor->uuid.'/measurements/history?'.$window)->assertNotFound();
        $this->getJson($c.'/devices/'.$successor->uuid.'/measurements/records?'.$window)->assertNotFound();
        $this->postJson($c.'/devices/'.$this->x->uuid.'/link/history', ['enabled' => false])->assertNotFound();
        $this->postJson($this->in($this->a).'/devices/'.$this->x->uuid.'/link/history', ['enabled' => false])->assertForbidden();
        $this->getJson($this->in($this->b).'/devices/'.$successor->uuid.'/measurements/history?'.$window)->assertForbidden();
        $this->assertSame([], $this->asked('/internal/measurements/history')->all());
    }

    public function test_the_sources_retention_applies_to_the_readings_from_before_the_move(): void
    {
        TelemetryRetentionSetting::create(['scope_key' => 'organization:'.$this->a->uuid, 'organization_id' => $this->a->id, 'days' => 1]);
        $this->moved($this->a, $this->b, [$this->x], ['include_history' => true]);
        $successor = $this->arrive($this->x, 20.0);

        $points = collect($this->history($this->b, $successor)[0]['points'])->where('count', '>', 0)->where('recorded_in', 'source');
        $cutoff = now()->subDay();
        // Readings older than a day before now are past A's retention; B keeps its own.
        $this->assertSame(46, $points->sum('count'));
        $this->assertSame(46, collect(range(30, 24 * 60, 30))->filter(fn (int $minutes): bool => $this->t0->subMinutes($minutes)->greaterThanOrEqualTo($cutoff))->count());
        $this->assertSame(['1', (string) app(RetentionService::class)->effective($this->b)['days']], [$this->asked('/internal/measurements/history')->firstWhere('organization_uuid', $this->a->uuid)['retention_days'],
            $this->asked('/internal/measurements/history')->firstWhere('organization_uuid', $this->b->uuid)['retention_days']]);
        $this->assertGreaterThan(1, app(RetentionService::class)->effective($this->b)['days']);
    }

    protected function runtimeAnswer(string $path, array $query): ?array
    {
        return match ($path) {
            '/internal/measurements/history' => $this->runtimeHistory($query),
            '/internal/measurements/records' => $this->runtimeRecords($query),
            default => null,
        };
    }

    /** The successor of a device moved at `$at`, applied, with six readings in the hour after. */
    private function arrive(Device $predecessor, float $value, ?CarbonImmutable $at = null): Device
    {
        $at ??= $this->t0;
        $successor = $this->successor($predecessor);
        $this->applied($successor);
        foreach (range(5, 55, 10) as $minutes) {
            $this->store($successor->organization, $successor, $at->addMinutes($minutes), $value);
        }
        $this->travelTo($at->addHour());

        return $successor->fresh();
    }

    /** A device of A with a water meter configuration and no source. */
    private function profiled(string $name): Device
    {
        $device = $this->unsourced($name);
        $artifact = DeviceProfile::where('organization_id', $this->a->id)->where('code', 'water-meter-onboarding-example')->firstOrFail()->artifacts()->firstOrFail()->uuid;
        $this->putJson($this->in($this->a).'/devices/'.$device->uuid.'/configuration', ['draft_revision' => $device->draft_revision, 'artifact_uuid' => $artifact, 'candidate_uuid' => null, 'mappings' => []])->assertOk();

        return $device->fresh();
    }

    /** The device's flow rate parameter. */
    private function parameter(Device $device): string
    {
        $artifact = MovePreview::baseDraft($device->fresh())['artifact_uuid'];
        $definition = DeviceProfileArtifact::where('uuid', $artifact)->firstOrFail()->definition;

        return collect($definition['parameters'])->firstWhere('key', 'flow_rate')['uuid'];
    }

    private function store(Organization $organization, Device $device, CarbonImmutable $at, float $value): void
    {
        $this->stored[] = ['organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'parameter_uuid' => $this->parameter($device), 'at' => $at, 'value' => $value, 'event_uuid' => (string) Str::uuid()];
    }

    /** @return list<array<string, mixed>> */
    private function history(Organization $organization, Device $device): array
    {
        return $this->getJson($this->in($organization).'/devices/'.$device->uuid.'/measurements/history?'.http_build_query(['from' => $this->t0->subDays(3)->toJSON(), 'to' => now()->toJSON(),
            'parameter_uuid' => $this->parameter($device), 'max_points' => 500]))->assertOk()->json('data');
    }

    /** Every record of the range, page by page, as the CSV export reads them. */
    private function records(Organization $organization, Device $device, int $pageSize, int $limit = 5000): array
    {
        $records = [];
        $cursor = null;
        do {
            $page = $this->recordsPage($organization, $device, ['limit' => $limit, 'page_size' => $pageSize, ...($cursor ? ['cursor' => $cursor] : [])]);
            $this->assertSame(count($page['data']), $page['meta']['returned']);
            $records = [...$records, ...$page['data']];
            $cursor = $page['meta']['next_cursor'];
        } while ($cursor !== null);

        return $records;
    }

    private function recordsPage(Organization $organization, Device $device, array $query): array
    {
        return $this->getJson($this->in($organization).'/devices/'.$device->uuid.'/measurements/records?'.http_build_query(['from' => $this->t0->subDays(3)->toJSON(), 'to' => now()->toJSON(),
            'parameter_uuid' => $this->parameter($device), ...$query]))->assertOk()->json();
    }

    /** @return Collection<int, array<string, mixed>> the queries of one runtime path */
    private function asked(string $path): Collection
    {
        return collect($this->runtimeQueries)->filter(fn (array $request): bool => $request[0] === $path)->map(fn (array $request): array => $request[1])->values();
    }

    /** @return array{0: CarbonImmutable, 1: CarbonImmutable} the range after retention and now */
    private function runtimeWindow(array $query): array
    {
        $now = CarbonImmutable::now();

        return [CarbonImmutable::parse($query['from'])->max($now->subDays((int) $query['retention_days'])), CarbonImmutable::parse($query['to'])->min($now)];
    }

    /** @return Collection<int, array<string, mixed>> oldest first */
    private function readingsFor(array $query): Collection
    {
        [$from, $to] = $this->runtimeWindow($query);

        return collect($this->stored)->filter(fn (array $reading): bool => $reading['organization_uuid'] === $query['organization_uuid'] && $reading['device_uuid'] === $query['device_uuid']
            && $reading['parameter_uuid'] === $query['parameter_uuid'] && $reading['at']->betweenIncluded($from, $to))->sortBy(fn (array $reading): int => $reading['at']->getTimestampMs())->values();
    }

    private function runtimeHistory(array $query): array
    {
        [$from, $to] = $this->runtimeWindow($query);
        $maxPoints = (int) ($query['max_points'] ?? 500);
        $width = (int) ($query['bucket_seconds'] ?? max(1, (int) ceil(($to->getTimestamp() - $from->getTimestamp()) / intdiv($maxPoints, 2))));
        $points = $this->readingsFor($query)->groupBy(fn (array $reading): int => intdiv($reading['at']->getTimestamp(), $width) * $width)
            ->map(fn (Collection $bucket, int $start): array => ['at' => CarbonImmutable::createFromTimestampUTC($start)->format('Y-m-d\TH:i:s\Z'),
                'value' => $bucket->avg('value'), 'min' => $bucket->min('value'), 'max' => $bucket->max('value'), 'count' => $bucket->count()])->values()->all();

        return ['data' => $points === [] ? [] : [['configuration_uuid' => (string) Str::uuid(), 'unit' => 'L/min', 'data_type' => 'number', 'points' => $points]],
            'from' => $from->toJSON(), 'to' => $to->toJSON(), 'max_points' => $maxPoints];
    }

    private function runtimeRecords(array $query): array
    {
        [$from, $to] = $this->runtimeWindow($query);
        $readings = $this->readingsFor($query)->reverse()->values();
        $limit = (int) $query['limit'];
        $size = (int) $query['page_size'];
        $offset = isset($query['cursor']) ? (int) Str::between($query['cursor'], 'offset-', '.') : 0;
        $page = $readings->take($limit)->slice($offset, $size)->values();
        $consumed = $offset + $page->count();
        $more = $consumed < min($limit, $readings->count());

        return ['data' => $page->map(fn (array $reading): array => ['event_uuid' => $reading['event_uuid'], 'configuration_uuid' => (string) Str::uuid(), 'parameter_uuid' => $reading['parameter_uuid'],
            'received_at' => $reading['at']->toJSON(), 'observed_at' => $reading['at']->toJSON(), 'data_type' => 'number', 'unit' => 'L/min', 'value' => $reading['value'], 'quality' => 'good',
            'timestamp_source' => 'receipt', 'historical' => false, 'installation_uuid' => (string) Str::uuid(), 'adapter_revision_uuid' => 'pipe-owner-revision', 'manufacturer_serial' => 'WM-1001'])->all(),
            'meta' => ['from' => $from->toJSON(), 'to' => $to->toJSON(), 'limit' => $limit, 'page_size' => $size, 'returned' => $page->count(), 'consumed' => $consumed,
                'next_cursor' => $more ? 'offset-'.$consumed.'.signature' : null, 'has_more' => $more, 'limit_reached' => ! $more && $readings->count() > $limit]];
    }
}
