<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * The platform's saved assistant settings (one row, scope_key "platform"). Null values fall back to the environment.
 */
final class AssistantSetting extends Model
{
    public const PLATFORM = 'platform';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['daily_budget_usd' => 'float', 'run_budget_usd' => 'float', 'revision' => 'integer'];
    }
}
