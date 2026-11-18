<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Http\Controllers;

use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Notifications\Services\WebPush;
use App\Domain\Shared\Models\User;
use App\Domain\SignUp\Http\Requests\UpdateSignUpSettingsRequest;
use App\Domain\SignUp\Models\SignUp;
use App\Domain\SignUp\Services\SignUpSettings;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super administrators open and close sign-up and choose how they hear about it
 * (spec 035 US4, FR-024 to FR-027). Platform administrators get 403.
 */
final class SignUpSettingsController
{
    public function show(Request $request, SignUpSettings $settings): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        abort_unless($user->is_super_admin, 403);

        return $this->respond($user, $settings->get());
    }

    public function update(UpdateSignUpSettingsRequest $request, SignUpSettings $settings): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $values = $request->safe()->only(SignUpSettings::FIELDS);
        foreach (['open', 'free_beta', 'notify_push', 'notify_email'] as $flag) {
            $values[$flag] = (bool) $values[$flag];
        }
        $values['daily_limit'] = (int) $values['daily_limit'];

        return $this->respond($user, $settings->update($values, (int) $request->validated('revision'), $user));
    }

    /**
     * Each channel says whether it can work on this deployment, and the caller sees how
     * many push devices they have (FR-024, FR-029).
     *
     * @param  array{open: bool, free_beta: bool, notify_push: bool, notify_email: bool, daily_limit: int, revision: int, updated_at: ?string, updated_by: ?int}  $current
     */
    private function respond(User $user, array $current): JsonResponse
    {
        $updatedBy = $current['updated_by'] === null ? null : User::query()->find($current['updated_by']);
        $started = SignUp::query()
            ->whereIn('state', [SignUp::WAITING, SignUp::COMPLETED])
            ->where('created_at', '>=', CarbonImmutable::now('UTC')->startOfDay())
            ->count();

        return response()->json(['data' => [
            'open' => $current['open'],
            'free_beta' => $current['free_beta'],
            'notify_push' => $current['notify_push'],
            'notify_email' => $current['notify_email'],
            'daily_limit' => $current['daily_limit'],
            'revision' => $current['revision'],
            'updated_at' => $current['updated_at'] === null ? null : CarbonImmutable::parse($current['updated_at'])->toIso8601ZuluString(),
            'updated_by' => $updatedBy === null ? null : ['user_id' => (int) $updatedBy->getKey(), 'name' => (string) $updatedBy->name],
            'push_available' => WebPush::enabled(),
            'mail_available' => ! in_array((string) config('mail.default'), ['log', 'array'], true),
            'my_push_devices' => PushDevice::query()->where('user_id', $user->getKey())->count(),
            'today' => ['started' => $started, 'limit' => $current['daily_limit']],
        ]]);
    }
}
