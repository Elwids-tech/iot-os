<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Automation\Services\DeploymentGraph;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The alert limits read from each golden automation graph (spec 037, SC-002). The
 * runtime's evaluator is checked against the same file in
 * services/runtime/internal/dag/limits_fixture_test.go.
 */
final class AlertLimitsFixtureTest extends TestCase
{
    private const FIXTURE = __DIR__.'/../../../../../../contracts/rules/v2/alert-limits.fixture.json';

    /** @return iterable<string, array{array<string, mixed>, list<array<string, mixed>>}> */
    public static function cases(): iterable
    {
        foreach (json_decode(file_get_contents(self::FIXTURE), true, 512, JSON_THROW_ON_ERROR)['cases'] as $case) {
            yield $case['name'] => [$case['workflow'], $case['limits']];
        }
    }

    #[DataProvider('cases')]
    public function test_the_limits_of_a_graph_are_exactly_the_fixtures(array $workflow, array $limits): void
    {
        $this->assertSame(json_encode($limits, JSON_PRETTY_PRINT), json_encode(DeploymentGraph::of($workflow)->alertLimits(), JSON_PRETTY_PRINT));
    }

    public function test_a_snapshot_that_is_not_a_graph_has_no_limits(): void
    {
        $this->assertSame([], DeploymentGraph::of(null)->alertLimits());
        $this->assertSame([], DeploymentGraph::of(['binding' => ['device_uuid' => 'x']])->alertLimits());
        $this->assertSame([], DeploymentGraph::of(['nodes' => 'none', 'edges' => [[]], 'bindings' => [1]])->alertLimits());
    }

    public function test_a_loop_in_a_stored_graph_ends(): void
    {
        $graph = ['bindings' => [], 'nodes' => [['id' => 'a', 'type' => 'cooldown.v1', 'config' => []], ['id' => 'b', 'type' => 'cooldown.v1', 'config' => []], ['id' => 'alert', 'type' => 'action.alert.v1', 'config' => []]],
            'edges' => [['source' => 'a', 'source_port' => 'out', 'target' => 'b', 'target_port' => 'in'], ['source' => 'b', 'source_port' => 'out', 'target' => 'a', 'target_port' => 'in'], ['source' => 'a', 'source_port' => 'out', 'target' => 'alert', 'target_port' => 'in']]];

        $this->assertSame([], DeploymentGraph::of($graph)->alertLimits());
    }
}
