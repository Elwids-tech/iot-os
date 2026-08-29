<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceManagement\Http\Requests\DefinitionFixtureRequest;
use App\Domain\DeviceManagement\Http\Resources\DeviceDefinitionAssignmentResource;
use App\Domain\DeviceManagement\Models\DeviceDefinitionAssignment;
use App\Domain\DeviceManagement\Services\RuntimeBundleCompilationManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

final readonly class DeviceDefinitionCompilationController
{
    public function __construct(
        private RuntimeBundleCompilationManager $compilation,
        private TenantDeviceDomainLocator $locator,
    ) {}

    public function compile(DefinitionFixtureRequest $request, string $device): JsonResponse
    {
        $assignment = $this->assignment($request, $device);
        Gate::authorize('view', $assignment);

        return response()->json([
            'data' => $this->compilation->compile($assignment, $request->fixtures())->toArray(),
        ]);
    }

    public function pin(DefinitionFixtureRequest $request, string $device): JsonResponse
    {
        $assignment = $this->assignment($request, $device);
        Gate::authorize('update', $assignment);
        /** @var User $actor */
        $actor = $request->user();

        [$result, $pinned] = $this->compilation->compileAndPin(
            $assignment,
            $request->fixtures(),
            $request->expectedInputHash(),
            $request->header('If-Match'),
            $actor,
        );

        if (! $result->valid) {
            return response()->json([
                'message' => 'Runtime Bundle compilation failed. Review the diagnostics before pinning.',
                'data' => $result->toArray(),
            ], 422);
        }

        $pinned->loadMissing(['device', 'profileVersion', 'bindingVersion', 'gatewayRoute']);

        return response()->json([
            'data' => [
                'assignment' => DeviceDefinitionAssignmentResource::make($pinned)->resolve($request),
                'compile' => $result->toArray(),
            ],
        ])->withHeaders(['ETag' => $pinned->etag()]);
    }

    private function assignment(DefinitionFixtureRequest $request, string $device): DeviceDefinitionAssignment
    {
        $model = $this->locator->device(CurrentOrganization::from($request), $device);

        return $model->definitionAssignment()
            ->with(['device', 'profileVersion', 'bindingVersion', 'gatewayRoute'])
            ->firstOrFail();
    }
}
