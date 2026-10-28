<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Http;

use App\Domain\DeviceAdapters\Models\AdapterDelivery;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\WebhookSecret;
use App\Domain\DeviceAdapters\Services\AdapterDiagnostics;
use App\Domain\DeviceAdapters\Services\AdapterReports;
use App\Domain\DeviceAdapters\Services\WebhookRoutes;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;

/** Webhook secrets, captured deliveries and the receiver's reports (spec 020). */
final class WebhookController
{
    public function __construct(private readonly WebhookRoutes $routes, private readonly DeviceAuthorization $authorization) {}

    private function authorize(Request $r, Organization $organization, DeviceAdapter $adapter, DevicePermission $permission): void
    {
        abort_unless(config('adapters.enabled'), 404);
        $this->authorization->authorize($r->user(), $permission, $organization, $adapter);
    }

    public function show(Request $r, Organization $organization, DeviceAdapter $adapter): array
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::VIEW);
        abort_unless(($adapter->source['type'] ?? null) === 'webhook', 404);
        $webhook = app(AdapterDiagnostics::class)->webhook($adapter);

        return ['data' => ['ingest_url' => $webhook['ingest_url'], 'auth' => $adapter->source['auth'], 'state' => $webhook['state'],
            'secrets' => WebhookSecret::with('creator')->where('device_adapter_id', $adapter->id)->latest()->limit(20)->get()->map(fn (WebhookSecret $s) => $s->view()), 'counts' => array_map(fn ($c) => (object) $c, app(AdapterDiagnostics::class)->counts($adapter))]];
    }

    public function create(Request $r, Organization $organization, DeviceAdapter $adapter)
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::CONNECTIONS);
        $v = $r->validate(['label' => 'required|string|max:80', 'value' => 'nullable|string|min:16|max:512']);
        try {
            [$secret, $value] = $this->routes->create($adapter, $v['label'], $v['value'] ?? null, $r->user()->id);
        } catch (HttpException $e) {
            throw $e->getStatusCode() === 503 ? $this->unconfirmed($adapter) : $e;
        }
        $url = ($adapter->source['auth']['mode'] ?? null) === 'url' ? $this->routes->url($adapter, $value ?? $secret->secret) : $this->routes->url($adapter);

        return response()->json(['data' => ['secret' => $secret->load('creator')->view(), 'value' => $value, 'ingest_url' => $url]], 201)->withHeaders(['Cache-Control' => 'no-store, private']);
    }

    public function revoke(Request $r, Organization $organization, DeviceAdapter $adapter, WebhookSecret $secret): array
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::CONNECTIONS);
        try {
            $this->routes->revoke($adapter, $secret, $r->user()->id);
        } catch (HttpException $e) {
            throw $e->getStatusCode() === 503 ? $this->unconfirmed($adapter) : $e;
        }

        return ['data' => ['revoked' => true]];
    }

    public function deliveries(Request $r, Organization $organization, DeviceAdapter $adapter): array
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::VIEW);
        $kind = $r->validate(['kind' => 'nullable|in:sample,rejected,failed'])['kind'] ?? null;
        $kinds = $kind ? [$kind] : ['sample', 'rejected', 'failed'];
        $rows = collect($kinds)->flatMap(fn ($k) => AdapterDelivery::where('device_adapter_id', $adapter->id)->where('kind', $k)->where('received_at', '>=', now()->subDays(7))->latest('received_at')->limit(20)->get())
            ->sortByDesc('received_at')->values();

        return ['data' => $rows->map(fn (AdapterDelivery $d) => $d->view())];
    }

    /** `POST /api/internal/adapters/receiver-reports`, authenticated with the receiver's token. */
    public function reports(Request $r)
    {
        $token = (string) config('adapters.receiver_token');
        abort_unless(config('adapters.enabled') && strlen($token) >= 32 && strlen($r->getContent()) <= 8 * 1024 * 1024, 404);
        abort_unless(hash_equals($token, $r->bearerToken() ?? ''), 401);
        $v = $r->validate(['schema_version' => 'required|in:receiver-report.v1', 'report_id' => 'required|string|max:64', 'reports' => 'present|array|max:1000', 'reports.*.adapter_uuid' => 'required|uuid',
            'reports.*.outcomes' => 'present|array', 'reports.*.secrets_used' => 'present|array', 'reports.*.rejections' => 'present|array|max:100', 'reports.*.samples' => 'present|array|max:100',
            'reports.*.rejections.*.reason' => 'required|in:unauthenticated,stale_signature,too_large,rate_limited,paused,broker_unavailable,bad_request', 'reports.*.rejections.*.at' => 'required|date',
            'reports.*.samples.*.at' => 'required|date', 'reports.*.samples.*.body_base64' => 'required|string|max:90000']);
        app(AdapterReports::class)->receiver(array_merge($v, ['reports' => $r->input('reports')]));

        return response()->noContent();
    }

    private function unconfirmed(DeviceAdapter $adapter): HttpException
    {
        $this->routes->syncLater($adapter);

        return new HttpException(503, 'Saved, but the webhook receiver has not confirmed the change yet. It is retried automatically.');
    }
}
