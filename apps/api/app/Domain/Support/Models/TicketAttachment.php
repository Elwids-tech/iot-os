<?php

declare(strict_types=1);

namespace App\Domain\Support\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/** An image or PDF on a message, stored on the private local disk. */
final class TicketAttachment extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'support_ticket_attachments';

    protected $guarded = [];

    protected static function booted(): void
    {
        self::creating(static function (self $attachment): void {
            $attachment->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return ['size' => 'integer', 'created_at' => 'datetime'];
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(TicketMessage::class, 'message_id');
    }
}
