<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Http\Controllers;

use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Notifications\Services\Preferences;
use App\Domain\Notifications\Services\WebPush;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * A person's push settings (spec 033, FR-019, FR-020, contracts/push-api.md): personal,
 * across organizations, so no organization in the path.
 */
final class PushSettingsController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function show(Request $request): array
    {
        return ['data' => $this->view($request->user())];
    }

    public function update(Request $request): array
    {
        $input = $request->validate([
            'revision' => ['required', 'integer', 'min:0'],
            'enabled' => ['required', 'boolean'],
            'levels' => ['required', 'array:'.implode(',', Preferences::LEVELS)],
            'levels.*' => ['boolean'],
            ...collect(Preferences::LEVELS)->mapWithKeys(fn (string $level): array => ['levels.'.$level => ['required', 'boolean']])->all(),
        ]);
        $user = $request->user();
        DB::transaction(function () use ($user, $input): void {
            $row = Preferences::row($user);
            abort_unless((int) $row->push_revision === (int) $input['revision'], 409, 'Push settings changed. Reload them before saving.');
            DB::table('notification_preferences')->where('user_id', $user->id)->update([
                'push_enabled' => (bool) $input['enabled'],
                'push_levels' => json_encode(array_map('boolval', array_intersect_key($input['levels'], array_flip(Preferences::LEVELS)))),
                'push_revision' => $row->push_revision + 1,
                'updated_at' => now(),
            ]);
        });

        return ['data' => $this->view($user)];
    }

    public function organization(Request $request, Organization $organization): array
    {
        $user = $request->user();
        abort_unless($this->viewer($user, $organization), 404);
        $input = $request->validate(['enabled' => ['required', 'boolean']]);
        $key = ['user_id' => $user->id, 'organization_id' => $organization->id];
        if ($input['enabled']) {
            DB::table('push_organization_mutes')->where($key)->delete();
        } else {
            DB::table('push_organization_mutes')->insertOrIgnore([...$key, 'created_at' => now()]);
        }

        return ['data' => $this->view($user)];
    }

    /** @return array<string, mixed> */
    private function view(User $user): array
    {
        $push = Preferences::push($user);
        $muted = DB::table('push_organization_mutes')->where('user_id', $user->id)->pluck('organization_id')->flip();

        return [
            'available' => WebPush::enabled(),
            'public_key' => WebPush::publicKey(),
            'enabled' => $push['enabled'],
            'levels' => $push['levels'],
            'revision' => $push['revision'],
            'organizations' => $user->organizations()->orderBy('name')->get()
                ->filter(fn (Organization $org): bool => $this->authorization->capabilities($user, $org)['view'])
                ->map(fn (Organization $org): array => ['uuid' => $org->uuid, 'name' => $org->name, 'enabled' => ! $muted->has($org->id)])
                ->values()->all(),
            'devices' => PushDevice::query()->where('user_id', $user->id)->orderBy('created_at')->get()
                ->map(fn (PushDevice $device): array => $device->toListItem())->all(),
        ];
    }

    private function viewer(User $user, Organization $organization): bool
    {
        return $user->organizations()->whereKey($organization->id)->exists() && $this->authorization->capabilities($user, $organization)['view'];
    }
}
