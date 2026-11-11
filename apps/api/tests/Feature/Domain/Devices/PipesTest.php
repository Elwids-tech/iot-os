<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Services\Pipes;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Tests\Feature\Domain\Devices\Moves\MoveTestCase;

/**
 * The one rule for the hosted-device crossing (spec 031, research R2): a device may name
 * its own organization's sources, or the source it already holds while that source's
 * organization shares its billing account. Anything else is 404.
 */
final class PipesTest extends MoveTestCase
{
    public function test_own_sources_and_the_held_source_in_the_account_are_accepted(): void
    {
        $pipes = app(Pipes::class);
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $own = $this->unsourced('Spare meter');
        $this->assertSame($x->candidate->id, $pipes->allowsSource($own, $x->candidate->uuid)->id);

        $this->moved($this->a, $this->b, [$x]);
        $inB = $this->successor($x);
        $this->assertSame($x->device_discovery_candidate_id, $pipes->allowsSource($inB, $inB->candidate->uuid)->id);
    }

    public function test_a_foreign_source_not_held_and_a_held_source_after_its_organization_left_the_account_are_refused(): void
    {
        $pipes = app(Pipes::class);
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $y = $this->adapterFed('WM-1002', 'Tracker Y');
        $this->moved($this->a, $this->b, [$x]);
        $inB = $this->successor($x);

        $this->assertRefused(fn () => $pipes->allowsSource($inB, $y->candidate->uuid));
        $this->assertRefused(fn () => $pipes->allowsSource($this->unsourced('B meter', $this->b), $inB->candidate->uuid));
        $this->assertRefused(fn () => $pipes->allowsSource($inB, (string) Str::uuid()));

        $this->a->forceFill(['billing_account_id' => $this->c->billing_account_id])->save();
        $this->assertRefused(fn () => $pipes->allowsSource($inB->fresh(), $inB->candidate->uuid));
    }

    public function test_the_pipe_of_adapter_fed_gateway_and_direct_devices(): void
    {
        $pipes = app(Pipes::class);
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $this->assertSame(['kind' => 'adapter', 'name' => 'Vendor meters', 'owner_organization_name' => 'Integrator', 'online' => true, 'hosted' => false], $pipes->for($x)->toArray());

        $plant = SparkplugConnection::create(['organization_id' => $this->a->id, 'name' => 'Plant', 'group_id' => 'plant', 'host_id' => 'plant-host', 'username' => 'plant', 'password' => 'test-secret', 'status' => 'ready']);
        $line = SparkplugGateway::create(['organization_id' => $this->a->id, 'sparkplug_connection_id' => $plant->id, 'name' => 'Line gateway', 'edge_node_id' => 'line', 'presence' => 'online', 'runtime_seen_at' => now()]);
        $this->assertSame(['kind' => 'gateway', 'name' => 'Line gateway', 'owner_organization_name' => 'Integrator', 'online' => true, 'hosted' => false], $pipes->for($this->holding('Line meter', $line, 'meter-1'))->toArray());

        $onboarding = SparkplugConnection::create(['organization_id' => $this->a->id, 'name' => 'Direct device connections', 'group_id' => 'onboarding-'.$this->a->uuid, 'host_id' => 'iot-onboarding', 'username' => 'direct', 'password' => 'test-secret', 'status' => 'ready']);
        $own = SparkplugGateway::create(['organization_id' => $this->a->id, 'sparkplug_connection_id' => $onboarding->id, 'name' => 'Direct meter', 'edge_node_id' => 'device-'.Str::uuid()]);
        $this->assertNull($pipes->for($this->holding('Direct meter', $own, '')));
        $this->assertNull($pipes->for($this->unsourced('Spare meter')));

        $this->moved($this->a, $this->b, [$x]);
        $inB = $this->successor($x);
        $this->assertTrue($pipes->for($inB)->hosted);
        $this->assertSame([$inB->id], $pipes->hostedIn($this->b)->pluck('id')->all());
        $this->assertSame([['organization_id' => $this->b->id, 'organization_name' => 'Harbour Shop', 'devices' => [$inB->id]]],
            array_map(fn (array $group) => [...$group, 'devices' => $group['devices']->pluck('id')->all()], $pipes->servedBy($this->a)));
        $this->assertSame([], $pipes->servedBy($this->b));
        $this->assertCount(0, $pipes->hostedIn($this->a));
    }

    private function holding(string $name, SparkplugGateway $gateway, string $source): Device
    {
        $candidate = DiscoveryCandidate::create(['organization_id' => $gateway->organization_id, 'sparkplug_gateway_id' => $gateway->id, 'source_device_id' => $source, 'birth_revision' => 1, 'metrics' => []]);
        $device = $this->unsourced($name, Organization::findOrFail($gateway->organization_id));
        $device->forceFill(['device_discovery_candidate_id' => $candidate->id, 'reserved_source_uuid' => $candidate->uuid])->save();

        return $device->fresh();
    }

    private function assertRefused(callable $check): void
    {
        try {
            $check();
            $this->fail('The source was accepted.');
        } catch (NotFoundHttpException|ModelNotFoundException) {
            $this->addToAssertionCount(1);
        }
    }
}
