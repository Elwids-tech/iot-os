<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Services;

use App\Domain\DeviceAdapters\Jobs\DeployAdapter;
use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\AdapterCredential;
use App\Domain\DeviceAdapters\Models\AdapterOperation;
use App\Domain\DeviceAdapters\Models\AdapterRevision;
use App\Domain\DeviceAdapters\Models\AdapterTenant;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Services\BrokerProvisioner;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceConfigurationService;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

final class AdapterService
{
    public function artifact(int $organization, string $uuid): DeviceProfileArtifact
    {
        return DeviceProfileArtifact::where('uuid', $uuid)->whereHas('profile', fn ($q) => $q->where('organization_id', $organization))->firstOrFail();
    }

    public function fields(array $input): array
    {
        $v = Validator::make($input, [
            'request_uuid' => 'sometimes|uuid', 'name' => 'required|string|max:255', 'artifact_uuid' => 'required|uuid', 'code' => 'required|string|max:64000',
            'fixtures' => 'required|array|min:1|max:10', 'fixtures.*.topic' => 'required|string|max:255', 'fixtures.*.payload' => 'nullable',
            'fixtures.*.payload_base64' => 'nullable|string|max:1398104', 'fixtures.*.expect_error' => 'sometimes|boolean', 'fixtures.*.expected' => 'sometimes|array',
            'source' => 'required|array:type,url,topics', 'source.type' => 'required|in:platform,vendor', 'source.url' => 'required_if:source.type,vendor|nullable|string|max:500',
            'source.topics' => 'required|array|min:1|max:32', 'source.topics.*' => 'required|string|max:255',
            'secrets' => 'sometimes|array:username,password,ca_certificate', 'secrets.username' => 'nullable|string|max:255', 'secrets.password' => 'nullable|string|max:4096', 'secrets.ca_certificate' => 'nullable|string|max:16384',
        ])->validate();
        if ($v['source']['type'] === 'vendor') {
            $url = parse_url($v['source']['url']);
            abort_unless($url && in_array($url['scheme'] ?? '', ['mqtt', 'mqtts', 'ssl'], true) && filled($url['host'] ?? null)
                && ! isset($url['user'], $url['pass']) && ! isset($url['user']) && ! isset($url['pass'])
                && ! isset($url['query']) && ! isset($url['fragment']) && in_array($url['path'] ?? '', ['', '/'], true),
                422, 'Use an MQTT broker URL without embedded credentials. Enter secrets in the connection fields.');
        } else {
            $v['source']['url'] = null;
        }
        foreach ($v['source']['topics'] as $topic) {
            $levels = explode('/', $topic);
            abort_if(str_starts_with($topic, '$') || str_starts_with($topic, 'spBv1.0/') || in_array($levels[0], ['#', '+']) || str_contains($topic, "\0"), 422, 'Choose a scoped manufacturer topic; reserved and broad subscriptions are unavailable.');
            foreach ($levels as $index => $level) {
                abort_unless(! strpbrk($level, '+#') || $level === '+' || ($level === '#' && $index === count($levels) - 1), 422, 'MQTT wildcards must occupy a complete topic level.');
            }
        }
        abort_if(strlen(json_encode($v['fixtures'])) > 6 * 1024 * 1024, 422, 'Test fixtures are too large.');
        foreach ($v['fixtures'] as $fixture) {
            abort_unless(array_key_exists('payload', $fixture) || filled($fixture['payload_base64'] ?? null), 422, 'Each fixture requires a payload.');
        }

        return $v;
    }

