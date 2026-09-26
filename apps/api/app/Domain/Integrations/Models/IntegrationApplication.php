<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Models;

use App\Domain\Devices\Models\DeviceModel;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Laravel\Sanctum\PersonalAccessToken;

// Deliberately no HasApiTokens: machine tokens cannot authenticate portal routes.
final class IntegrationApplication extends DeviceModel
{
    protected function casts(): array
    {
        return ['abilities' => 'array', 'device_uuids' => 'array', 'revision' => 'integer', 'grant_revision' => 'integer', 'revoked_at' => 'immutable_datetime'];
    }

    public function tokens(): MorphMany
    {
        return $this->morphMany(PersonalAccessToken::class, 'tokenable');
    }
}
