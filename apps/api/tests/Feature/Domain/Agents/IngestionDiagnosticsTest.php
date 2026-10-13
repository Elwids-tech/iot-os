<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Agents;

use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Services\IngestionDiagnostics;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** The five fault scenarios of spec 004 SC-006, plus what the checks say when they cannot know. */
final class IngestionDiagnosticsTest extends TestCase
{
    use RefreshDatabase;

    private function device(array $device = [], ?array $candidate = [], ?array $configuration = []): Device
    {
        $model = new Device(['lifecycle' => 'active', 'deployment_status' => 'applied', 'last_seen_at' => now()->subMinutes(2), ...$device]);
        $model->setRelation('candidate', $candidate === null ? null : new DiscoveryCandidate(['source_device_id' => 'meter', 'presence' => 'online', 'birth_revision' => 3, 'last_seen_at' => now()->subMinutes(2), 'metrics' => [['name' => 'Voltage'], ['name' => 'Current']], ...$candidate]));
        $model->candidate?->setRelation('gateway', null);
        $model->setRelation('appliedConfiguration', $configuration === null ? null : new DeviceConfiguration(['definition' => ['birth_revision' => 3, 'mappings' => [['metric' => 'Voltage'], ['metric' => 'Current']], ...$configuration]]));
        $model->setRelation('lastAppliedConfiguration', null);

        return $model;
    }

    /** @return array<string, array{status: string, detail: string}> */
    private function checks(Device $device, ?array $latest = ['data' => [['label' => 'Voltage', 'quality' => 'good']]], ?string $error = null): array
    {
        return collect(app(IngestionDiagnostics::class)->device($device, $latest, $error))->keyBy('check')->all();
    }

    public function test_a_healthy_device_passes_every_check(): void
    {
        $checks = $this->checks($this->device());

        foreach (['lifecycle', 'configuration', 'source', 'last_reading', 'review_required', 'unmapped_metrics', 'reading_quality'] as $check) {
            $this->assertSame('ok', $checks[$check]['status'], $check.': '.$checks[$check]['detail']);
        }
    }

    public function test_a_device_that_stopped_reporting(): void
    {
        $checks = $this->checks($this->device(['last_seen_at' => now()->subHours(3)], ['presence' => 'offline', 'last_seen_at' => now()->subHours(3)]),
            ['data' => [['label' => 'Voltage', 'quality' => 'stale', 'diagnostic' => 'No reading for 3 hours']]]);

        $this->assertSame('problem', $checks['source']['status']);
        $this->assertStringContainsString('offline', $checks['source']['detail']);
        $this->assertSame('problem', $checks['last_reading']['status']);
        $this->assertSame('problem', $checks['reading_quality']['status']);
        $this->assertStringContainsString('Voltage is stale (No reading for 3 hours)', $checks['reading_quality']['detail']);
    }

    public function test_an_announced_metric_that_is_not_mapped(): void
    {
        $checks = $this->checks($this->device(candidate: ['metrics' => [['name' => 'Voltage'], ['name' => 'Current'], ['name' => 'Frequency']]]));

        $this->assertSame('problem', $checks['unmapped_metrics']['status']);
        $this->assertStringContainsString('Frequency', $checks['unmapped_metrics']['detail']);
    }

    public function test_a_source_that_changed_and_needs_review(): void
    {
        $drift = $this->checks($this->device(candidate: ['birth_revision' => 4]));
        $this->assertSame('problem', $drift['review_required']['status']);
        $this->assertStringContainsString('birth revision 4', $drift['review_required']['detail']);

        $latched = $this->checks($this->device(['diagnostic' => 'A source birth changed approved metrics; review the mapping.']));
        $this->assertSame('problem', $latched['review_required']['status']);
    }

    public function test_a_rejected_configuration_and_an_inactive_device(): void
    {
        $checks = $this->checks($this->device(['lifecycle' => 'registered', 'deployment_status' => 'failed', 'diagnostic' => 'Datatype mismatch for Voltage']));

        $this->assertSame('problem', $checks['lifecycle']['status']);
        $this->assertSame('problem', $checks['configuration']['status']);
        $this->assertStringContainsString('Datatype mismatch', $checks['configuration']['detail']);
    }

    public function test_a_failing_adapter_and_its_decoder(): void
    {
        $adapter = new DeviceAdapter(['name' => 'Water meters', 'status' => 'failed', 'diagnostic' => 'Decoder threw: unexpected byte', 'health' => ['source_connected' => false, 'upstream_connected' => true]]);

        $checks = collect(app(IngestionDiagnostics::class)->adapter($adapter))->keyBy('check');

        $this->assertSame('problem', $checks['adapter_status']['status']);
        $this->assertStringContainsString('Decoder threw', $checks['adapter_status']['detail']);
        $this->assertSame('problem', $checks['adapter_connectivity']['status']);
        $this->assertStringContainsString('Source broker disconnected', $checks['adapter_connectivity']['detail']);
        $this->assertSame('unknown', $checks['decoder_tests']['status']);
    }

    public function test_missing_facts_are_unknown_never_ok(): void
    {
        $checks = $this->checks($this->device(candidate: null, configuration: null), null, 'The device runtime is unavailable.');

        $this->assertSame('problem', $checks['source']['status']);
        $this->assertSame('unknown', $checks['review_required']['status']);
        $this->assertSame('unknown', $checks['unmapped_metrics']['status']);
        $this->assertSame('unknown', $checks['reading_quality']['status']);
        $this->assertStringContainsString('runtime is unavailable', $checks['reading_quality']['detail']);
    }
}
