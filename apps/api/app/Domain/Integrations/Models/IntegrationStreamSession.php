<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Models;

use App\Domain\Integrations\Services\StreamSessions;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One application telemetry stream (spec 030, research R5). Open while `closed_at` is
 * null and `last_seen_at` is within the open window; a stream a crashed worker never
 * closed frees its slot when the window passes.
 */
final class IntegrationStreamSession extends Model
{
    /** Close reasons: the five the client sees in `closed`, `client` when it left, `reset` when its position was gone. */
    public const REASONS = ['lifetime', 'grant_changed', 'credentials_changed', 'runtime_unavailable', 'shutdown', 'client', 'reset'];

    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['opened_at' => 'immutable_datetime', 'last_seen_at' => 'immutable_datetime', 'closed_at' => 'immutable_datetime', 'device_count' => 'integer'];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(IntegrationApplication::class, 'integration_application_id');
    }

    /** Streams that count against the limits and that operators see as open. */
    public function scopeOpen(Builder $query): Builder
    {
        return $query->whereNull('closed_at')->where('last_seen_at', '>', now()->subSeconds(StreamSessions::OPEN_WINDOW_SECONDS));
    }
}
