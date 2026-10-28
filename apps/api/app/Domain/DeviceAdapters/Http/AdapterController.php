<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Http;

use App\Domain\Assistant\Services\OnboardingProposals;
use App\Domain\DeviceAdapters\Jobs\DeployAdapter;
use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\AdapterCredential;
use App\Domain\DeviceAdapters\Models\AdapterProposal;
use App\Domain\DeviceAdapters\Models\AdapterTenant;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Services\AdapterConnectionKit;
use App\Domain\DeviceAdapters\Services\AdapterDiagnostics;
use App\Domain\DeviceAdapters\Services\AdapterReports;
use App\Domain\DeviceAdapters\Services\PollingService;
use App\Domain\DeviceAdapters\Services\WebhookRoutes;
use App\Domain\DeviceAdapters\Services\AdapterManager;
use App\Domain\DeviceAdapters\Services\AdapterService;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceView;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class AdapterController
{
    public function __construct(private readonly AdapterService $service, private readonly DeviceAuthorization $authorization) {}

    private function authorize(Request $r, Organization $organization, ?DeviceAdapter $a = null, DevicePermission $p = DevicePermission::MANAGE): void
    {
        abort_unless(config('adapters.enabled'), 404);
        $this->authorization->authorize($r->user(), $p, $organization, $a);
    }

    public function index(Request $r, Organization $organization): array
    {
        $this->authorize($r, $organization, null, DevicePermission::VIEW);

        $diagnostics = app(AdapterDiagnostics::class);

        return ['data' => DeviceAdapter::where('organization_id', $organization->id)->latest()->limit(100)->get()->map(fn ($a) => [...$a->only(['uuid', 'name', 'status', 'source', 'health', 'diagnostic']), 'profile_name' => $a->artifact->profile->name, 'source_state' => $diagnostics->sourceState($a)]),
            'webhooks_available' => app(WebhookRoutes::class)->available(), 'tenant' => AdapterTenant::where('organization_id', $organization->id)->first()?->only(['uuid', 'status', 'broker_url', 'diagnostic']), 'capabilities' => $this->authorization->capabilities($r->user(), $organization)];
    }

    public function profiles(Request $r, Organization $organization): array
    {
        $this->authorize($r, $organization, null, DevicePermission::VIEW);

        return ['data' => DeviceProfileArtifact::whereHas('profile', fn ($q) => $q->where('organization_id', $organization->id))->latest()->limit(100)->get()->map(fn ($a) => ['uuid' => $a->uuid, 'name' => $a->profile->name, 'revision' => $a->revision, 'definition' => $a->definition])];
    }

    public function store(Request $r, Organization $organization)
    {
        $this->authorize($r, $organization);
        $this->authorization->authorize($r->user(), DevicePermission::CONNECTIONS, $organization);
        $requestUuid = $r->validate(['request_uuid' => 'required|uuid'])['request_uuid'];
        $adapter = DB::transaction(function () use ($r, $organization, $requestUuid) {
            Organization::whereKey($organization->id)->lockForUpdate()->firstOrFail();
            if ($existing = DeviceAdapter::where('uuid', $requestUuid)->first()) {
                abort_unless($existing->organization_id === $organization->id && $existing->created_by === $r->user()->id, 404);
                $v = $this->service->fields($r->all());
                $artifact = $this->service->artifact($organization->id, $v['artifact_uuid']);
                $definition = ['name' => $v['name'], 'code' => $v['code'], 'fixtures' => $v['fixtures'], 'source' => $v['source'], 'artifact_uuid' => $artifact->uuid, 'profile_hash' => $artifact->definition_hash];
                abort_unless($existing->revisions()->where('revision', 1)->value('content_hash') === hash('sha256', app(CanonicalJson::class)->encode($definition)), 409, 'This adapter setup request was already used.');

                return $existing;
            }

            return $this->service->save($organization, $r->all(), $r->user()->id);
        });

        return response()->json(['data' => $this->service->view($adapter)], 201);
    }

    public function show(Request $r, Organization $organization, DeviceAdapter $adapter): array
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::VIEW);

        return ['data' => $this->service->view($adapter)];
    }

    public function update(Request $r, Organization $organization, DeviceAdapter $adapter): array
    {
        $this->authorize($r, $organization, $adapter);
        $this->authorization->authorize($r->user(), DevicePermission::CONNECTIONS, $organization);
        $revision = $r->validate(['draft_revision' => 'required|integer|min:1'])['draft_revision'];

        return ['data' => $this->service->view($this->service->save($organization, $r->all(), $r->user()->id, $adapter, $revision))];
    }

    public function test(Request $r, Organization $organization, DeviceAdapter $adapter): array
    {
        $this->authorize($r, $organization, $adapter);
        $v = $r->validate(['draft_revision' => 'required|integer|min:1']);

        return ['data' => $this->service->test($adapter, $v['draft_revision'])];
    }

    public function connectionTest(Request $r, Organization $organization, DeviceAdapter $adapter): array
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::CONNECTIONS);
        abort_if(in_array($adapter->source['type'], ['webhook', 'poll'], true), 422, $adapter->source['type'] === 'poll' ? 'Use Fetch now to check a polling source.' : 'Webhook sources are checked by their deliveries.');
        if ($adapter->source['type'] === 'platform') {
            $tenant = $this->service->tenant($organization);
            $result = app(AdapterManager::class)->request('/provision', ['tenant' => $this->service->tenantPayload($tenant)]);
            $tenant->update([...array_intersect_key($result, array_flip(['broker_url', 'ca_certificate'])), 'status' => 'ready']);

            return ['data' => ['connected' => true, 'broker_url' => $result['broker_url']]];
        }

        return ['data' => app(AdapterManager::class)->request('/connection-test', [...$adapter->source, ...($adapter->secrets ?? [])])];
    }

    public function deploy(Request $r, Organization $organization, DeviceAdapter $adapter)
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::CONNECTIONS);
        $this->authorization->authorize($r->user(), DevicePermission::MANAGE, $organization);
        $v = $r->validate(['request_uuid' => 'required|uuid', 'draft_revision' => 'required|integer|min:1', 'action' => 'sometimes|in:deploy,pause,rollback', 'revision_uuid' => 'nullable|uuid', 'cursor_start_at' => 'nullable|date']);
        abort_unless($adapter->draft_revision === $v['draft_revision'], 409, 'Review the latest draft before deployment.');
        $action = $v['action'] ?? 'deploy';
        $revision = $action === 'pause' ? $adapter->applied_revision_uuid : ($v['revision_uuid'] ?? null);
        abort_if($action === 'rollback' && ! $revision, 422, 'Select a tested revision to roll back.');
        if ($action !== 'pause') {
            app(PollingService::class)->firstDeployment($adapter, $v['cursor_start_at'] ?? null);
        }
        $operation = $this->service->operation($adapter, $action, $r->user()->id, $revision, $v['request_uuid']);
        if ($operation->status === 'queued') {
            DeployAdapter::dispatch($operation->id)->afterCommit();
        }

        return response()->json(['data' => $operation->only(['uuid', 'action', 'status', 'revision_uuid'])], 202);
    }

    public function candidates(Request $r, Organization $organization, DeviceAdapter $adapter): array
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::VIEW);

        return ['data' => $adapter->candidates()->with('installation.device')->latest('last_seen_at')->limit(100)->get()->map(fn ($c) => [...$c->only(['uuid', 'source_device_id', 'preview', 'status', 'last_seen_at']), 'installation_uuid' => $c->installation?->uuid, 'device' => $c->installation?->device ? DeviceView::device($c->installation->device) : null])];
    }

    public function activate(Request $r, Organization $organization, DeviceAdapter $adapter, AdapterCandidate $candidate)
    {
        $this->authorize($r, $organization, $adapter);
        $this->authorization->authorize($r->user(), DevicePermission::ACTIVATE, $organization);
        $this->authorization->authorize($r->user(), DevicePermission::CONNECTIONS, $organization);
        abort_unless($candidate->device_adapter_id === $adapter->id, 404);
        $v = $r->validate(['device_uuid' => 'nullable|uuid', 'name' => 'required|string|max:255']);
        $installation = $this->service->activate($candidate, $v['device_uuid'] ?? null, $v['name'], $r->user()->id);

        return response()->json(['data' => ['installation_uuid' => $installation->uuid, 'device' => DeviceView::device($installation->device)]], 202);
    }

    public function credentials(Request $r, Organization $organization, DeviceAdapter $adapter): array
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::CONNECTIONS);

        return ['data' => AdapterCredential::where('device_adapter_id', $adapter->id)->latest()->limit(100)->get()->map(fn ($c) => $c->only(['uuid', 'name', 'username', 'revoked_at']))];
    }

    public function credential(Request $r, Organization $organization, DeviceAdapter $adapter)
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::CONNECTIONS);
        abort_unless($adapter->source['type'] === 'platform', 422, 'Vendor credentials are supplied by the manufacturer.');
        $v = $r->validate(['name' => 'required|string|max:255']);
        $credential = AdapterCredential::create(['organization_id' => $organization->id, 'device_adapter_id' => $adapter->id, 'name' => $v['name'], 'username' => 'device-'.Str::uuid(), 'password' => Str::random(48), 'created_by' => $r->user()->id]);

        return $this->kit($r, $organization, $adapter, $credential);
    }

    public function kit(Request $r, Organization $organization, DeviceAdapter $adapter, AdapterCredential $credential)
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::CONNECTIONS);
        abort_unless($credential->device_adapter_id === $adapter->id && ! $credential->revoked_at, 404);
        $tenant = $this->service->tenant($organization);
        $result = app(AdapterManager::class)->request('/credential', ['tenant' => $this->service->tenantPayload($tenant), 'username' => $credential->username, 'password' => $credential->password, 'topics' => $adapter->source['topics']]);
        $tenant->update([...array_intersect_key($result, array_flip(['broker_url', 'ca_certificate'])), 'status' => 'ready']);
        DeviceAudit::record('device.adapter.credential.downloaded', $organization->id, $r->user()->id, $adapter->uuid, ['credential_uuid' => $credential->uuid]);

        $kit = app(AdapterConnectionKit::class)->make([...$result, 'credential_uuid' => $credential->uuid, 'username' => $credential->username, 'password' => $credential->password, 'publish_topics' => $adapter->source['topics'], 'instructions' => 'Configure the MQTT endpoint and server CA. Keep the manufacturer payload and topic structure unchanged.']);

        return response()->json(['data' => $kit])->withHeaders(['Cache-Control' => 'no-store, private', 'Pragma' => 'no-cache']);
    }

    public function rotate(Request $r, Organization $organization, DeviceAdapter $adapter, AdapterCredential $credential)
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::CONNECTIONS);
        abort_unless($credential->device_adapter_id === $adapter->id && ! $credential->revoked_at, 404);
        $credential->update(['password' => Str::random(48)]);

        return $this->kit($r, $organization, $adapter, $credential);
    }

    public function revoke(Request $r, Organization $organization, DeviceAdapter $adapter, AdapterCredential $credential): array
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::CONNECTIONS);
        abort_unless($credential->device_adapter_id === $adapter->id, 404);
        $tenant = $this->service->tenant($organization);
        app(AdapterManager::class)->request('/revoke', ['tenant' => $this->service->tenantPayload($tenant), 'username' => $credential->username]);
        $credential->update(['revoked_at' => now()]);
        DeviceAudit::record('device.adapter.credential.revoked', $organization->id, $r->user()->id, $adapter->uuid, ['credential_uuid' => $credential->uuid]);

        return ['data' => ['revoked' => true]];
    }

    public function proposals(Request $r, Organization $organization, DeviceAdapter $adapter): array
    {
        $this->authorize($r, $organization, $adapter);

        return ['data' => AdapterProposal::where('device_adapter_id', $adapter->id)->where('user_id', $r->user()->id)->latest()->limit(30)->get()];
    }

    public function proposalDecision(Request $r, Organization $organization, DeviceAdapter $adapter, AdapterProposal $proposal): array
    {
        $this->authorize($r, $organization, $adapter);
        abort_unless($proposal->device_adapter_id === $adapter->id && $proposal->user_id === $r->user()->id, 404);
        $v = $r->validate(['action' => 'required|in:apply,reject', 'content_hash' => 'required|string|size:64']);
        if ($proposal->organization_id === null) {
            $proposal->update(['organization_id' => $adapter->organization_id]);
        }
        $result = app(OnboardingProposals::class)->decide($proposal->fresh(), $r->user(), $organization, $v['action'], $v['content_hash']);

        return ['data' => $v['action'] === 'reject' ? ['status' => 'rejected'] : $result['adapter']];
    }

    public function event(Request $r)
    {
        abort_unless(config('adapters.enabled') && strlen($r->getContent()) <= 1048576, 404);
        $tenant = AdapterTenant::where('uuid', $r->header('X-Adapter-Tenant'))->first();
        abort_unless($tenant && hash_equals($tenant->runtime_token, $r->bearerToken() ?? ''), 401);
        $v = $r->validate(['adapter_uuid' => 'required|uuid', 'revision_uuid' => 'nullable|uuid', 'kind' => 'required|in:sample,health,diagnostic,poll_run,failure,outcomes', 'source_device_id' => 'required_if:kind,sample|string|max:128', 'sparkplug_device_id' => 'required_if:kind,sample|string|max:80', 'preview' => 'required_if:kind,sample|array', 'retained' => 'sometimes|boolean', 'source_connected' => 'sometimes|boolean', 'upstream_connected' => 'sometimes|boolean', 'source_state' => 'sometimes|in:polling,retrying,stopped',
            'run_id' => 'required_if:kind,poll_run|string|max:64', 'started_at' => 'required_if:kind,poll_run|date', 'outcome' => 'required_if:kind,poll_run|in:ok,empty,partial,retrying,stopped', 'state' => 'required_if:kind,poll_run|in:polling,retrying,stopped',
            'report_id' => 'required_if:kind,failure,outcomes|string|max:64', 'reason' => 'nullable|string|max:300', 'error' => 'nullable|string|max:300', 'input' => 'nullable|array', 'source' => 'sometimes|in:mqtt,webhook,poll', 'bucket' => 'required_if:kind,outcomes|date', 'counts' => 'required_if:kind,outcomes|array']);
        $adapter = DeviceAdapter::where('organization_id', $tenant->organization_id)->where('uuid', $v['adapter_uuid'])->firstOrFail();
        if (isset($v['revision_uuid']) && ! in_array($v['revision_uuid'], [$adapter->applied_revision_uuid, $adapter->desired_revision_uuid], true)) {
            return response()->noContent();
        }
        if ($v['kind'] === 'sample') {
            $expected = 'src-'.substr(hash('sha256', $v['source_device_id']), 0, 32);
            abort_unless(hash_equals($expected, $v['sparkplug_device_id']), 422);
            $exists = $adapter->candidates()->where('source_device_id', $v['source_device_id'])->exists();
            if (! $exists && $adapter->candidates()->count() >= 1000) {
                return response()->noContent();
            }
            $adapter->candidates()->updateOrCreate(['organization_id' => $tenant->organization_id, 'source_device_id' => $v['source_device_id']], ['sparkplug_device_id' => $expected, 'preview' => [...$v['preview'], 'retained' => $v['retained'] ?? false], 'last_seen_at' => now()]);
            $health = $adapter->health ?? [];
            $health['last_message_at'] = now()->toIso8601String();
            $adapter->update(['health' => $health]);
        } elseif ($v['kind'] === 'health') {
            $adapter->update(['health' => [...($adapter->health ?? []), ...array_intersect_key($v, array_flip(['source_connected', 'upstream_connected', 'source_state'])), 'checked_at' => now()->toIso8601String()]]);
        } elseif ($v['kind'] === 'poll_run') {
            app(PollingService::class)->record($adapter, $r->only(['run_id', 'revision_uuid', 'started_at', 'finished_at', 'outcome', 'http_status', 'pages', 'records', 'published', 'failed', 'duplicates', 'cursor_before', 'cursor_after', 'committed_at', 'error', 'state', 'reason', 'next_attempt_at']));
        } elseif ($v['kind'] === 'failure') {
            abort_unless(in_array($v['reason'] ?? null, ['decode_failed', 'validation_failed'], true), 422);
            app(AdapterReports::class)->failure($adapter, $r->only(['report_id', 'reason', 'error', 'source', 'received_at', 'input', 'delivery_id']));
        } elseif ($v['kind'] === 'outcomes') {
            app(AdapterDiagnostics::class)->addCounts($adapter, 'runtime:'.$v['report_id'], $v['bucket'], array_map('intval', array_filter($v['counts'], 'is_numeric')));
        } else {
            $adapter->update(['diagnostic' => 'A message failed decoding or profile validation. Test a representative sample to inspect the error.']);
        }

        return response()->noContent();
    }
}
