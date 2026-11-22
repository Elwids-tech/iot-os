<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Automation\Services\DeploymentGraph;
use Illuminate\Support\Str;
use Tests\TestCase;

final class DeploymentGraphTest extends TestCase
{
    public function test_a_dag_snapshot_reads_the_devices_its_sources_name_and_not_the_one_it_commands(): void
    {
        $graph = json_decode(file_get_contents(base_path('../../contracts/rules/v2/workflow.fixture.json')), true);
        $devices = array_column($graph['bindings'], 'device_uuid', 'role');

        $this->assertSame([$devices['temperature'], $devices['pressure']], DeploymentGraph::of($graph)->readDeviceUuids());
    }

    public function test_the_commanded_device_is_not_read_even_as_the_first_binding(): void
    {
        [$pump, $sensor] = [(string) Str::uuid(), (string) Str::uuid()];
        $graph = ['bindings' => [['role' => 'pump', 'device_uuid' => $pump], ['role' => 'level', 'device_uuid' => $sensor]],
            'nodes' => [['id' => 'level', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'level']], ['id' => 'stop', 'type' => 'action.command.v1', 'config' => ['binding' => 'pump']]]];

        $this->assertSame([$sensor], DeploymentGraph::of($graph)->readDeviceUuids());
    }

    public function test_two_sources_on_one_device_read_it_once(): void
    {
        $device = (string) Str::uuid();
        $graph = ['bindings' => [['role' => 'a', 'device_uuid' => $device], ['role' => 'b', 'device_uuid' => $device]],
            'nodes' => [['id' => 'a', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'a']], ['id' => 'b', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'b']]]];

        $this->assertSame([$device], DeploymentGraph::of($graph)->readDeviceUuids());
    }

    public function test_a_geofence_rule_reads_its_one_device(): void
    {
        $device = (string) Str::uuid();

        $this->assertSame([$device], DeploymentGraph::of(['binding' => ['device_uuid' => $device]])->readDeviceUuids());
    }

    public function test_a_snapshot_without_sources_reads_its_first_binding(): void
    {
        [$first, $second] = [(string) Str::uuid(), (string) Str::uuid()];

        $this->assertSame([$first], DeploymentGraph::of(['bindings' => [['role' => 'a', 'device_uuid' => $first], ['role' => 'b', 'device_uuid' => $second]]])->readDeviceUuids());
    }

    public function test_an_empty_or_malformed_snapshot_reads_nothing(): void
    {
        $this->assertSame([], DeploymentGraph::of(null)->readDeviceUuids());
        $this->assertSame([], DeploymentGraph::of([])->readDeviceUuids());
        $this->assertSame([], DeploymentGraph::of(['binding' => ['device_uuid' => 'tractor-7']])->readDeviceUuids());
        $this->assertSame([], DeploymentGraph::of(['bindings' => 'none', 'nodes' => [['type' => 'source.parameter.v1']]])->readDeviceUuids());
    }
}