    public function save(Organization $organization, array $values, int $actor, ?DeviceAdapter $adapter = null, ?int $expected = null): DeviceAdapter
    {
        $v = $this->fields($values);
        $artifact = $this->artifact($organization->id, $v['artifact_uuid']);

        return DB::transaction(function () use ($organization, $v, $actor, $adapter, $expected, $artifact) {
            Organization::whereKey($organization->id)->lockForUpdate()->firstOrFail();
            if ($adapter) {
                $adapter = DeviceAdapter::whereKey($adapter->id)->lockForUpdate()->firstOrFail();
                abort_unless($adapter->organization_id === $organization->id, 404);
                abort_unless($adapter->draft_revision === $expected, 409, 'The adapter changed. Refresh before saving.');
                abort_if($adapter->status === 'pending', 409, 'Wait for the current deployment.');
                $revision = $adapter->draft_revision + 1;
            } else {
                $adapter = new DeviceAdapter(['uuid' => $v['request_uuid'] ?? (string) Str::uuid(), 'organization_id' => $organization->id, 'created_by' => $actor]);
                $revision = 1;
            }
            // A reused device profile remains pinned for all currently active installations.
            if ($adapter->exists && $adapter->device_profile_artifact_id !== $artifact->id) {
                abort_if(DeviceInstallation::whereIn('device_adapter_candidate_id', $adapter->candidates()->select('id'))->whereNull('ended_at')->exists(), 422, 'Create a separate adapter for a different profile while devices are active.');
            }
            $secrets = $adapter->secrets ?? [];
            if (isset($v['secrets'])) {
                foreach ($v['secrets'] as $key => $value) {
                    if ($value !== null && $value !== '') {
                        $secrets[$key] = $value;
                    }
                }
            }
            if ($v['source']['type'] === 'platform') {
                $secrets = ['password' => ($adapter->source['type'] ?? null) === 'platform' ? ($secrets['password'] ?? Str::random(48)) : Str::random(48)];
            }
            $adapter->fill(['name' => $v['name'], 'device_profile_artifact_id' => $artifact->id, 'draft_revision' => $revision, 'code' => $v['code'], 'fixtures' => $v['fixtures'], 'source' => $v['source'], 'secrets' => $secrets])->save();
            $definition = ['name' => $v['name'], 'code' => $v['code'], 'fixtures' => $v['fixtures'], 'source' => $v['source'], 'artifact_uuid' => $artifact->uuid, 'profile_hash' => $artifact->definition_hash];
            AdapterRevision::create(['device_adapter_id' => $adapter->id, 'revision' => $revision, 'content_hash' => hash('sha256', app(CanonicalJson::class)->encode($definition)), 'definition' => $definition, 'secret_snapshot' => $secrets, 'created_by' => $actor]);
            DeviceAudit::record('device.adapter.draft.saved', $organization->id, $actor, $adapter->uuid, ['draft_revision' => $revision]);

            return $adapter->fresh();
        });
    }

    public function current(DeviceAdapter $adapter): AdapterRevision
    {
        return $adapter->revisions()->where('revision', $adapter->draft_revision)->firstOrFail();
    }

    public function tenant(Organization $organization): AdapterTenant
    {
        return DB::transaction(function () use ($organization) {
            DB::table('organizations')->orderBy('id')->lockForUpdate()->get(['id']);
            if ($tenant = AdapterTenant::where('organization_id', $organization->id)->first()) {
                return $tenant;
            }
            $port = max((int) config('adapters.port_base'), (AdapterTenant::max('listen_port') ?? (int) config('adapters.port_base') - 1) + 1);
            abort_if($port > (int) config('adapters.port_limit'), 503, 'Tenant MQTT endpoint capacity reached.');

            return AdapterTenant::create(['organization_id' => $organization->id, 'listen_port' => $port, 'runtime_token' => Str::random(64), 'ingress_admin_password' => Str::random(64)]);
        });
    }

    public function tenantPayload(AdapterTenant $tenant): array
    {
        return [...$tenant->only(['uuid', 'listen_port']), 'runtime_token' => $tenant->runtime_token, 'ingress_admin_password' => $tenant->ingress_admin_password];
    }

    public function test(DeviceAdapter $adapter, int $expected): array
    {
        abort_unless($adapter->draft_revision === $expected, 409, 'Save and test the latest draft.');
        $revision = $this->current($adapter);
        $result = app(AdapterManager::class)->request('/test', ['code' => $revision->definition['code'], 'fixtures' => $revision->definition['fixtures'], 'profile' => $adapter->artifact->definition]);
        DB::transaction(function () use ($adapter, $revision, $result) {
            $locked = DeviceAdapter::whereKey($adapter->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->draft_revision === $revision->revision, 409, 'The draft changed while tests ran.');
            $revision->update(['test_result' => $result, 'tested_at' => now()]);
        });

        return $result;
    }

    public function gateway(DeviceAdapter $adapter): SparkplugGateway
    {
        $gateway = DB::transaction(function () use ($adapter) {
            Organization::whereKey($adapter->organization_id)->lockForUpdate()->firstOrFail();
            if ($adapter->fresh()->sparkplug_gateway_id) {
                return $adapter->fresh()->gateway;
            }
            $organization = Organization::findOrFail($adapter->organization_id);
            $connection = SparkplugConnection::firstOrCreate(['group_id' => 'adapters-'.$organization->uuid], ['organization_id' => $organization->id, 'name' => 'Device adapter connections', 'host_id' => 'adapter-host-'.$organization->uuid, 'username' => 'host-'.Str::uuid(), 'password' => Str::random(48)]);
            $gateway = SparkplugGateway::create(['organization_id' => $organization->id, 'sparkplug_connection_id' => $connection->id, 'name' => $adapter->name, 'edge_node_id' => 'adapter-'.$adapter->uuid, 'username' => 'edge-'.Str::uuid(), 'password' => Str::random(48)]);
            $adapter->update(['sparkplug_gateway_id' => $gateway->id]);

            return $gateway;
        });
        $provisioner = app(BrokerProvisioner::class);
        if ($gateway->connection->status !== 'ready') {
            $provisioner->connection($gateway->connection);
        }$provisioner->gateway($gateway);

        return $gateway->fresh();
    }

