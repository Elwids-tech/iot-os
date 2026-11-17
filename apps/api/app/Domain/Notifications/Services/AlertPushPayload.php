<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Services;

use App\Domain\Automation\Models\Alert;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonInterface;
use Illuminate\Support\Str;

/**
 * Builds `alert-push.v1` bodies and their push service headers
 * (contracts/push/v1/alert-push.v1.schema.json, spec 033 FR-021 to FR-024). Names and
 * times only: never readings, comments or anyone's details.
 */
final class AlertPushPayload
{
    /** A push the phone has not received within a day is dropped (FR-026). */
    public const TTL = 86400;

    private const NAME = 120;

    /** @return array<string, mixed> */
    public static function transition(Alert $alert, Organization $organization, string $type, ?string $deviceName): array
    {
        $occurred = $type === 'cleared' ? $alert->cleared_at : $alert->activated_at;

        return [
            'v' => 1,
            'kind' => $type === 'cleared' ? 'cleared' : 'activated',
            'organization' => self::organization($organization),
            'alert' => [
                'uuid' => (string) $alert->uuid,
                'severity' => in_array($alert->severity, ['critical', 'warning', 'info'], true) ? $alert->severity : 'warning',
                'automation' => self::name((string) ($alert->workflow?->name ?? 'Alert')),
                'device' => $deviceName === null || $deviceName === '' ? null : self::name($deviceName),
            ],
            'occurred_at' => self::time($occurred ?? now()),
            'count' => null,
            'url' => '/organizations/'.$organization->uuid.'/alerts/'.$alert->uuid,
        ];
    }

    /** @return array<string, mixed> */
    public static function summary(Organization $organization, int $count, CarbonInterface $occurredAt): array
    {
        return [
            'v' => 1,
            'kind' => 'summary',
            'organization' => self::organization($organization),
            'alert' => null,
            'occurred_at' => self::time($occurredAt),
            'count' => max(1, $count),
            'url' => '/organizations/'.$organization->uuid.'/alerts?condition=active&acknowledged=0',
        ];
    }

    /** @return array<string, mixed> */
    public static function test(CarbonInterface $at): array
    {
        return [
            'v' => 1,
            'kind' => 'test',
            'organization' => null,
            'alert' => null,
            'occurred_at' => self::time($at),
            'count' => null,
            'url' => '/settings/my-notifications',
        ];
    }

    /**
     * Push service headers: a day to deliver, activations first, and one Topic per alert
     * (or per organization for summaries) so an undelivered push is replaced, not stacked.
     *
     * @param  array<string, mixed>  $payload
     * @return array{TTL: int, urgency: string, topic?: string}
     */
    public static function options(array $payload): array
    {
        $options = ['TTL' => self::TTL, 'urgency' => $payload['kind'] === 'activated' ? 'high' : 'normal'];
        $topic = match ($payload['kind']) {
            'activated', 'cleared' => $payload['alert']['uuid'],
            'summary' => $payload['organization']['uuid'],
            default => null,
        };
        if ($topic !== null) {
            $options['topic'] = str_replace('-', '', $topic);
        }

        return $options;
    }

    /** @return array{uuid: string, name: string} */
    private static function organization(Organization $organization): array
    {
        return ['uuid' => (string) $organization->uuid, 'name' => self::name((string) $organization->name)];
    }

    private static function name(string $name): string
    {
        return Str::limit($name, self::NAME, '');
    }

    private static function time(CarbonInterface|string $time): string
    {
        return ($time instanceof CarbonInterface ? $time : now()->parse($time))->utc()->toIso8601ZuluString();
    }
}
