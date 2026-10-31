<?php

declare(strict_types=1);

namespace App\Domain\Automation\Models;

use App\Domain\Devices\Models\DeviceModel;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One message about one alert transition to one recipient on one channel. */
final class AlertDelivery extends DeviceModel
{
    public const EMAIL = 'email';

    protected $table = 'automation_alert_deliveries';

    protected $attributes = ['channel' => self::EMAIL];

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recipient_id');
    }
}
