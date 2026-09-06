<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Devices\Services\RetentionService;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

final class RetentionController
{
    public function show(RetentionService $service, ?Organization $organization = null): array
    {
        return ['data' => $service->inspection($organization)];
    }

    public function update(Request $request, RetentionService $service, ?Organization $organization = null): array
    {
        $values = $request->validate(['days' => ['present', 'nullable', 'integer', 'min:1', 'max:36500'], 'revision' => ['required', 'integer', 'min:0'], 'confirmed_reduction' => ['sometimes', 'boolean']]);
        $service->update($organization, $values['days'], $values['revision'], $values['confirmed_reduction'] ?? false, $request->user()->id);

        return ['data' => $service->inspection($organization)];
    }
}
