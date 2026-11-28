<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceAdapters;

use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\Devices\Models\DiscoveryCandidate;
use Illuminate\Support\Str;
use Tests\Feature\Domain\Devices\Moves\MoveTestCase;

/**
 * Activating many sources at once (spec 038 T070, research R14): each gets its own result,
 * and the data source is redeployed once, not once per source.
 */
final class BatchActivationTest extends MoveTestCase
{
    private function source(string $serial, bool $born = true): AdapterCandidate
    {
        $adapter = $this->adapter();
        $sparkplug = 'src-'.substr(hash('sha256', $serial), 0, 32);
        if ($born) {
            DiscoveryCandidate::create(['organization_id' => $this->a->id, 'sparkplug_gateway_id' => $adapter->sparkplug_gateway_id, 'source_device_id' => $sparkplug, 'birth_revision' => 1,
                'presence' => 'online', 'session_id' => 'session-test', 'last_seen_at' => now(), 'metrics' => [['name' => 'flow_rate', 'datatype' => 'Double', 'value' => 12]]]);
        }

        return AdapterCandidate::create(['organization_id' => $this->a->id, 'device_adapter_id' => $adapter->id, 'source_device_id' => $serial, 'sparkplug_device_id' => $sparkplug, 'preview' => [], 'last_seen_at' => now()]);
    }

    public function test_sources_are_activated_together_with_a_result_each_and_one_deployment(): void
    {
        $adapter = $this->adapter();
        $first = $this->source('WM-2001');
        $second = $this->source('WM-2002');
        $silent = $this->source('WM-2003', born: false);
        $url = $this->in($this->a).'/device-adapters/'.$adapter->uuid.'/candidates';
        $this->deploys = [];

        $batch = $this->postJson("{$url}/activate", ['sources' => [
            ['candidate_uuid' => $first->uuid, 'name' => 'Meter one'],
            ['candidate_uuid' => $second->uuid],
            ['candidate_uuid' => $silent->uuid],
        ]])->assertAccepted()->assertJsonPath('data.total', 3)->json('data.uuid');

        $result = $this->getJson("{$url}/activations/{$batch}")->assertOk()->json('data');
        $this->assertSame('done', $result['status']);
        $outcomes = collect($result['results'])->keyBy('candidate_uuid');
        $this->assertSame(['activated', 'activated', 'failed'], [$outcomes[$first->uuid]['outcome'], $outcomes[$second->uuid]['outcome'], $outcomes[$silent->uuid]['outcome']]);
        $this->assertSame('Meter one', $outcomes[$first->uuid]['device']['name']);
        // Unnamed, a source takes its name from the candidate list.
        $this->assertSame('WM-2002', $outcomes[$second->uuid]['device']['name']);
        $this->assertSame('Wait for a live Sparkplug birth message. Retained previews cannot activate a device.', $outcomes[$silent->uuid]['message']);
        $this->assertCount(1, $this->deploys);
        $this->assertEqualsCanonicalizing(DeviceInstallation::whereIn('device_adapter_candidate_id', [$first->id, $second->id])->pluck('uuid')->all(), array_column($this->deploys[0]['bindings'], 'installation_uuid'));

        // Again: already active, and nothing to deploy.
        $again = $this->postJson("{$url}/activate", ['sources' => [['candidate_uuid' => $first->uuid]]])->assertAccepted()->json('data.uuid');
        $this->assertSame('already_active', $this->getJson("{$url}/activations/{$again}")->json('data.results.0.outcome'));
        $this->assertCount(1, $this->deploys);
    }

    public function test_a_batch_is_bounded_and_seen_only_by_who_started_it(): void
    {
        $adapter = $this->adapter();
        $url = $this->in($this->a).'/device-adapters/'.$adapter->uuid.'/candidates';
        $this->postJson("{$url}/activate", ['sources' => array_map(fn () => ['candidate_uuid' => (string) Str::uuid()], range(1, 201))])->assertUnprocessable()->assertJsonValidationErrors('sources');
        $uuid = (string) Str::uuid();
        $this->postJson("{$url}/activate", ['sources' => [['candidate_uuid' => $uuid], ['candidate_uuid' => $uuid]]])->assertUnprocessable()->assertJsonValidationErrors('sources.1.candidate_uuid');
        $batch = $this->postJson("{$url}/activate", ['sources' => [['candidate_uuid' => $this->source('WM-2004')->uuid]]])->assertAccepted()->json('data.uuid');
        $this->as($this->aOnly, fn () => $this->getJson("{$url}/activations/{$batch}")->assertNotFound());
        $this->getJson("{$url}/activations/".Str::uuid())->assertNotFound();
    }
}
