<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Services;

/**
 * The Add panel suggestion rules (apps/portal/src/dashboards/suggest.ts) on the server,
 * so the dashboard assistant offers what a person would be offered. Both read
 * contracts/dashboards/v1/panel-suggestions.fixture.json; change the rules, the fixture
 * and both tests together.
 *
 * A candidate is `{device: {uuid, name}, parameter: {uuid, label, kind, data_type, unit,
 * format, display, validation}, writable}`, where `writable` means mapped for commands in
 * the applied configuration.
 */
final class PanelSuggestions
{
    /** Default series colours, in order; the portal draws them through --series-1..6. */
    public const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];

    /** The base band of a new source; drawn as the muted text colour. */
    public const NEUTRAL = ['label' => 'Current', 'color' => '#64748b'];

    /** Fixed band colours for the semantic tones; the portal maps them back to the skin's tone colours. */
    public const TONES = ['good' => '#006133', 'info' => '#0056cf', 'warning' => '#844600', 'critical' => '#be1218'];

    /** Profile visualization hints and the panel each one asks for. */
    public const HINTS = [
        'stat' => 'status',
        'state' => 'status',
        'gauge' => 'gauge',
        'meter' => 'gauge',
        'timeseries' => 'timeseries',
        'consumption' => 'consumption',
        'state_timeline' => 'state_history',
        'table' => 'table',
        'color' => 'color_history',
        'control' => 'controls',
    ];

    /** Panel types that show device parameters, in gallery order. */
    public const PARAMETER_PANELS = ['status', 'gauge', 'timeseries', 'consumption', 'table', 'controls', 'state_history', 'color_history'];

    /** Panel types configured without device parameters. */
    public const OTHER_PANELS = ['device_health', 'location', 'alerts', 'text'];

    /**
     * Panel types for these parameters, best first. The profile's own hint wins for a single
     * parameter, then rules by data type, kind, unit and display range.
     *
     * @param  list<array{device: array{uuid: string, name: string}, parameter: array<string, mixed>, writable: bool}>  $candidates
     * @return list<array{type: string, reason: string}>
     */
    public function suggest(array $candidates): array
    {
        if ($candidates === []) {
            return [];
        }
        $parameters = array_column($candidates, 'parameter');
        $ranked = [];
        $add = function (string $type, string $reason) use (&$ranked, $candidates): void {
            if (! in_array($type, array_column($ranked, 'type'), true) && $this->incompatibility($type, $candidates) === null) {
                $ranked[] = ['type' => $type, 'reason' => $reason];
            }
        };
        $single = count($parameters) === 1 ? $parameters[0] : null;
        $hint = $single ? (self::HINTS[$this->visualizationHint($single) ?? ''] ?? null) : null;
        if ($hint) {
            $add($hint, 'Suggested by the device profile.');
        }
        if ($this->every($candidates, fn (array $candidate): bool => $candidate['writable'])) {
            $add('controls', $single ? 'Writable, so it can be changed from the dashboard.' : 'All writable, so they can be changed from the dashboard.');
        }
        if ($this->every($parameters, $this->isColour(...))) {
            $add('status', 'Shows the current colour.');
            $add('color_history', 'Shows colour changes over time.');
        } elseif ($this->every($parameters, $this->isState(...))) {
            $add('status', $single ? 'Shows the current state with its label.' : 'Shows each current state with its label.');
            $add('state_history', 'Shows time spent in each state.');
        } elseif ($this->every($parameters, $this->isNumeric(...))) {
            $ranges = array_map($this->displayRange(...), $parameters);
            $ranged = ! in_array(null, $ranges, true);
            $oneUnit = $this->unitCount($parameters) === 1;
            $counters = $this->every($parameters, $this->isCounter(...));
            // Running totals read best as usage per period, with meter resets handled.
            if ($counters) {
                $add('consumption', $single ? 'Usage per hour, day or month, with meter resets handled.' : 'Compares usage per period, with meter resets handled.');
            }
            if ($single) {
                if ($ranged && ! $counters) {
                    $unit = $single['unit'] ?? null;
                    $add('gauge', 'Profile range '.$this->number($ranges[0]['min']).'–'.$this->number($ranges[0]['max']).($unit ? ' '.$unit : '').'.');
                }
                $add('status', $counters ? 'Shows the running total now.' : 'Shows the current value and how fresh it is.');
                $add('timeseries', 'Follows the dashboard time range.');
            } else {
                if ($oneUnit) {
                    $add('timeseries', 'One unit, so a single chart compares them.');
                }
                $add('status', 'Shows each current value.');
                if ($ranged && $oneUnit && ! $counters) {
                    $add('gauge', 'Ranges come from the profile.');
                }
            }
        }
        $add('table', 'Lists every value in rows.');
        $add('status', 'Shows each current value.');

        return $ranked;
    }

    /**
     * Why a panel type cannot show these parameters, or null when it can.
     *
     * @param  list<array{device: array{uuid: string, name: string}, parameter: array<string, mixed>, writable: bool}>  $candidates
     */
    public function incompatibility(string $type, array $candidates): ?string
    {
        if (in_array($type, self::OTHER_PANELS, true)) {
            return 'Configured without device parameters.';
        }
        if ($candidates === []) {
            return null;
        }
        $parameters = array_column($candidates, 'parameter');

        return match ($type) {
            'gauge' => match (true) {
                ! $this->every($parameters, $this->isNumeric(...)) => 'Needs numeric parameters.',
                count($parameters) > 4 => 'Shows up to 4 parameters.',
                default => null,
            },
            'timeseries' => match (true) {
                ! $this->every($parameters, $this->isNumeric(...)) => 'Needs numeric parameters.',
                $this->unitCount($parameters) > 1 => 'Needs parameters with one unit.',
                default => null,
            },
            'consumption' => match (true) {
                ! $this->every($parameters, $this->isCounter(...)) => 'Needs counter parameters.',
                count($parameters) > 4 => 'Shows up to 4 counters.',
                $this->unitCount($parameters) > 1 => 'Needs parameters with one unit.',
                default => null,
            },
            'state_history' => $this->every($parameters, $this->isState(...)) ? null : 'Needs boolean or enum parameters.',
            'color_history' => $this->every($parameters, $this->isColour(...)) ? null : 'Needs colour parameters.',
            'controls' => $this->every($candidates, fn (array $candidate): bool => $candidate['writable']) ? null : 'Needs writable parameters.',
            default => null,
        };
    }

    /**
     * A dashboard source for a device parameter, as the panel editor builds it.
     *
     * @param  array{uuid: string, name: string}  $device
     * @param  array<string, mixed>  $parameter
     * @param  list<array{value: int|float, label: string, color: string}>  $thresholds
     * @return array<string, mixed>
     */
    public function source(array $device, array $parameter, int $index, array $thresholds = []): array
    {
        $widget = $parameter['display']['widget'] ?? null;

        return [
            'device_uuid' => $device['uuid'],
            'parameter_uuid' => $parameter['uuid'],
            'device_name' => $device['name'],
            'label' => $parameter['label'],
            'unit' => $parameter['unit'] ?? null,
            'data_type' => $parameter['data_type'],
            'format' => $parameter['format'] ?? null,
            'display_widget' => is_string($widget) ? $widget : null,
            'precision' => null,
            'color' => self::PALETTE[$index % count(self::PALETTE)],
            'base' => self::NEUTRAL,
            'thresholds' => $thresholds,
        ];
    }

    /**
     * The scale for gauges: the profile's display range, else its validation limits, else
     * 0–100 for percentages. Null when unknown.
     *
     * @param  array<string, mixed>  $parameter
     * @return array{min: int|float, max: int|float}|null
     */
    public function displayRange(array $parameter): ?array
    {
        $display = is_array($parameter['display'] ?? null) ? $parameter['display'] : [];
        $limits = $this->validationRange($parameter);
        $percent = ($parameter['unit'] ?? null) === '%';
        $min = $this->isNumber($display['min'] ?? null) ? $display['min'] : ($limits['min'] ?? ($percent ? 0 : null));
        $max = $this->isNumber($display['max'] ?? null) ? $display['max'] : ($limits['max'] ?? ($percent ? 100 : null));

        return $min !== null && $max !== null && $max > $min ? ['min' => $min, 'max' => $max] : null;
    }

    /**
     * The `>=` and `<=` limits on the value in the parameter's validation rule.
     *
     * @param  array<string, mixed>  $parameter
     * @return array{min?: int|float, max?: int|float}
     */
    private function validationRange(array $parameter): array
    {
        $rule = $parameter['validation']['rule'] ?? null;
        if (! is_array($rule)) {
            return [];
        }
        $conditions = is_array($rule['and'] ?? null) && array_is_list($rule['and']) ? $rule['and'] : [$rule];
        $range = [];
        foreach ($conditions as $condition) {
            if (! is_array($condition) || array_is_list($condition)) {
                continue;
            }
            foreach (['>=' => 'min', '<=' => 'max'] as $operator => $bound) {
                $operands = $condition[$operator] ?? null;
                if (is_array($operands) && array_is_list($operands) && count($operands) === 2 && is_array($operands[0]) && ! array_is_list($operands[0]) && ($operands[0]['var'] ?? null) === 'value' && $this->isNumber($operands[1]) && is_finite((float) $operands[1])) {
                    $range[$bound] = $operands[1];
                }
            }
        }

        return $range;
    }

    /** @param  array<string, mixed>  $parameter */
    private function visualizationHint(array $parameter): ?string
    {
        $hint = $parameter['display']['visualization'] ?? null;

        return is_string($hint) && $hint !== '' ? $hint : null;
    }

    /** @param  array<string, mixed>  $parameter */
    private function isNumeric(array $parameter): bool
    {
        return in_array($parameter['data_type'] ?? null, ['number', 'integer'], true);
    }

    /** @param  array<string, mixed>  $parameter */
    private function isState(array $parameter): bool
    {
        return in_array($parameter['data_type'] ?? null, ['boolean', 'enum'], true);
    }

    /** @param  array<string, mixed>  $parameter */
    private function isCounter(array $parameter): bool
    {
        return ($parameter['kind'] ?? null) === 'counter' && $this->isNumeric($parameter);
    }

    /** @param  array<string, mixed>  $parameter */
    private function isColour(array $parameter): bool
    {
        $widget = $parameter['display']['widget'] ?? '';

        return ($parameter['data_type'] ?? null) === 'string' && (($parameter['format'] ?? null) === 'hex_color' || (is_scalar($widget) ? (string) $widget : '') === 'color');
    }

    /** @param  list<array<string, mixed>>  $parameters */
    private function unitCount(array $parameters): int
    {
        return count(array_unique(array_map(fn (array $parameter): string => (string) ($parameter['unit'] ?? ''), $parameters)));
    }

    /**
     * @param  list<array<string, mixed>>  $items
     * @param  callable(array<string, mixed>): bool  $test
     */
    private function every(array $items, callable $test): bool
    {
        foreach ($items as $item) {
            if (! $test($item)) {
                return false;
            }
        }

        return true;
    }

    private function isNumber(mixed $value): bool
    {
        return is_int($value) || is_float($value);
    }

    /** A number as JavaScript prints it, so reasons match the portal's word for word. */
    private function number(int|float $value): string
    {
        if (is_float($value) && floor($value) === $value && abs($value) < 1e15) {
            return (string) (int) $value;
        }

        return is_float($value) ? var_export($value, true) : (string) $value;
    }
}
