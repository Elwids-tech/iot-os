<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceProfile\Concurrency\CoordinatedDefinitionEntityTag;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Http\Requests\CoordinatedDefinitionDraftRequest;
use App\Domain\DeviceProfile\Http\Requests\FixtureSetRequest;
use App\Domain\DeviceProfile\Models\DefinitionTestRun;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\DeviceProfile\Services\DefinitionAuthoringManager;
use App\Domain\DeviceProfile\Services\DefinitionCompilerClient;
use App\Domain\DeviceProfile\Services\DefinitionDocumentAssembler;
use App\Domain\DeviceProfile\Services\DefinitionLifecycleManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

final class DefinitionDraftController
{
    public function __construct(
        private readonly DefinitionAuthoringManager $authoring,
        private readonly DefinitionCompilerClient $compiler,
        private readonly DefinitionDocumentAssembler $documents,
        private readonly DefinitionLifecycleManager $lifecycle,
        private readonly TenantDeviceDomainLocator $locator,
    ) {}

    public function store(CoordinatedDefinitionDraftRequest $request): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('create', [DeviceProfile::class, $organization]);
        Gate::authorize('create', [TransportBinding::class, $organization]);
        $validated = $request->validated();
        /** @var User $actor */
        $actor = $request->user();
        [$profileVersion, $bindingVersion] = $this->authoring->createCoordinatedDraft(
            $organization,
            DeviceProfileAuthoringData::fromArray($validated['profile']),
            NativeMqttBindingAuthoringData::fromArray($validated['binding']),
            $actor,
        );

        return $this->draftResponse($profileVersion, $bindingVersion, 201);
    }

    public function show(Request $request, string $bindingVersion): JsonResponse
    {
        [$profile, $binding] = $this->coordinatedVersions($request, $bindingVersion);
        Gate::authorize('view', $profile);
        Gate::authorize('view', $binding);

        return $this->draftResponse($profile, $binding);
    }

    public function update(CoordinatedDefinitionDraftRequest $request, string $bindingVersion): JsonResponse
    {
        [$profile, $binding] = $this->coordinatedVersions($request, $bindingVersion);
        Gate::authorize('update', $profile);
        Gate::authorize('update', $binding);
        CoordinatedDefinitionEntityTag::for($profile, $binding)->assertMatches($request->header('If-Match'));
        $validated = $request->validated();

        [$updatedProfile, $updatedBinding] = DB::transaction(function () use ($profile, $binding, $validated): array {
            $updatedProfile = $this->authoring->replaceProfileVersionDraft(
                $profile,
                DeviceProfileAuthoringData::fromArray($validated['profile']),
                $profile->etag(),
            );
            $updatedBinding = $this->authoring->replaceBindingVersionDraft(
                $binding,
                NativeMqttBindingAuthoringData::fromArray($validated['binding']),
                $binding->etag(),
            );

            return [$updatedProfile, $updatedBinding];
        });

        return $this->draftResponse($updatedProfile, $updatedBinding);
    }

    public function validate(FixtureSetRequest $request, string $bindingVersion): JsonResponse
    {
        [$profile, $binding] = $this->coordinatedVersions($request, $bindingVersion);
        Gate::authorize('update', $profile);
        Gate::authorize('update', $binding);
        $etag = CoordinatedDefinitionEntityTag::for($profile, $binding);
        $etag->assertMatches($request->header('If-Match'));
        $documents = $this->documents->coordinated($profile, $binding);
        /** @var list<array<string, mixed>> $fixtures */
        $fixtures = $request->validated('fixtures');
        $result = $this->compiler->compile(
            DeviceProfileAuthoringData::fromArray($documents['profile']),
            NativeMqttBindingAuthoringData::fromArray($documents['binding']),
            $fixtures,
        );
        /** @var User $actor */
        $actor = $request->user();
        $this->lifecycle->recordTestRun($profile, $binding, $result, $actor);

        return response()->json($result->toArray())->withHeaders(['ETag' => (string) $etag]);
    }

    public function publish(Request $request, string $bindingVersion): JsonResponse
    {
        [$profile, $binding] = $this->coordinatedVersions($request, $bindingVersion);
        Gate::authorize('publish', $profile);
        Gate::authorize('publish', $binding);
        CoordinatedDefinitionEntityTag::for($profile, $binding)->assertMatches($request->header('If-Match'));
        $testRun = DefinitionTestRun::query()
            ->where('device_profile_version_id', $profile->getKey())
            ->where('transport_binding_version_id', $binding->getKey())
            ->where('profile_revision', $profile->revision)
            ->where('binding_revision', $binding->revision)
            ->where('valid', true)
            ->latest('completed_at')
            ->first();
        if ($testRun === null) {
            throw new DomainInvariantViolation('Publication requires a valid test run for the current draft revisions.');
        }

        $this->lifecycle->publish($profile, $binding, $testRun, $profile->etag(), $binding->etag());

        return $this->draftResponse($profile->refresh(), $binding->refresh());
    }

    /** @return array{DeviceProfileVersion, TransportBindingVersion} */
    private function coordinatedVersions(Request $request, string $bindingVersion): array
    {
        $organization = CurrentOrganization::from($request);
        $binding = $this->locator->bindingVersion($organization, $bindingVersion)
            ->load(['binding.profile', 'profileVersion.profile']);
        $profile = $binding->profileVersion;
        if (
            $profile->organization_id !== $binding->organization_id
            || $binding->binding->device_profile_id !== $profile->device_profile_id
        ) {
            throw new DomainInvariantViolation('Profile and Binding Versions are not a coordinated definition.');
        }

        return [$profile, $binding];
    }

    private function draftResponse(
        DeviceProfileVersion $profile,
        TransportBindingVersion $binding,
        int $status = 200,
    ): JsonResponse {
        $profile->loadMissing('profile');
        $binding->loadMissing(['binding.profile', 'profileVersion']);
        $etag = (string) CoordinatedDefinitionEntityTag::for($profile, $binding);

        return response()->json([
            'data' => $this->documents->coordinated($profile, $binding),
            'etag' => $etag,
        ], $status)->withHeaders(['ETag' => $etag]);
    }
}
