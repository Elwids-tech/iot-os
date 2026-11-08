<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Http\Requests\TaxRateRequest;
use App\Domain\Billing\Http\Resources\TaxRateResource;
use App\Domain\Billing\Models\TaxRate;
use App\Domain\Billing\Services\TaxRates;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * Named tax rates (spec 029 FR-029): current ones first, then archived, by name.
 */
final class PlatformTaxRateController
{
    public function __construct(private readonly TaxRates $rates) {}

    public function index(): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return TaxRateResource::collection(TaxRate::query()->orderByRaw('archived_at is not null')->orderBy('name')->get());
    }

    public function store(TaxRateRequest $request): JsonResponse
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $rate = $this->rates->create((string) $request->validated('name'), (int) $request->validated('basis_points'), $request->user());

        return (new TaxRateResource($rate))->response()->setStatusCode(201);
    }

    public function update(TaxRateRequest $request, TaxRate $taxRate): TaxRateResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return new TaxRateResource($this->rates->update($taxRate, $request->validated(), $request->user()));
    }

    public function archive(Request $request, TaxRate $taxRate): TaxRateResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return new TaxRateResource($this->rates->archive($taxRate, $request->user()));
    }
}
