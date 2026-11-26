<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\Site;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityType;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Integrations\Services\ApplicationGrant;
use App\Domain\Integrations\Services\ApplicationGrants;
use App\Domain\Integrations\Services\WebhookDispatch;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class ApplicationController
{
    public const ABILITIES = ['devices:read', 'alerts:read', 'events:read', 'telemetry:read', 'locations:read', 'geofences:read', 'geofences:manage', 'geofences:activate', 'entities:read', 'telemetry:stream'];

    public function __construct(private readonly DeviceAuthorization $authorization) {}

    private function authorize(Request $request, Organization $organization, ?IntegrationApplication $application = null): void
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $application);
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);
    }

    public function index(Request $request, Organization $organization): array
    {
        $this->authorize($request, $organization);

        return ['data' => IntegrationApplication::where('organization_id', $organization->id)->orderBy('id')->get()->map(fn ($app) => $this->view($app))];
    }

    public function store(Request $request, Organization $organization)
    {
        $this->authorize($request, $organization);
        $input = $this->grants($request, $organization);
        $application = DB::transaction(function () use ($organization, $input, $request) {
            Organization::whereKey($organization->id)->lockForUpdate()->firstOrFail();
            abort_if(IntegrationApplication::where('organization_id', $organization->id)->count() >= 50, 422, 'Application limit reached.');
            $application = IntegrationApplication::create(['organization_id' => $organization->id, ...$input]);
            DeviceAudit::record('application.created', $organization->id, $request->user()->id, $application->uuid, $input);

            return $application;
        });

        return response()->json(['data' => $this->view($application->fresh())], 201);
    }

    public function update(Request $request, Organization $organization, IntegrationApplication $application): array
    {
        $this->authorize($request, $organization, $application);
        $input = $this->grants($request, $organization);
        $revision = $request->validate(['revision' => 'required|integer|min:1'])['revision'];
        $application = DB::transaction(function () use ($application, $input, $revision, $request) {
            $locked = $this->lock($application, (int) $revision);
            $locked->update([...$input, 'revision' => $locked->revision + 1, 'grant_revision' => $locked->grant_revision + 1]);
            $locked->tokens()->delete();
            WebhookDispatch::cancel($locked->id, 'Application grants changed.');
            DeviceAudit::record('application.grants_updated', $locked->organization_id, $request->user()->id, $locked->uuid, $input);

            return $locked;
        });

        return ['data' => $this->view($application)];
    }

    public function rotate(Request $request, Organization $organization, IntegrationApplication $application)
    {
        $this->authorize($request, $organization, $application);
        $input = $request->validate(['revision' => 'required|integer|min:1', 'expires_in_days' => 'required|integer|min:1|max:90', 'abilities' => 'required|array|min:1|max:10', 'abilities.*' => ['required', 'string', 'distinct', Rule::in(self::ABILITIES)]]);
        $result = DB::transaction(function () use ($application, $input, $request) {
            $locked = $this->lock($application, (int) $input['revision']);
            abort_if(array_diff($input['abilities'], $locked->abilities), 422, 'Token abilities exceed application grants.');
            $locked->tokens()->delete();
            $secret = 'iot_app_'.Str::random(64);
            $token = $locked->tokens()->create(['name' => 'application', 'token' => hash('sha256', $secret), 'abilities' => $input['abilities'], 'expires_at' => now()->addDays((int) $input['expires_in_days'])]);
            $locked->update(['revision' => $locked->revision + 1]);
            DeviceAudit::record('application.token_rotated', $locked->organization_id, $request->user()->id, $locked->uuid, ['abilities' => $input['abilities'], 'expires_at' => $token->expires_at->toIso8601String()]);

            return ['application' => $this->view($locked), 'token' => $token->id.'|'.$secret, 'expires_at' => $token->expires_at->toIso8601String()];
        });

        return response()->json(['data' => $result], 201)->header('Cache-Control', 'no-store');
    }

    public function revoke(Request $request, Organization $organization, IntegrationApplication $application): array
    {
        $this->authorize($request, $organization, $application);
        $revision = $request->validate(['revision' => 'required|integer|min:1'])['revision'];
        $application = DB::transaction(function () use ($application, $revision, $request) {
            $locked = $this->lock($application, (int) $revision);
            $locked->tokens()->delete();
            $locked->update(['revoked_at' => now(), 'revision' => $locked->revision + 1]);
            WebhookDispatch::cancel($locked->id, 'Application revoked.');
            DeviceAudit::record('application.revoked', $locked->organization_id, $request->user()->id, $locked->uuid);

            return $locked;
        });

        return ['data' => $this->view($application)];
    }

    private function lock(IntegrationApplication $application, int $revision): IntegrationApplication
    {
        $locked = IntegrationApplication::whereKey($application->id)->lockForUpdate()->firstOrFail();
        abort_if($locked->revoked_at || $locked->revision !== $revision, 409, 'Application changed or was revoked. Reload before continuing.');

        return $locked;
    }

    /**
     * A grant is a list of 1 to 100 devices or a scope of 1 to 50 active entities of the
     * organization, any type, never both and never neither (spec 030, FR-017; spec 009,
     * FR-026). `site_uuids` still names a scope of Site entities; it cannot be sent with
     * `entity_uuids`. A foreign device or entity is refused with the same generic message,
     * revealing nothing (FR-022).
     *
     * @return array{name: string, abilities: list<string>, device_uuids: list<string>, entity_uuids: list<string>}
     */
    private function grants(Request $request, Organization $organization): array
    {
        $input = $request->validate(['name' => 'required|string|max:255', 'abilities' => 'required|array|min:1|max:10', 'abilities.*' => ['required', 'string', 'distinct', Rule::in(self::ABILITIES)],
            'device_uuids' => 'sometimes|array|max:100', 'device_uuids.*' => 'required|uuid|distinct',
            'entity_uuids' => 'sometimes|array|max:50', 'entity_uuids.*' => 'required|uuid|distinct',
            'site_uuids' => 'sometimes|array|max:50', 'site_uuids.*' => 'required|uuid|distinct']);
        $devices = array_values(array_map('strtolower', $input['device_uuids'] ?? []));
        $entities = array_values(array_map('strtolower', $input['entity_uuids'] ?? []));
        $sites = array_values(array_map('strtolower', $input['site_uuids'] ?? []));
        if ($entities !== [] && $sites !== []) {
            throw ValidationException::withMessages(['entity_uuids' => 'Send the scope as entity_uuids or as site_uuids, not both.']);
        }
        $scope = $entities !== [] ? $entities : $sites;
        if (($devices === []) === ($scope === [])) {
            throw ValidationException::withMessages(['device_uuids' => 'Grant either a list of devices or a scope of entities: exactly one of device_uuids and entity_uuids must be non-empty.']);
        }
        abort_unless(count(array_unique($devices)) === count($devices) && Device::where('organization_id', $organization->id)->whereIn('uuid', $devices)->count() === count($devices), 422, 'Every device must belong to this organization.');
        if ($sites !== []) {
            abort_unless(count(array_unique($sites)) === count($sites) && Site::where('organization_id', $organization->id)->whereIn('uuid', $sites)->count() === count($sites), 422, 'Every site must belong to this organization.');
        } else {
            abort_unless(count(array_unique($entities)) === count($entities) && Entity::query()->where('organization_id', $organization->id)->whereNull('archived_at')->whereIn('uuid', $entities)->count() === count($entities), 422, 'Every entity must belong to this organization.');
        }

        return ['name' => $input['name'], 'abilities' => $input['abilities'], 'device_uuids' => $devices, 'entity_uuids' => $scope];
    }

    private function view(IntegrationApplication $app): array
    {
        $grant = ApplicationGrants::for($app);
        $entities = Entity::query()->where('entities.organization_id', $app->organization_id)->whereIn('entities.uuid', $app->entity_uuids ?? [])
            ->join('entity_types', 'entity_types.id', '=', 'entities.entity_type_id')->orderBy('entities.path')
            ->get(['entities.uuid', 'entities.name', 'entities.path', 'entity_types.key as type_key']);
        // For readers of site scopes: the same scope as sites while every entity in it is a Site.
        $sites = $entities->every(fn (Entity $entity) => $entity->type_key === EntityType::SITE);

        return [...$app->only(['uuid', 'name', 'abilities', 'device_uuids', 'revision', 'grant_revision', 'revoked_at']),
            'entity_uuids' => $app->entity_uuids ?? [],
            'entities' => $entities->map(fn (Entity $entity) => $entity->only(['uuid', 'name', 'path', 'type_key']))->values(),
            'site_uuids' => $sites ? ($app->entity_uuids ?? []) : null,
            'sites' => $sites ? $entities->sortBy('name')->map(fn (Entity $entity) => $entity->only(['uuid', 'name']))->values() : null,
            // The named devices of a list; a scope names entities and its devices are read live.
            'devices' => $grant->kind() === ApplicationGrant::DEVICES ? $grant->deviceQuery()->get(['uuid', 'name', 'code']) : [],
            'credential' => $app->tokens()->latest('id')->first()?->only(['abilities', 'expires_at'])];
    }
}
