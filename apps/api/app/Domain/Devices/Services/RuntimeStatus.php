<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * Tenant-safe summary of the shared device runtime. Portals poll it to explain
 * partial outages once, instead of each page reporting its own failed request.
 * Broker and tenant details stay out because the runtime is shared.
 */
final class RuntimeStatus
{
    public function __construct(private readonly RuntimeClient $runtime) {}

    /**
     * @return array{state: string, live_data: string, automations: string, automation_fault: ?string, since: ?string, checked_at: string}
     */
    public function current(): array
    {
        return Cache::remember('devices.runtime-status', 10, function (): array {
            $checked = now()->toIso8601String();
            try {
                $status = $this->runtime->request('GET', '/internal/status');
            } catch (HttpExceptionInterface) {
                return ['state' => 'unavailable', 'live_data' => 'unavailable', 'automations' => 'unknown', 'automation_fault' => null, 'since' => null, 'checked_at' => $checked];
            }
            $workflows = (array) ($status['workflows'] ?? []);
            $fault = is_array($workflows['fault'] ?? null) ? $workflows['fault'] : null;
            $live = ($status['storage'] ?? null) === 'ok' && ($status['messaging'] ?? null) === 'ok' ? 'available' : 'unavailable';
            $automations = in_array($workflows['state'] ?? null, ['running', 'delayed', 'paused'], true) ? $workflows['state'] : 'unknown';
            $state = ($status['storage'] ?? null) !== 'ok' ? 'unavailable' : ($live === 'available' && $automations !== 'paused' ? 'operational' : 'degraded');

            return [
                'state' => $state,
                'live_data' => $live,
                'automations' => $automations,
                'automation_fault' => is_string($fault['code'] ?? null) ? $fault['code'] : null,
                'since' => is_string($fault['since'] ?? null) ? $fault['since'] : null,
                'checked_at' => $checked,
            ];
        });
    }

    /** Operator-only diagnostics, including the runtime's own fault message. */
    public function diagnostics(): array
    {
        return $this->runtime->request('GET', '/internal/status');
    }

    /** @return array{previous: array, current: array} */
    public function rebaselineWorkflowCheckpoint(string $reason): array
    {
        Cache::forget('devices.runtime-status');

        return $this->runtime->request('POST', '/internal/rules/checkpoint/rebaseline', ['reason' => $reason]);
    }
}
