<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Models;

use App\Domain\Automation\Models\Workflow;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

final class AssistantConversation extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected $attributes = ['scope' => 'profile'];

    protected function casts(): array
    {
        return ['onboarding_state' => 'array', 'sdk_pending_approvals' => 'array'];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function profile(): BelongsTo
    {
        return $this->belongsTo(DeviceProfile::class, 'device_profile_id');
    }

    public function adapter(): BelongsTo
    {
        return $this->belongsTo(DeviceAdapter::class, 'device_adapter_id');
    }

    public function runs(): HasMany
    {
        return $this->hasMany(AssistantRun::class, 'conversation_id');
    }

    public function workflow(): BelongsTo
    {
        return $this->belongsTo(Workflow::class, 'automation_workflow_id');
    }

    public function sources(): HasMany
    {
        return $this->hasMany(AssistantSource::class, 'conversation_id');
    }

    public function proposals(): HasMany
    {
        return $this->hasMany(AssistantProposal::class, 'conversation_id');
    }
}
