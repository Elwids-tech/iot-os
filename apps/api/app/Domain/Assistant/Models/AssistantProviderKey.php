<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * An AI provider API key saved in admin. Stored encrypted with the application key and never returned by the API.
 */
final class AssistantProviderKey extends Model
{
    protected $guarded = [];

    protected $hidden = ['api_key'];

    protected function casts(): array
    {
        return ['api_key' => 'encrypted'];
    }
}
