<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Models;

use App\Domain\Authorization\Models\Role;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A dashboard shared with one role or one member, to view or to edit. */
final class DashboardShare extends Model
{
    protected $guarded = [];

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
