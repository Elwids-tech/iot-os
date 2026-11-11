<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Automation\Services\WorkflowRewrite;
use Tests\TestCase;

/**
 * Rewriting an automation onto moved devices (spec 031, research R11): each binding takes
 * the new device, configuration, generation and parameter; nodes keep their roles; the
 * identity changes; unmapped bindings and command nodes are reported.
 */
final class WorkflowRewriteTest extends TestCase
{
    private const X = '11111111-1111-4111-8111-111111111111';

    private const Y = '22222222-2222-4222-8222-222222222222';

    private const X2 = 'aaaaaaaa-1111-4111-8111-111111111111';

    private const P = '33333333-3333-4333-8333-333333333333';

    private const P2 = 'bbbbbbbb-3333-4333-8333-333333333333';

    private const C2 = 'dddddddd-1111-4111-8111-111111111111';

    public function test_bindings_follow_the_maps_and_nodes_keep_their_roles(): void
    {
        $graph = $this->graph([$this->binding('flow', self::X, self::P)]);
        $result = WorkflowRewrite::rewrite($graph, ['uuid' => 'new-uuid', 'organization_uuid' => 'target-org'], [self::X => ['device_uuid' => self::X2, 'configuration_uuid' => self::C2, 'generation' => 3]], [self::P => self::P2]);

        $this->assertSame('new-uuid', $result['workflow']['uuid']);
        $this->assertSame('target-org', $result['workflow']['organization_uuid']);
        $this->assertSame([['role' => 'flow', 'device_uuid' => self::X2, 'configuration_uuid' => self::C2, 'generation' => 3, 'parameter_uuid' => self::P2, 'data_type' => 'number', 'unit' => 'L/min', 'fresh_seconds' => 120]], $result['workflow']['bindings']);
        $this->assertSame($graph['nodes'], $result['workflow']['nodes']);
        $this->assertSame($graph['edges'], $result['workflow']['edges']);
        $this->assertSame([], $result['unmapped']);
        $this->assertFalse($result['commands']);
    }

    public function test_unmapped_bindings_are_reported_and_never_left_on_a_mapped_device(): void
    {
        $graph = $this->graph([$this->binding('flow', self::X, 'eeeeeeee-3333-4333-8333-333333333333'), $this->binding('other', self::Y, self::P)]);
        $result = WorkflowRewrite::rewrite($graph, [], [self::X => ['device_uuid' => self::X2, 'configuration_uuid' => self::C2, 'generation' => 3]], [self::P => self::P2]);

        $this->assertSame(['flow', 'other'], $result['unmapped']);
        $this->assertSame([self::X2, self::Y], array_column($result['workflow']['bindings'], 'device_uuid'));
        $this->assertSame(self::P, $result['workflow']['bindings'][1]['parameter_uuid']);
    }

    public function test_command_nodes_are_reported_and_devices_listed_once(): void
    {
        $graph = $this->graph([$this->binding('flow', self::X, self::P), $this->binding('valve', self::X, self::P)]);
        $graph['nodes'][] = ['id' => 'close', 'type' => WorkflowRewrite::COMMAND, 'config' => ['binding' => 'valve', 'value' => 0]];

        $this->assertTrue(WorkflowRewrite::rewrite($graph, [], [], [])['commands']);
        $this->assertSame([self::X], WorkflowRewrite::devices($graph));
    }

    /**
     * @param  list<array<string, mixed>>  $bindings
     * @return array<string, mixed>
     */
    private function graph(array $bindings): array
    {
        return ['schema_version' => 'automation-workflow.v2', 'uuid' => 'old-uuid', 'version_uuid' => 'v1', 'organization_uuid' => 'source-org', 'bindings' => $bindings,
            'nodes' => [['id' => 'source', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'flow']], ['id' => 'alert', 'type' => 'action.alert.v1', 'config' => ['title' => 'Low flow']]],
            'edges' => [['source' => 'source', 'source_port' => 'out', 'target' => 'alert', 'target_port' => 'in']]];
    }

    /** @return array<string, mixed> */
    private function binding(string $role, string $device, string $parameter): array
    {
        return ['role' => $role, 'device_uuid' => $device, 'configuration_uuid' => 'c1', 'generation' => 1, 'parameter_uuid' => $parameter, 'data_type' => 'number', 'unit' => 'L/min', 'fresh_seconds' => 120];
    }
}
