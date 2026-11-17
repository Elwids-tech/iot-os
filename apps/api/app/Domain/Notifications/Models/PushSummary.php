<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Models;

use App\Domain\Automation\Models\AlertDelivery;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * One summary push for a burst (spec 033, FR-024): after three pushes to one person
 * from one organization within 60 s, the further activations join an open summary
 * instead of each sending. Deliveries link to it with `push_summary_id`.
 *
 * @property int $id
 * @property string $uuid
 * @property int $user_id
 * @property int $organization_id
 * @property CarbonImmutable $window_started_at
 * @property CarbonImmutable $window_ends_at
 * @property int $alert_count
 * @property string $status
 * @property int $attempts
 * @property int $cycle_attempts
 * @property int|null $devices_total
 * @property int|null $devices_reached
 * @property CarbonImmutable|null $sent_at
 * @property string|null $diagnostic
 */
final class PushSummary extends Model
{
    public const WINDOW_SECONDS = 60;

    /** Individual pushes allowed per person and organization within a window. */
    public const BURST = 3;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'organization_id' => 'integer',
            'alert_count' => 'integer',
            'attempts' => 'integer',
            'cycle_attempts' => 'integer',
            'devices_total' => 'integer',
            'devices_reached' => 'integer',
            'window_started_at' => 'immutable_datetime',
            'window_ends_at' => 'immutable_datetime',
            'sent_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        self::creating(function (self $summary): void {
            $summary->uuid ??= (string) Str::uuid();
        });
    }

    public function deliveries(): HasMany
    {
        return $this->hasMany(AlertDelivery::class, 'push_summary_id');
    }
}
