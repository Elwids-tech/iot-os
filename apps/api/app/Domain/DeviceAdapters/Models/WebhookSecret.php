<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Models;

use App\Domain\Devices\Models\DeviceModel;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Builder;

/** A secret that proves a webhook delivery comes from the customer's vendor account. */
final class WebhookSecret extends DeviceModel
{
    protected $table = 'device_adapter_webhook_secrets';

    protected $hidden = ['secret'];

    protected function casts(): array
    {
        return ['secret' => 'encrypted', 'last_used_at' => 'datetime', 'expires_at' => 'datetime', 'revoked_at' => 'datetime'];
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->whereNull('revoked_at')->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()));
    }

    public function active(): bool
    {
        return $this->revoked_at === null && ($this->expires_at === null || $this->expires_at->isFuture());
    }

    public function view(): array
    {
        return [...$this->only(['uuid', 'label', 'origin']), 'created_at' => $this->created_at?->toIso8601String(), 'created_by' => $this->creator ? ['user_id' => $this->creator->id, 'name' => $this->creator->name] : null,
            'last_used_at' => $this->last_used_at?->toIso8601String(), 'expires_at' => $this->expires_at?->toIso8601String(), 'revoked_at' => $this->revoked_at?->toIso8601String(), 'active' => $this->active()];
    }
}