    public function deploy(AdapterOperation $operation): void
    {
        $adapter = $operation->adapter;
        $organization = Organization::findOrFail($adapter->organization_id);
        $tenant = $this->tenant($organization);
        $revision = $adapter->revisions()->where('uuid', $operation->revision_uuid)->firstOrFail();
        abort_unless($revision->tested_at && ($revision->test_result['valid'] ?? false), 422, 'This revision has not passed decoder tests.');
        $gateway = $this->gateway($adapter);
        $source = [...$revision->definition['source'], ...($revision->secret_snapshot ?? [])];
        $artifact = $this->artifact($adapter->organization_id, $revision->definition['artifact_uuid']);
        if ($source['type'] === 'vendor' && $operation->action !== 'pause') {
            app(AdapterManager::class)->request('/connection-test', $source);
        }
        $ca = config('devices.ca_file');
        $upstream = ['url' => config('devices.broker_url'), 'username' => $gateway->username, 'password' => $gateway->password, 'ca_certificate' => $ca && is_file($ca) ? file_get_contents($ca) : null, 'group_id' => $gateway->connection->group_id, 'host_id' => $gateway->connection->host_id, 'edge_node_id' => $gateway->edge_node_id];
        $bindings = DeviceInstallation::whereIn('device_adapter_candidate_id', $adapter->candidates()->select('id'))->whereNull('ended_at')->get()->map(function ($binding) {
            $candidate = AdapterCandidate::findOrFail($binding->device_adapter_candidate_id);

            return ['installation_uuid' => $binding->uuid, 'source_device_id' => $candidate->source_device_id, 'virtual_device_uuid' => $binding->device->uuid];
        })->all();
        $credentials = AdapterCredential::where('device_adapter_id', $adapter->id)->whereNull('revoked_at')->get()->map(fn ($credential) => ['username' => $credential->username, 'password' => $credential->password])->all();
        $result = app(AdapterManager::class)->request('/deploy', ['tenant' => $this->tenantPayload($tenant), 'action' => $operation->action, 'adapter_uuid' => $adapter->uuid, 'name' => $adapter->name, 'revision_uuid' => $revision->uuid, 'code' => $revision->definition['code'], 'source' => $source, 'profile' => $artifact->definition, 'upstream' => $upstream, 'bindings' => $bindings, 'hardware_credentials' => $credentials]);
        abort_unless($result['applied'] ?? false, 503, 'The runtime has not acknowledged the revision.');
        DB::transaction(function () use ($adapter, $tenant, $operation, $revision, $result) {
            $locked = DeviceAdapter::whereKey($adapter->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->desired_revision_uuid === $revision->uuid, 409, 'Deployment was superseded.');
            $locked->update(['applied_revision_uuid' => $revision->uuid, 'status' => $operation->action === 'pause' ? 'paused' : 'running', 'diagnostic' => null]);
            $tenant->update(['status' => 'ready', 'ca_certificate' => $result['ca_certificate'], 'broker_url' => $result['broker_url'], 'diagnostic' => null]);
            $operation->update(['status' => 'applied', 'diagnostic' => null]);
        });
    }

    public function operation(DeviceAdapter $adapter, string $action, int $actor, ?string $revisionUuid = null, ?string $requestUuid = null): AdapterOperation
    {
        return DB::transaction(function () use ($adapter, $action, $actor, $revisionUuid, $requestUuid) {
            $locked = DeviceAdapter::whereKey($adapter->id)->lockForUpdate()->firstOrFail();
            $revision = $revisionUuid ? $locked->revisions()->where('uuid', $revisionUuid)->firstOrFail() : $this->current($locked);
            if ($requestUuid && ($existing = AdapterOperation::where('uuid', $requestUuid)->first())) {
                abort_unless($existing->device_adapter_id === $locked->id && $existing->created_by === $actor, 404);
                abort_unless($existing->action === $action && $existing->revision_uuid === $revision->uuid, 409, 'This operation request was already used.');

                return $existing;
            }
            abort_if($locked->status === 'pending', 409, 'Wait for the current deployment.');
            abort_unless($revision->tested_at && ($revision->test_result['valid'] ?? false), 422, 'Test this exact revision before deployment.');
            $operation = AdapterOperation::create(['uuid' => $requestUuid ?? (string) Str::uuid(), 'organization_id' => $locked->organization_id, 'device_adapter_id' => $locked->id, 'revision_uuid' => $revision->uuid, 'action' => $action, 'status' => 'queued', 'created_by' => $actor]);
            $locked->update(['desired_revision_uuid' => $revision->uuid, 'status' => 'pending']);
            DeviceAudit::record('device.adapter.'.$action.'.requested', $locked->organization_id, $actor, $locked->uuid, ['operation_uuid' => $operation->uuid, 'revision_uuid' => $revision->uuid]);

            return $operation;
        });
    }

