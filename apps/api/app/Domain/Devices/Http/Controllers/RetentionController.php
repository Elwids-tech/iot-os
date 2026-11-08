<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Devices\Http\Resources\RetentionOrganizationResource;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

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

    /**
     * Organizations to choose an override for.
     *
     * Searches name and slug and returns only each organization's uuid and name, so an
     * administrator who may manage retention but not organizations can still choose one.
     */
    public function organizations(Request $request): AnonymousResourceCollection
    {
        $search = trim((string) $request->query('search', ''));

        return RetentionOrganizationResource::collection(Organization::query()
            ->when($search !== '', fn ($query) => $query->where(fn ($query) => $query->whereLike('name', "%{$search}%")->orWhereLike('slug', "%{$search}%")))
            ->orderBy('name')
            ->orderBy('id')
            ->paginate(min(max((int) $request->query('per_page', 25), 1), 100), ['id', 'uuid', 'name'])
            ->withQueryString());
    }
}
