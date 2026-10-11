<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Integrations\Models\Webhook;
use App\Domain\Integrations\Models\WebhookDelivery;
use App\Domain\Integrations\Services\WebhookDestination;
use App\Domain\Integrations\Services\WebhookDispatch;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class WebhookController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    private function authorize(Request $request, Organization $org, IntegrationApplication $app): void
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $org, $app);
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $org);
    }

    public function show(Request $request, Organization $organization, IntegrationApplication $application): array
    {
        $this->authorize($request, $organization, $application);
        $hook = Webhook::where('integration_application_id', $application->id)->first();

        return ['data' => $hook ? $this->view($hook) : null];
    }

    public function configure(Request $request, Organization $organization, IntegrationApplication $application)
    {
        $this->authorize($request, $organization, $application);
        $input = $request->validate(['revision' => 'required|integer|min:0', 'url' => 'required|string|max:2048']);
        try {
            app(WebhookDestination::class)->target($input['url']);
        } catch (\InvalidArgumentException $error) {
            abort(422, $error->getMessage());
        }
        $data = DB::transaction(function () use ($application, $input, $request) {
            $app = IntegrationApplication::whereKey($application->id)->lockForUpdate()->firstOrFail();
            abort_if($app->revoked_at || array_diff(['events:read', 'alerts:read'], $app->abilities), 409, 'Application must grant event and alert access.');
            $hook = Webhook::where('integration_application_id', $app->id)->lockForUpdate()->first();
            abort_unless(($hook?->revision ?? 0) === (int) $input['revision'], 409, 'Webhook changed. Reload before saving.');
            WebhookDispatch::cancel($app->id, 'Webhook was reconfigured.');
            $secret = 'whsec_'.bin2hex(random_bytes(32));
            $values = ['url' => $input['url'], 'secret' => $secret, 'enabled' => true, 'grant_revision' => $app->grant_revision, 'revision' => ($hook?->revision ?? 0) + 1, 'cursor' => (int) DB::table('integration_streams')->where('organization_id', $app->organization_id)->value('sequence'), 'diagnostic' => null, 'next_dispatch_at' => null];
            if ($hook) {
                $hook->update($values);
            } else {
                $hook = Webhook::create(['integration_application_id' => $app->id, ...$values]);
            }
            DeviceAudit::record('webhook.configured', $app->organization_id, $request->user()->id, $hook->uuid, ['revision' => $hook->revision]);

            return [...$this->view($hook->fresh()), 'signing_secret' => $secret];
        });

        return response()->json(['data' => $data])->header('Cache-Control', 'no-store');
    }

    public function disable(Request $request, Organization $organization, IntegrationApplication $application): array
    {
        $this->authorize($request, $organization, $application);
        $input = $request->validate(['revision' => 'required|integer|min:1']);
        DB::transaction(function () use ($application, $input, $request): void {
            $app = IntegrationApplication::whereKey($application->id)->lockForUpdate()->firstOrFail();
            $hook = Webhook::where('integration_application_id', $app->id)->lockForUpdate()->firstOrFail();
            abort_unless($hook->revision === (int) $input['revision'], 409, 'Webhook changed.');
            WebhookDispatch::cancel($app->id, 'Webhook disabled.');
            $hook->update(['revision' => $hook->revision + 1]);
            DeviceAudit::record('webhook.disabled', $app->organization_id, $request->user()->id, $hook->uuid);
        });

        return $this->show($request, $organization, $application);
    }

    public function deliveries(Request $request, Organization $organization, IntegrationApplication $application): array
    {
        $this->authorize($request, $organization, $application);
        $request->validate(['page' => 'sometimes|integer|min:1']);
        $hook = Webhook::where('integration_application_id', $application->id)->firstOrFail();
        $page = WebhookDelivery::where('integration_webhook_id', $hook->id)->orderByDesc('id')->paginate(25);

        return ['data' => $page->getCollection()->map(fn ($row) => [...$row->only(['uuid', 'status', 'attempts', 'retry_revision', 'diagnostic', 'next_attempt_at', 'expires_at', 'delivered_at']), 'history' => DB::table('integration_webhook_attempts')->where('integration_webhook_delivery_id', $row->id)->orderBy('attempt')->get(['attempt', 'http_status', 'outcome', 'created_at'])]), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    public function retry(Request $request, Organization $organization, IntegrationApplication $application, string $delivery)
    {
        $this->authorize($request, $organization, $application);
        $input = $request->validate(['retry_revision' => 'required|integer|min:0']);
        DB::transaction(function () use ($application, $input, $delivery, $request): void {
            $app = IntegrationApplication::whereKey($application->id)->lockForUpdate()->firstOrFail();
            $hook = Webhook::where('integration_application_id', $app->id)->lockForUpdate()->firstOrFail();
            abort_if($app->revoked_at || ! $hook->enabled || $hook->grant_revision !== $app->grant_revision, 409, 'Webhook is not active under current grants.');
            $record = WebhookDelivery::where('integration_webhook_id', $hook->id)->where('uuid', $delivery)->lockForUpdate()->firstOrFail();
            abort_unless($record->status === 'failed' && $record->retry_revision === (int) $input['retry_revision'] && $record->webhook_revision === $hook->revision, 409, 'Delivery changed or belongs to an old endpoint revision.');
            $record->update(['status' => 'pending', 'attempt_limit' => $record->attempts + 5, 'retry_revision' => $record->retry_revision + 1, 'next_attempt_at' => now(), 'expires_at' => now()->addDay(), 'diagnostic' => null]);
            DeviceAudit::record('webhook.delivery_retried', $app->organization_id, $request->user()->id, $record->uuid, ['retry_revision' => $record->retry_revision]);
        });

        return response()->json(['data' => ['status' => 'pending']], 202);
    }

    private function view(Webhook $hook): array
    {
        return $hook->only(['uuid', 'url', 'revision', 'enabled', 'diagnostic', 'grant_revision']);
    }
}