    public function activate(AdapterCandidate $candidate, ?string $deviceUuid, string $name, int $actor): DeviceInstallation
    {
        if ($candidate->installation) {
            abort_unless(! $deviceUuid || $candidate->installation->device->uuid === $deviceUuid, 409, 'This physical source already has an installation.');

            return $candidate->installation;
        }
        $adapter = $candidate->adapter;
        abort_unless($adapter->status === 'running' && $adapter->applied_revision_uuid, 422, 'Deploy the adapter before activating devices.');
        $birth = DiscoveryCandidate::where('sparkplug_gateway_id', $adapter->sparkplug_gateway_id)->where('source_device_id', $candidate->sparkplug_device_id)->first();
        abort_unless($birth, 422, 'Wait for a live Sparkplug birth message. Retained previews cannot activate a device.');

        return DB::transaction(function () use ($candidate, $adapter, $birth, $deviceUuid, $name, $actor) {
            $adapter = DeviceAdapter::whereKey($adapter->id)->lockForUpdate()->firstOrFail();
            $candidate = AdapterCandidate::whereKey($candidate->id)->lockForUpdate()->firstOrFail();
            if ($candidate->installation) {
                abort_unless(! $deviceUuid || $candidate->installation->device->uuid === $deviceUuid, 409, 'This physical source already has an installation.');

                return $candidate->installation;
            }
            abort_unless($adapter->status === 'running', 409, 'Wait for the current adapter deployment.');
            $device = $deviceUuid ? Device::where('organization_id', $adapter->organization_id)->where('uuid', $deviceUuid)->lockForUpdate()->firstOrFail() : Device::create(['organization_id' => $adapter->organization_id, 'name' => $name, 'code' => 'device-'.Str::uuid(), 'created_by' => $actor, 'updated_by' => $actor]);
            $device = $device->fresh();
            abort_if($device->lifecycle === 'archived' || $device->applied_configuration_uuid || $device->desired_configuration_uuid || $device->last_applied_configuration_uuid, 422, 'Select an inactive virtual device. Replacement with counter adjustments is a separate workflow.');
            abort_if(DeviceInstallation::where('device_id', $device->id)->whereNull('ended_at')->exists(), 409, 'The virtual device already has an active physical installation.');
            $installation = DeviceInstallation::create(['organization_id' => $adapter->organization_id, 'device_id' => $device->id, 'device_adapter_candidate_id' => $candidate->id, 'adapter_revision_uuid' => $adapter->applied_revision_uuid, 'manufacturer_serial' => $candidate->source_device_id, 'started_at' => now(), 'created_by' => $actor]);
            $mappings = collect($adapter->artifact->definition['parameters'])->filter(fn ($p) => ($p['reports_state'] ?? false) && $p['kind'] !== 'derived')->map(fn ($p) => ['parameter_uuid' => $p['uuid'], 'metric' => $p['key'], 'conversion_mode' => 'none'])->values()->all();
            $service = app(DeviceConfigurationService::class);
            $device = $service->saveDraft($device, ['artifact_uuid' => $adapter->artifact->uuid, 'candidate_uuid' => $birth->uuid, 'birth_revision' => $birth->birth_revision, 'mappings' => $mappings], $device->draft_revision, $actor);
            $service->activate($device, $device->draft_revision, $actor);
            $candidate->update(['status' => 'activated']);
            $operation = $this->operation($adapter->fresh(), 'deploy', $actor, $adapter->applied_revision_uuid);
            DeployAdapter::dispatch($operation->id)->afterCommit();

            return $installation;
        });
    }

    public function view(DeviceAdapter $adapter): array
    {
        $current = $this->current($adapter);

        return [...$adapter->only(['uuid', 'name', 'code', 'fixtures', 'source', 'draft_revision', 'status', 'diagnostic', 'health', 'applied_revision_uuid', 'desired_revision_uuid']),
            'artifact_uuid' => $adapter->artifact->uuid, 'profile_name' => $adapter->artifact->profile->name, 'profile' => $adapter->artifact->definition, 'credentials_configured' => filled($adapter->secrets['password'] ?? null), 'revision' => $current->only(['uuid', 'revision', 'content_hash', 'tested_at', 'test_result']),
            'revisions' => $adapter->revisions()->latest('revision')->limit(30)->get()->map(fn ($r) => $r->only(['uuid', 'revision', 'content_hash', 'tested_at', 'test_result'])),
            'operations' => AdapterOperation::where('device_adapter_id', $adapter->id)->latest()->limit(10)->get()->map(fn ($o) => $o->only(['uuid', 'action', 'status', 'diagnostic', 'revision_uuid', 'created_at']))];
    }
}
