<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;
use LogicException;

final class DeviceProfile extends Model
{
    use HasFactory, SoftDeletes;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'status' => DeviceProfileStatus::class,
            'extensions' => 'array',
            'published_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        self::creating(function (self $profile): void {
            $profile->uuid ??= (string) Str::uuid();
            $profile->status ??= DeviceProfileStatus::DRAFT;
            $profile->revision ??= 0;
            $profile->draft_revision ??= 1;
        });

        self::deleting(function (self $profile): void {
            if ($profile->artifacts()->exists() || $profile->transportBindings()->exists()) {
                throw new LogicException('A profile with published artifacts or transport bindings cannot be deleted.');
            }
        });
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function parameterGroups(): HasMany
    {
        return $this->hasMany(ProfileParameterGroup::class);
    }

    public function parameters(): HasMany
    {
        return $this->hasMany(ProfileParameter::class);
    }

    public function calculations(): HasMany
    {
        return $this->hasMany(ProfileCalculation::class);
    }

    public function alarmTemplates(): HasMany
    {
        return $this->hasMany(ProfileAlarmTemplate::class);
    }

    public function artifacts(): HasMany
    {
        return $this->hasMany(DeviceProfileArtifact::class);
    }

    public function activeArtifact(): HasOne
    {
        return $this->hasOne(DeviceProfileArtifact::class)->where('status', 'active');
    }

    public function transportBindings(): HasMany
    {
        return $this->hasMany(TransportBinding::class);
    }

    public function beginDraft(User $actor): void
    {
        if ($this->status === DeviceProfileStatus::ARCHIVED) {
            throw new LogicException('Archived profiles cannot be edited.');
        }

        if ($this->status === DeviceProfileStatus::PUBLISHED) {
            $this->status = DeviceProfileStatus::DRAFT;
        }

        $this->draft_revision++;
        $this->updated_by = $actor->getKey();
    }
}
