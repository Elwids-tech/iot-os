<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Http;

use App\Domain\DeviceAdapters\Models\AdapterConnection;
use App\Domain\DeviceAdapters\Services\Connections;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * OPC UA connections and browsing (spec 038, US2; contracts/api.md). Every route needs
 * Device.manage in the organization; another organization's connection is a 404.
 * Secrets are write-only.
 */
final class AdapterConnectionController
{
    private const SECRETS = ['username', 'password', 'user_certificate', 'user_private_key'];

    public function __construct(private readonly Connections $connections, private readonly DeviceAuthorization $authorization) {}

    private function authorize(Request $r, Organization $organization, ?AdapterConnection $connection = null): void
    {
        abort_unless(config('adapters.enabled'), 404);
        $this->authorization->authorize($r->user(), DevicePermission::MANAGE, $organization, $connection);
    }

    private function settings(Request $r): array
    {
        return $r->only(['name', 'endpoint_url', 'security_policy', 'security_mode', 'unencrypted_confirmed', 'identity', ...self::SECRETS]);
    }

    public function index(Request $r, Organization $organization): array
    {
        $this->authorize($r, $organization);

        return ['data' => AdapterConnection::where('organization_id', $organization->id)->orderBy('name')->get()->map->view()->values()];
    }

    public function store(Request $r, Organization $organization)
    {
        $this->authorize($r, $organization);

        return response()->json(['data' => $this->connections->create($organization, $this->settings($r), $r->user())->view()], 201);
    }

    public function show(Request $r, Organization $organization, AdapterConnection $connection): array
    {
        $this->authorize($r, $organization, $connection);

        return ['data' => $connection->view()];
    }

    public function update(Request $r, Organization $organization, AdapterConnection $connection): array
    {
        $this->authorize($r, $organization, $connection);

        return ['data' => $this->connections->update($connection, $this->settings($r), $r->user())->view()];
    }

    public function destroy(Request $r, Organization $organization, AdapterConnection $connection): Response
    {
        $this->authorize($r, $organization, $connection);
        $this->connections->delete($connection, $r->user());

        return response()->noContent();
    }

    public function endpoints(Request $r, Organization $organization, AdapterConnection $connection): array
    {
        $this->authorize($r, $organization, $connection);

        return ['data' => $this->connections->endpoints($connection)];
    }

    public function acceptCertificate(Request $r, Organization $organization, AdapterConnection $connection): array
    {
        $this->authorize($r, $organization, $connection);
        $fingerprint = $r->validate(['fingerprint' => 'required|string|max:200'])['fingerprint'];

        return ['data' => $this->connections->acceptCertificate($connection, $fingerprint, $r->user())->view()];
    }

    /** The platform's certificate for this connection, to add to the server's trusted list. */
    public function clientCertificate(Request $r, Organization $organization, AdapterConnection $connection): Response
    {
        $this->authorize($r, $organization, $connection);
        $format = $r->validate(['format' => 'sometimes|in:pem,der'])['format'] ?? 'der';
        $pem = $connection->client_certificate;
        $name = 'iot-os-'.substr($connection->uuid, 0, 8);
        if ($format === 'pem') {
            return response($pem, 200, ['Content-Type' => 'application/x-pem-file', 'Content-Disposition' => "attachment; filename=\"{$name}.pem\""]);
        }
        $der = base64_decode(preg_replace('/-----[^-]+-----|\s+/', '', $pem));

        return response($der, 200, ['Content-Type' => 'application/pkix-cert', 'Content-Disposition' => "attachment; filename=\"{$name}.der\""]);
    }

    public function test(Request $r, Organization $organization, AdapterConnection $connection): array
    {
        $this->authorize($r, $organization, $connection);

        return ['data' => $this->connections->test($connection)];
    }

    public function pause(Request $r, Organization $organization, AdapterConnection $connection): array
    {
        $this->authorize($r, $organization, $connection);

        return ['data' => $this->connections->pause($connection, $r->user())->view()];
    }

    public function resume(Request $r, Organization $organization, AdapterConnection $connection): array
    {
        $this->authorize($r, $organization, $connection);

        return ['data' => $this->connections->resume($connection, $r->user())->view()];
    }

    // Browsing --------------------------------------------------------------------------

    public function nodes(Request $r, Organization $organization, AdapterConnection $connection): array
    {
        $this->authorize($r, $organization, $connection);
        $v = $r->validate(['parent' => 'sometimes|nullable|string|max:4200', 'cursor' => 'sometimes|nullable|string|max:4096']);

        return ['data' => $this->connections->browse($connection, self::address($v['parent'] ?? null), $v['cursor'] ?? null)];
    }

    public function read(Request $r, Organization $organization, AdapterConnection $connection): array
    {
        $this->authorize($r, $organization, $connection);
        $v = $r->validate(['nodes' => 'required|array|min:1|max:200', 'nodes.*' => 'required|string|max:4200']);

        return ['data' => $this->connections->read($connection, array_map(fn ($node) => self::address($node), $v['nodes']))];
    }

    public function search(Request $r, Organization $organization, AdapterConnection $connection): array
    {
        $this->authorize($r, $organization, $connection);
        $v = $r->validate(['text' => 'required|string|min:1|max:120', 'root' => 'sometimes|nullable|string|max:4200']);

        return ['data' => $this->connections->search($connection, self::address($v['root'] ?? null), $v['text'])];
    }

    /**
     * A node in OPC UA's expanded notation with a namespace URI ("nsu=<uri>;s=L03-VAV-2"),
     * as the API names nodes; null for the Objects folder.
     *
     * @return array{node_id: string, namespace_uri: string}|null
     */
    public static function address(?string $node): ?array
    {
        if ($node === null || $node === '') {
            return null;
        }
        abort_unless(preg_match('/^nsu=([^;]+);((?:i|s|g|b)=.+)$/s', $node, $m) === 1, 422, 'Name nodes as nsu=<namespace URI>;<node id>, for example nsu=urn:example:bms;s=L03-VAV-2.');

        return ['node_id' => $m[2], 'namespace_uri' => $m[1]];
    }
}
