<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

final class ApplicationController
{
    public const ABILITIES = ['devices:read', 'alerts:read', 'events:read', 'telemetry:read'];

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
            \App\Domain\Integrations\Services\WebhookDispatch::cancel($locked->id, 'Application grants changed.');
            DeviceAudit::record('application.grants_updated', $locked->organization_id, $request->user()->id, $locked->uuid, $input);
            return $locked;
        });
        return ['data' => $this->view($application)];
    }

    public function rotate(Request $request, Organization $organization, IntegrationApplication $application)
    {
        $this->authorize($request, $organization, $application);
        $input = $request->validate(['revision' => 'required|integer|min:1', 'expires_in_days' => 'required|integer|min:1|max:90', 'abilities' => 'required|array|min:1|max:3', 'abilities.*' => ['required', 'string', 'distinct', Rule::in(self::ABILITIES)]]);
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
            \App\Domain\Integrations\Services\WebhookDispatch::cancel($locked->id, 'Application revoked.');
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

    private function grants(Request $request, Organization $organization): array
    {
        $input = $request->validate(['name' => 'required|string|max:255', 'abilities' => 'required|array|min:1|max:3', 'abilities.*' => ['required', 'string', 'distinct', Rule::in(self::ABILITIES)], 'device_uuids' => 'required|array|min:1|max:100', 'device_uuids.*' => 'required|uuid|distinct']);
        $input['device_uuids'] = array_map('strtolower', $input['device_uuids']);
        abort_unless(count(array_unique($input['device_uuids'])) === count($input['device_uuids']) && Device::where('organization_id', $organization->id)->whereIn('uuid', $input['device_uuids'])->count() === count($input['device_uuids']), 422, 'Every device must belong to this organization.');
        return $input;
    }

    private function view(IntegrationApplication $app): array
    {
        return $app->only(['uuid', 'name', 'abilities', 'device_uuids', 'revision', 'grant_revision', 'revoked_at']);
    }
}
