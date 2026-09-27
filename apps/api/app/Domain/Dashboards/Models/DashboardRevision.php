<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Models;

use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class DashboardRevision extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['widgets' => 'array', 'layouts' => 'array', 'defaults' => 'array', 'tags' => 'array', 'revision' => 'integer'];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
