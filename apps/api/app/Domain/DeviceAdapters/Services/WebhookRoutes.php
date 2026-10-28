<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Services;

use App\Domain\DeviceAdapters\Jobs\SyncWebhookRoute;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\WebhookSecret;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Webhook ingest URLs and secrets (spec 020, FR-010 to FR-020). Laravel owns them and
 * pushes every change to the receiver's routing file through adapter-manager
 * (ADR-022), so deliveries never pass through Laravel.
 */
final class WebhookRoutes
{
    public function available(): bool
    {
        return filled(config('adapters.webhook_public_url'));
    }

    public function url(DeviceAdapter $adapter, ?string $token = null): ?string
    {
        if (! $adapter->ingest_id || ! $this->available()) {
            return null;
        }

        return rtrim((string) config('adapters.webhook_public_url'), '/').'/w/'.$adapter->ingest_id.($token ? '/'.$token : '');
    }

    /** What the receiver does with deliveries: sample before deployment, hand off while running. */
    public function state(DeviceAdapter $adapter): string
    {
        $applied = $adapter->applied_revision_uuid ? $adapter->revisions()->where('uuid', $adapter->applied_revision_uuid)->first() : null;
        $appliedWebhook = ($applied?->definition['source']['type'] ?? null) === 'webhook';
        if ($appliedWebhook && $adapter->status === 'paused') {
            return 'paused';
        }
        if ($appliedWebhook) {
            return 'running';
        }

        return ($adapter->source['type'] ?? null) === 'webhook' ? 'sampling' : 'removed';
    }

    public function sync(DeviceAdapter $adapter): void
    {
        if (! $adapter->ingest_id) {
            return;
        }
        $state = $this->state($adapter);
        $service = app(AdapterService::class);
        $tenant = $service->tenant(Organization::findOrFail($adapter->organization_id));
        $applied = $state === 'running' || $state === 'paused' ? $adapter->revisions()->where('uuid', $adapter->applied_revision_uuid)->first() : null;
        $auth = ($applied?->definition['source'] ?? $adapter->source)['auth'] ?? ['mode' => 'hmac'];
        $secrets = $state === 'removed' ? [] : WebhookSecret::where('device_adapter_id', $adapter->id)->active()->oldest()->limit(2)->get()
            ->map(fn (WebhookSecret $s) => ['uuid' => $s->uuid, 'value' => $s->secret, 'expires_at' => $s->expires_at?->toIso8601String()])->all();
        app(AdapterManager::class)->request('/webhook', ['tenant' => $service->tenantPayload($tenant), 'adapter_uuid' => $adapter->uuid, 'ingest_id' => $adapter->ingest_id, 'state' => $state, 'auth' => $auth, 'secrets' => $secrets]);
        if ($state === 'removed') {
            WebhookSecret::where('device_adapter_id', $adapter->id)->whereNull('revoked_at')->update(['revoked_at' => now()]);
        }
    }

    public function syncLater(DeviceAdapter $adapter): void
    {
        SyncWebhookRoute::dispatch($adapter->id)->afterCommit();
    }

    /**
     * Creates a generated secret (shown once) or stores a vendor-issued signing secret.
     * With one active secret, the new one is a rotation: the old one keeps working for
     * 7 days or until it is revoked (FR-014).
     *
     * @return array{0: WebhookSecret, 1: ?string}
     */
    public function create(DeviceAdapter $adapter, string $label, ?string $value, int $actor): array
    {
        abort_unless(($adapter->source['type'] ?? null) === 'webhook' && $adapter->ingest_id, 422, 'Save the adapter as a webhook source first.');
        $mode = $adapter->source['auth']['mode'] ?? 'hmac';
        abort_if($value !== null && $mode !== 'hmac', 422, 'Only HMAC signatures can use a secret issued by the vendor.');
        abort_if($value !== null && mb_strlen($value) < 16, 422, 'A vendor signing secret needs at least 16 characters.');
        $generated = $value === null ? rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=') : null;
        [$secret, $rotated] = DB::transaction(function () use ($adapter, $label, $value, $generated, $actor) {
            DeviceAdapter::whereKey($adapter->id)->lockForUpdate()->firstOrFail();
            $active = WebhookSecret::where('device_adapter_id', $adapter->id)->active()->get();
            abort_if($active->count() >= 2, 422, 'Two secrets are active. Revoke one before creating another.');
            $active->whereNull('expires_at')->each->update(['expires_at' => now()->addDays(7)]);
            $secret = WebhookSecret::create(['organization_id' => $adapter->organization_id, 'device_adapter_id' => $adapter->id, 'label' => $label, 'origin' => $value === null ? 'generated' : 'vendor', 'secret' => $value ?? $generated, 'created_by' => $actor]);

            return [$secret, $active->isNotEmpty()];
        });
        DeviceAudit::record('device.adapter.webhook_secret.'.($rotated ? 'rotated' : 'created'), $adapter->organization_id, $actor, $adapter->uuid, ['secret_uuid' => $secret->uuid, 'label' => $label, 'origin' => $secret->origin]);
        $this->sync($adapter->fresh());

        return [$secret->fresh(), $generated];
    }

    public function revoke(DeviceAdapter $adapter, WebhookSecret $secret, int $actor): void
    {
        abort_unless($secret->device_adapter_id === $adapter->id, 404);
        if (! $secret->revoked_at) {
            $secret->update(['revoked_at' => now()]);
            DeviceAudit::record('device.adapter.webhook_secret.revoked', $adapter->organization_id, $actor, $adapter->uuid, ['secret_uuid' => $secret->uuid, 'label' => $secret->label]);
        }
        $this->sync($adapter->fresh());
    }

    public static function newIngestId(): string
    {
        return Str::random(32);
    }
}
