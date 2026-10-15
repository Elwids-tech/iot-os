<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Http\Controllers;

use App\Domain\Assistant\Http\Requests\TestAssistantConnectionRequest;
use App\Domain\Assistant\Http\Requests\UpdateAssistantSettingsRequest;
use App\Domain\Assistant\Http\Resources\AssistantSettingsResource;
use App\Domain\Assistant\Services\AssistantSettings;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super administrators choose the assistant's provider, model, keys and spend limits (spec 010).
 */
final class AssistantSettingsController
{
    public function show(Request $request, AssistantSettings $settings): AssistantSettingsResource
    {
        $this->authorize($request);

        return AssistantSettingsResource::make($settings->inspection());
    }

    public function update(UpdateAssistantSettingsRequest $request, AssistantSettings $settings): AssistantSettingsResource
    {
        /** @var User $actor */
        $actor = $request->user();
        $settings->update($actor, [
            'provider' => (string) $request->validated('provider'),
            'model' => (string) $request->validated('model'),
            'daily_budget_usd' => $request->validated('daily_budget_usd'),
            'run_budget_usd' => $request->validated('run_budget_usd'),
            'revision' => (int) $request->validated('revision'),
            'api_key' => $request->validated('api_key'),
        ]);

        return AssistantSettingsResource::make($settings->inspection());
    }

    public function destroyKey(Request $request, string $provider, AssistantSettings $settings): AssistantSettingsResource
    {
        $this->authorize($request);
        /** @var User $actor */
        $actor = $request->user();
        $settings->removeKey($actor, $provider);

        return AssistantSettingsResource::make($settings->inspection());
    }

    public function test(TestAssistantConnectionRequest $request, AssistantSettings $settings): JsonResponse
    {
        $result = $settings->test((string) $request->validated('provider'), (string) $request->validated('model'), $request->validated('api_key'));

        return response()->json(['data' => [
            'ok' => (bool) $result['ok'],
            'latency_ms' => $result['latency_ms'] === null ? null : (int) $result['latency_ms'],
            'error' => $result['error'] === null ? null : (string) $result['error'],
        ]]);
    }

    private function authorize(Request $request): void
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless($user->is_super_admin, 403);
    }
}
