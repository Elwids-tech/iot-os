<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Firmware\Services\TargetRegistry;
use Illuminate\Support\Facades\Validator;

/**
 * The assistant's firmware offer (spec 027 US5, FR-043, FR-052): a card the person presses
 * to download a credential-free starter with their own session. The model sees names only;
 * no settings, credentials or archive contents reach it or the stored conversation.
 */
final class FirmwareOffers
{
    public function __construct(
        private readonly DeviceProfileAuthorization $authorization,
        private readonly TargetRegistry $targets,
        private readonly AssistantEvents $events,
    ) {}

    public function offer(AssistantRun $run, array $args): array
    {
        $v = Validator::make($args, ['profile_uuid' => 'required|uuid', 'target' => 'required|string|max:40', 'role' => 'required|in:direct,gateway'])->validate();
        $conversation = $run->conversation;
        abort_unless($this->authorization->capabilities($conversation->user, $conversation->organization)['view'], 403, 'This person may not view device profiles, so no firmware can be offered.');
        $profile = DeviceProfile::where('organization_id', $conversation->organization_id)->where('uuid', $v['profile_uuid'])->first();
        abort_unless($profile !== null, 404, 'No device profile with that uuid exists here. Use the profile uuid exactly as find returned it.');
        $artifact = DeviceProfileArtifact::where('device_profile_id', $profile->id)->orderByDesc('revision')->first();
        abort_unless($artifact !== null, 422, "{$profile->name} has no published version, and starters are built from one. Ask the person to publish it first.");
        $target = $this->targets->find($v['target']);
        abort_unless($target !== null, 422, 'Unknown firmware target. Available targets: '.implode(', ', array_map(fn (array $item): string => $item['id'].' ('.$item['name'].')', $this->targets->available())).'.');
        abort_unless(in_array($v['role'], $target['roles'], true), 422, "{$target['name']} does not support the {$v['role']} role.");

        $offer = ['profile_uuid' => $profile->uuid, 'target' => $target['id'], 'role' => $v['role'], 'at' => now()->toIso8601String()];
        $conversation->update(['onboarding_state' => [...($conversation->fresh()->onboarding_state ?? []), 'firmware_offer' => $offer]]);
        $this->events->emit($conversation, $run, 'firmware_offer', $offer);

        return [
            'shown' => true,
            'profile' => ['name' => $profile->name, 'revision' => $artifact->revision],
            'target' => ['name' => $target['name'], 'kind' => $target['kind']],
            'note' => 'The person sees a card that downloads the starter with their own access. It holds no credentials: connection settings come from the device\'s or gateway\'s page.',
        ];
    }
}
