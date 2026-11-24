<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Tools;

use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\Assistant\Services\AssistantAccess;
use App\Domain\Assistant\Services\WorkflowProposalService;
use App\Domain\Automation\Http\Controllers\DagController;
use App\Domain\Connectivity\Services\ConnectivityState;
use App\Domain\Geospatial\Http\GeofenceController;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Http\Request as HttpRequest;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

final class WorkflowAssistantTools implements Tool
{
    public function __construct(private readonly AssistantRun $run) {}

    public function description(): string
    {
        return 'Automation draft tools: discover {device_search?:string,control_search?:string,geofence_search?:string} fetches schema and named resources in ONE call; prefer it when building a workflow. schema {}, find_devices {search?:string,page?:integer,controllable?:boolean,device_uuid?:uuid}, find_geofences {search?:string,page?:integer}, preview_workflow {summary:string,workflow:object}. Searches use the same organization and permissions as the editor; pagination metadata indicates more results. No tool saves or activates a workflow or sends device commands.';
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['discover', 'schema', 'find_devices', 'find_geofences', 'preview_workflow'])->required(),
            'arguments_json' => $schema->string()->description('JSON object with arguments for the selected action.')->required(),
        ];
    }

    public function handle(Request $request): Stringable|string
    {
        try {
            $run = $this->run->fresh();
            abort_unless($run?->status === 'running', 409, 'This response is no longer active.');
            $conversation = $run->conversation;
            app(AssistantAccess::class)->conversation($conversation->user, $conversation->organization, $conversation);
            abort_unless($conversation->scope === 'automation', 422);
            abort_if(strlen($request['arguments_json']) > 262144, 422, 'Tool arguments are too large.');
            $arguments = json_decode($request['arguments_json'], true, 64, JSON_THROW_ON_ERROR);
            abort_unless(is_array($arguments), 422);
            $http = HttpRequest::create('/', 'GET', $arguments);
            $http->setUserResolver(fn () => $conversation->user);
            // Both the portal and the assistant use the same authorized resource projections.
            // Pass the requested page explicitly: paginator's global HTTP request is absent in a worker.
            $result = match ($request['action']) {
                'discover' => $this->discover($http, $conversation->organization, $arguments),
                'schema' => $this->descriptionData($http, $conversation->organization),
                'find_devices' => $this->devices($http, $conversation->organization),
                'find_geofences' => app(GeofenceController::class)->index($http, $conversation->organization),
                'preview_workflow' => app(WorkflowProposalService::class)->preview($conversation, $arguments, $run)->only(['id', 'summary', 'diagnostics']),
            };
            $encoded = json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
            if (strlen($encoded) > config('assistant.max_context_characters')) {
                return json_encode(['error' => 'Too many resource details. Search for one specific device or geofence by name.']);
            }

            return $encoded;
        } catch (Throwable $e) {
            // The model corrects refusals itself; logging them makes repeated ones diagnosable.
            Log::info('Automation assistant tool refused', ['run' => $this->run->id, 'action' => $request['action'] ?? null, 'errors' => $e instanceof ValidationException ? $e->errors() : $e->getMessage()]);

            return json_encode(['error' => 'The automation operation was not completed.', 'details' => $e instanceof ValidationException ? $e->errors() : [], 'reason' => $e instanceof HttpExceptionInterface ? $e->getMessage() : null], JSON_THROW_ON_ERROR);
        }
    }

    private function descriptionData(HttpRequest $http, Organization $organization): array
    {
        return [
            ...app(DagController::class)->registry($http, $organization),
            'multi_setting_command_example' => [
                'id' => 'alarm', 'type' => 'action.command.v1',
                'config' => ['settings' => ['alarm_enabled' => true, 'alarm_volume' => 20], 'cooldown_seconds' => 60, 'ttl_seconds' => 30],
            ],
            'command_rules' => 'The example settings keys alarm_enabled and alarm_volume are binding roles, NOT parameter keys or UUIDs. Include one graph.bindings entry for each setting role using the selected device and parameter UUID. config.settings is a JSON object of role:scalar_value, never an array or a JSON string. In a multi-setting node, OMIT config.binding and config.value entirely, even null or empty values. All selected settings must belong to one device. Legacy nodes may use binding/value instead of settings, never both.',
        ];
    }

    private function discover(HttpRequest $request, Organization $organization, array $arguments): array
    {
        validator($arguments, [
            'device_search' => 'sometimes|string|min:1|max:255',
            'control_search' => 'sometimes|string|min:1|max:255',
            'geofence_search' => 'sometimes|string|min:1|max:255',
        ])->validate();
        $result = ['schema' => $this->descriptionData($request, $organization)];
        foreach (['device_search' => 'devices', 'control_search' => 'controllable_devices', 'geofence_search' => 'geofences'] as $key => $name) {
            if (! isset($arguments[$key])) {
                continue;
            }
            $scoped = HttpRequest::create('/', 'GET', ['search' => $arguments[$key], 'controllable' => $key === 'control_search']);
            $scoped->setUserResolver(fn () => $request->user());
            $result[$name] = $key === 'geofence_search'
                ? app(GeofenceController::class)->index($scoped, $organization)
                : $this->devices($scoped, $organization);
        }

        return $result;
    }

    /** A binding's freshness when nothing about the device says more, as in the editor. */
    private const DEFAULT_FRESH_SECONDS = 120;

    private const MAX_FRESH_SECONDS = 86400;

    /** A reading that arrives later than this is history being replayed, not the device's rhythm. */
    private const MAX_DELIVERY_DELAY_SECONDS = 3600;

    /**
     * The editor's devices, with what the assistant needs to size a binding's freshness:
     * the device's poll interval, its learned reporting interval and how late its last
     * reading arrived, and for each parameter the freshness those add up to.
     */
    private function devices(HttpRequest $request, Organization $organization): array
    {
        $result = app(DagController::class)->resources($request, $organization);
        $reported = app(ConnectivityState::class)->reported($organization, $result['data']->pluck('device_uuid')->all());
        $result['data'] = $result['data']->map(function ($device) use ($reported) {
            $state = $reported[$device['device_uuid']] ?? [];
            $device['reporting_interval_seconds'] = isset($state['reporting_interval_seconds']) ? (int) $state['reporting_interval_seconds'] : null;
            $device['delivery_delay_seconds'] = $this->deliveryDelay($state);
            // Freshness counts from the observed time, so a reading must outlive its own
            // trip to the runtime and then last until the next one: two of each gap.
            $rhythm = 2 * max((int) $device['poll_interval_seconds'], (int) $device['reporting_interval_seconds'], (int) $device['delivery_delay_seconds']);
            $device['parameters'] = collect($device['parameters'])->map(function ($parameter) use ($rhythm) {
                $staleAfter = (int) ($parameter['reporting']['stale_after_seconds'] ?? 0);

                return [
                    ...Arr::only($parameter, ['uuid', 'key', 'label', 'kind', 'data_type', 'unit', 'accepts_command', 'reports_state', 'format', 'validation']),
                    'suggested_fresh_seconds' => min(self::MAX_FRESH_SECONDS, max(self::DEFAULT_FRESH_SECONDS, $staleAfter, $rhythm)),
                    'fresh_seconds_basis' => match (true) {
                        $rhythm > 0 => 'device',
                        $staleAfter > 0 => 'profile',
                        default => 'unknown',
                    },
                ];
            })->all();

            return $device;
        })->all();

        return $result;
    }

    /**
     * How long after it was observed the device's newest reading reached the runtime;
     * null when that is unknown or longer than an hour (a kept or replayed reading).
     */
    private function deliveryDelay(array $state): ?int
    {
        if (! isset($state['last_heard_at'], $state['last_observed_at'])) {
            return null;
        }
        try {
            $delay = max(0, (int) CarbonImmutable::parse($state['last_observed_at'])->diffInSeconds(CarbonImmutable::parse($state['last_heard_at']), false));

            return $delay > self::MAX_DELIVERY_DELAY_SECONDS ? null : $delay;
        } catch (Throwable) {
            return null;
        }
    }
}
