<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

final class AssistantSource extends Model
{
    use HasUuids;

    protected $guarded = [];
}
