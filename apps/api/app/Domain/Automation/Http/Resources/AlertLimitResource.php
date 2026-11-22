<?php

declare(strict_types=1);

namespace App\Domain\Automation\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One alert limit: a value on a device parameter at which an applied automation
 * raises or clears an alert (spec 037). Worked out from the applied deployment on
 * each request; never stored.
 */
final class AlertLimitResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @format uuid */
            'workflow_uuid' => (string) $this->resource['workflow_uuid'],
            'workflow_name' => (string) $this->resource['workflow_name'],
            /**
             * `suspended` when the applied deployment has stopped checking; such a limit is listed, never drawn.
             *
             * @var 'running'|'suspended'
             */
            'state' => $this->resource['state'],
            /** @format uuid */
            'device_uuid' => (string) $this->resource['device_uuid'],
            /** @format uuid */
            'parameter_uuid' => (string) $this->resource['parameter_uuid'],
            /**
             * Whether crossing the value raises the alert or clears it. `clear` comes only from a hysteresis condition.
             *
             * @var 'raise'|'clear'
             */
            'role' => $this->resource['role'],
            /**
             * The side of the value on which the alert is raised (for `clear`, on which it clears).
             *
             * @var 'gt'|'gte'|'lt'|'lte'|'eq'
             */
            'operator' => $this->resource['operator'],
            /**
             * In the parameter's own unit.
             *
             * @var int|float
             */
            'value' => $this->resource['value'],
            'unit' => (string) $this->resource['unit'],
            /**
             * The window treatment before the comparison; null when the reading is compared directly.
             *
             * @var 'average'|'min'|'max'|null
             */
            'aggregate' => $this->resource['aggregate'],
            /** @var int|null */
            'window_seconds' => $this->resource['window_seconds'],
            /**
             * How long the condition must hold before the alert is raised.
             *
             * @var int|null
             */
            'held_seconds' => $this->resource['held_seconds'],
            /** True when the alert also depends on another condition. */
            'combined' => (bool) $this->resource['combined'],
        ];
    }
}
