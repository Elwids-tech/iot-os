<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Controllers;

use App\Domain\DeviceProfiles\Http\Requests\StoreBindingParameterMappingRequest;
use App\Domain\DeviceProfiles\Http\Requests\StoreTransportBindingRequest;
use App\Domain\DeviceProfiles\Http\Resources\TransportBindingResource;
use App\Domain\DeviceProfiles\Models\BindingParameterMapping;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use App\Domain\DeviceProfiles\Models\TransportBinding;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

final class TransportBindingController
{
    public function __construct(
        private readonly DeviceProfileAuthorization $authorization,
        private readonly DeviceProfileAuthoring $authoring,
    ) {}

    public function index(Request $request, Organization $organization, DeviceProfile $profile): AnonymousResourceCollection
    {
        $this->authorize($request->user(), $organization, $profile);

        return TransportBindingResource::collection($profile->transportBindings()->with('parameterMappings.parameter')->orderBy('name')->get());
    }

    public function store(StoreTransportBindingRequest $request, Organization $organization, DeviceProfile $profile): JsonResponse
    {
        $this->authorize($request->user(), $organization, $profile);
        $validated = $request->validated();
        $draftRevision = $validated['draft_revision'];
        unset($validated['draft_revision']);

        $result = $this->authoring->mutate($profile, $request->user(), $draftRevision, static fn (DeviceProfile $locked): TransportBinding => $locked->transportBindings()->create($validated));

        return TransportBindingResource::make($result['result'])->response()->setStatusCode(201);
    }

    public function storeMapping(StoreBindingParameterMappingRequest $request, Organization $organization, DeviceProfile $profile, TransportBinding $binding): JsonResponse
    {
        $this->authorize($request->user(), $organization, $profile);
        $this->ensureBinding($binding, $profile);
        $validated = $request->validated();

        $this->authoring->mutate($profile, $request->user(), $validated['draft_revision'], function (DeviceProfile $locked) use ($binding, $validated): BindingParameterMapping {
            /** @var TransportBinding $editable */
            $editable = $locked->transportBindings()->whereKey($binding->getKey())->firstOrFail();
            $parameter = $locked->parameters()->where('uuid', $validated['parameter_uuid'])->first();
            if (! $parameter instanceof ProfileParameter) {
                throw ValidationException::withMessages(['parameter_uuid' => 'The parameter must belong to this profile.']);
            }

            return $editable->parameterMappings()->create([
                'profile_parameter_id' => $parameter->getKey(),
                'direction' => $validated['direction'],
                'transport_locator' => $validated['transport_locator'],
                'codec_config' => $validated['codec_config'] ?? null,
                'transform_config' => $validated['transform_config'] ?? null,
            ]);
        });

        return TransportBindingResource::make($binding->fresh()->load('parameterMappings.parameter'))->response()->setStatusCode(201);
    }

    public function destroy(Request $request, Organization $organization, DeviceProfile $profile, TransportBinding $binding): Response
    {
        $this->authorize($request->user(), $organization, $profile);
        $this->ensureBinding($binding, $profile);
        $validated = $request->validate(['draft_revision' => ['required', 'integer', 'min:1']]);

        $this->authoring->mutate($profile, $request->user(), $validated['draft_revision'], static function (DeviceProfile $locked) use ($binding): null {
            $locked->transportBindings()->whereKey($binding->getKey())->delete();

            return null;
        });

        return response()->noContent();
    }

    private function authorize($user, Organization $organization, DeviceProfile $profile): void
    {
        $this->authorization->authorize($user, DeviceProfilePermission::MANAGE_TRANSPORT_BINDINGS);
        $this->authorization->ensureOrganizationProfile($profile, $organization);
    }

    private function ensureBinding(TransportBinding $binding, DeviceProfile $profile): void
    {
        abort_unless($binding->device_profile_id === $profile->getKey(), 404);
    }
}
