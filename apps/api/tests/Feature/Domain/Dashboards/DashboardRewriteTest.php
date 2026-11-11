<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Dashboards;

use App\Domain\Dashboards\Services\DashboardRewrite;
use Tests\TestCase;

/**
 * Rewriting a dashboard's panels onto moved devices (spec 031, research R11), for every
 * panel type: sources, device health devices and GPS map devices follow the maps, a
 * geofence or workflow stays only when mapped, and what doesn't come along is reported.
 */
final class DashboardRewriteTest extends TestCase
{
    private const X = '11111111-1111-4111-8111-111111111111';

    private const Y = '22222222-2222-4222-8222-222222222222';

    private const X2 = 'aaaaaaaa-1111-4111-8111-111111111111';

    private const P = '33333333-3333-4333-8333-333333333333';

    private const P2 = 'bbbbbbbb-3333-4333-8333-333333333333';

    private const Q = '44444444-4444-4444-8444-444444444444';

    private const W = '55555555-5555-4555-8555-555555555555';

    private const W2 = 'cccccccc-5555-4555-8555-555555555555';

    private const FENCE = '66666666-6666-4666-8666-666666666666';

    public function test_a_move_rewrites_every_panel_type_and_keeps_text(): void
    {
        $result = DashboardRewrite::rewrite($this->widgets(), $this->layouts(), [self::X => self::X2], [self::P => self::P2], [self::W => self::W2], false);

        $widgets = collect($result['widgets'])->keyBy('id');
        foreach (['status', 'timeseries', 'controls', 'state_history', 'color_history', 'gauge', 'table', 'consumption'] as $type) {
            $this->assertSame([['device_uuid' => self::X2, 'parameter_uuid' => self::P2, 'device_name' => 'Tracker X', 'label' => 'Flow']], $widgets[$type]['config']['sources'], $type);
        }
        $this->assertSame([['device_uuid' => self::X2, 'device_name' => 'Tracker X']], $widgets['device_health']['config']['devices']);
        $this->assertSame([self::X2], $widgets['location']['config']['location_device_uuids']);
        $this->assertArrayNotHasKey('geofence_uuid', $widgets['location']['config']);
        $this->assertSame(self::W2, $widgets['alerts']['config']['workflow_uuid']);
        $this->assertSame('Read me', $widgets['text']['config']['text']);
        $this->assertSame([], $result['omitted']['panels']);
        $this->assertSame([['panel' => 'Map', 'kind' => 'geofence', 'uuid' => self::FENCE]], $result['omitted']['references']);
        $this->assertSame(array_column($result['widgets'], 'id'), array_column($result['layouts']['lg'], 'i'));
    }

    public function test_a_copy_keeps_only_the_moving_devices_panels_and_sources(): void
    {
        $widgets = [
            ...$this->widgets(),
            $this->panel('mixed', 'timeseries', ['sources' => [$this->source(self::X, self::P), $this->source(self::Y, self::Q)]]),
            $this->panel('only-y', 'status', ['sources' => [$this->source(self::Y, self::Q)]]),
            $this->panel('fleet', 'device_health', ['sources' => [], 'devices' => [['device_uuid' => self::X, 'device_name' => 'Tracker X'], ['device_uuid' => self::Y, 'device_name' => 'Tracker Y']]]),
        ];
        $layouts = ['lg' => array_map(fn (array $widget, int $i): array => ['i' => $widget['id'], 'x' => 0, 'y' => $i, 'w' => 4, 'h' => 2], $widgets, array_keys($widgets))];

        $result = DashboardRewrite::rewrite($widgets, $layouts, [self::X => self::X2], [self::P => self::P2, self::Q => self::Q], [], true);

        $kept = collect($result['widgets'])->keyBy('id');
        $this->assertFalse($kept->has('text'), 'A text panel uses no moving device.');
        $this->assertFalse($kept->has('alerts'), 'Its workflow does not come along.');
        $this->assertFalse($kept->has('only-y'));
        $this->assertSame([self::X2], array_column($kept['mixed']['config']['sources'], 'device_uuid'));
        $this->assertSame([self::X2], array_column($kept['fleet']['config']['devices'], 'device_uuid'));
        $this->assertSame(['alerts', 'text', 'only-y'], array_column($result['omitted']['panels'], 'id'));
        $this->assertSame([self::Y], $result['omitted']['panels'][2]['devices']);
        $this->assertSame([['panel' => 'mixed', 'device_uuid' => self::Y], ['panel' => 'fleet', 'device_uuid' => self::Y]], $result['omitted']['sources']);
        $this->assertSame(array_column($result['widgets'], 'id'), array_column($result['layouts']['lg'], 'i'));
    }

    public function test_a_source_whose_parameter_is_not_mapped_is_dropped_and_a_panel_left_empty_is_omitted(): void
    {
        $result = DashboardRewrite::rewrite([$this->panel('stale', 'status', ['sources' => [$this->source(self::X, self::Q)]])], ['lg' => [['i' => 'stale', 'x' => 0, 'y' => 0, 'w' => 4, 'h' => 2]]], [self::X => self::X2], [self::P => self::P2], [], false);

        $this->assertSame([], $result['widgets']);
        $this->assertSame(['lg' => []], $result['layouts']);
        $this->assertSame([['id' => 'stale', 'title' => 'stale', 'devices' => [self::X]]], $result['omitted']['panels']);
    }

    public function test_devices_lists_every_device_a_dashboard_names_once(): void
    {
        $this->assertSame([self::X], DashboardRewrite::devices($this->widgets()));
    }

    /** @return list<array<string, mixed>> */
    private function widgets(): array
    {
        $widgets = [];
        foreach (['status', 'timeseries', 'controls', 'state_history', 'color_history', 'gauge', 'table', 'consumption'] as $type) {
            $widgets[] = $this->panel($type, $type, ['sources' => [$this->source(self::X, self::P)]]);
        }

        return [
            ...$widgets,
            $this->panel('device_health', 'device_health', ['sources' => [], 'devices' => [['device_uuid' => self::X, 'device_name' => 'Tracker X']]]),
            $this->panel('location', 'location', ['sources' => [], 'location_device_uuids' => [self::X], 'geofence_uuid' => self::FENCE], 'Map'),
            $this->panel('alerts', 'alerts', ['sources' => [], 'workflow_uuid' => self::W]),
            $this->panel('text', 'text', ['sources' => [], 'text' => 'Read me']),
        ];
    }

    /** @return array<string, list<array<string, mixed>>> */
    private function layouts(): array
    {
        return ['lg' => array_map(fn (array $widget, int $i): array => ['i' => $widget['id'], 'x' => 0, 'y' => $i * 2, 'w' => 6, 'h' => 2], $this->widgets(), array_keys($this->widgets()))];
    }

    /**
     * @param  array<string, mixed>  $config
     * @return array<string, mixed>
     */
    private function panel(string $id, string $type, array $config, ?string $title = null): array
    {
        return ['id' => $id, 'schema_version' => 2, 'type' => $type, 'title' => $title ?? $id, 'description' => '', 'config' => $config];
    }

    /** @return array<string, mixed> */
    private function source(string $device, string $parameter): array
    {
        return ['device_uuid' => $device, 'parameter_uuid' => $parameter, 'device_name' => $device === self::X ? 'Tracker X' : 'Tracker Y', 'label' => 'Flow'];
    }
}
