<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\DeviceAdapters\Models\AdapterConnection;
use App\Domain\DeviceAdapters\Models\AdapterTenant;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * OPC UA connections (spec 038, US2): saving them, the platform's certificate for each,
 * trusting the server's certificate, testing, pausing, and browsing through the adapter
 * manager. Secrets are write-only: a change that leaves one out keeps the stored value.
 */
final class Connections
{
    /** Never reachable from a tenant, whatever ranges it is allowed (research R10). */
    public const NEVER = ['0.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '100.100.100.200/32', '224.0.0.0/3', '::/128', '::1/128', 'fe80::/10', 'fd00:ec2::254/128', 'ff00::/8'];

    private const CERTIFICATE_DAYS = 1826; // five years

    public function __construct(private readonly AdapterManager $manager) {}

    // Saving ---------------------------------------------------------------------------

    public function create(Organization $organization, array $input, User $actor): AdapterConnection
    {
        $v = $this->validate($organization, $input);
        abort_if(AdapterConnection::where('organization_id', $organization->id)->count() >= config('adapters.opcua.max_connections'), 422,
            'This organization has reached its limit of '.config('adapters.opcua.max_connections').' OPC UA connections.');
        $this->refuseDuplicate($organization, $v);

        return DB::transaction(function () use ($organization, $v, $actor): AdapterConnection {
            $connection = new AdapterConnection(['uuid' => (string) Str::uuid(), 'organization_id' => $organization->id, 'protocol' => 'opcua']);
            [$certificate, $key, $expires] = $this->platformCertificate($organization, $connection->uuid);
            $connection->fill([
                'name' => $v['name'],
                'endpoint_url' => $v['endpoint_url'],
                'runs_at' => 'platform',
                'security_policy' => $v['security_policy'],
                'security_mode' => $v['security_mode'],
                'unencrypted_confirmed_by' => $v['security_policy'] === 'None' ? $actor->id : null,
                'identity' => $v['identity'],
                'secrets' => $this->secrets([], $v) + ['client_private_key' => $key],
                'client_certificate' => $certificate,
                'client_certificate_expires_at' => $expires,
                'state' => 'draft',
                'created_by' => $actor->id,
                'updated_by' => $actor->id,
            ])->save();
            $this->audit('created', $connection, $actor, $this->settings($connection));

            return $connection;
        });
    }

    public function update(AdapterConnection $connection, array $input, User $actor): AdapterConnection
    {
        $organization = Organization::findOrFail($connection->organization_id);
        $v = $this->validate($organization, $input + $connection->only(['name', 'endpoint_url', 'security_policy', 'security_mode', 'identity']), $connection);
        $this->refuseDuplicate($organization, $v, $connection);
        $before = $this->settings($connection);
        $credentialsChanged = collect(['username', 'password', 'user_certificate', 'user_private_key'])->contains(fn ($k) => array_key_exists($k, $input));
        $connection->fill([
            'name' => $v['name'],
            'endpoint_url' => $v['endpoint_url'],
            'security_policy' => $v['security_policy'],
            'security_mode' => $v['security_mode'],
            'identity' => $v['identity'],
            'secrets' => $this->secrets($connection->secrets ?? [], $v),
            'updated_by' => $actor->id,
        ]);
        if ($connection->isDirty('security_policy') && $v['security_policy'] === 'None') {
            $connection->unencrypted_confirmed_by = $actor->id;
        }
        if ($connection->isDirty('endpoint_url')) {
            // Another server: its certificate is reviewed again.
            $connection->server_certificate = null;
            $connection->pending_server_certificate = null;
        }
        $changed = $connection->isDirty(['endpoint_url', 'security_policy', 'security_mode', 'identity']);
        if ($changed || $credentialsChanged) {
            $connection->state = $connection->state === 'paused' ? 'paused' : 'draft';
        }
        $connection->save();
        $after = $this->settings($connection);
        if ($before !== $after) {
            $this->audit('changed', $connection, $actor, ['before' => $before, 'after' => $after]);
        }
        if ($credentialsChanged) {
            $this->audit('credentials_changed', $connection, $actor, ['identity' => $connection->identity]);
        }

        return $connection;
    }

    public function delete(AdapterConnection $connection, User $actor): void
    {
        abort_if(DeviceAdapter::where('adapter_connection_id', $connection->id)->exists(), 409, 'A data source reads through this connection. Remove the data source first.');
        $this->audit('deleted', $connection, $actor, $this->settings($connection));
        $connection->delete();
    }

    public function pause(AdapterConnection $connection, User $actor): AdapterConnection
    {
        $connection->update(['state' => 'paused', 'updated_by' => $actor->id]);
        $this->audit('paused', $connection, $actor);

        return $connection;
    }

    public function resume(AdapterConnection $connection, User $actor): AdapterConnection
    {
        abort_unless($connection->state === 'paused', 409, 'The connection is not paused.');
        $connection->update(['state' => 'draft', 'updated_by' => $actor->id]);
        $this->audit('resumed', $connection, $actor);

        return $connection;
    }

    // The server's certificate ------------------------------------------------------------

    /** What the server offers; a certificate not yet accepted waits for review. */
    public function endpoints(AdapterConnection $connection): array
    {
        $offered = $this->call('/opcua/endpoints', $connection)['endpoints'] ?? [];
        $chosen = collect($offered)->first(fn ($e) => $e['policy'] === $connection->security_policy && $e['mode'] === $connection->security_mode)
            ?? collect($offered)->first(fn ($e) => ! ($e['refused'] ?? null) && filled($e['server_certificate'] ?? null));
        $presented = $chosen['server_certificate'] ?? null;
        if ($presented && ($connection->server_certificate['fingerprint'] ?? null) !== $presented['fingerprint']) {
            $connection->pending_server_certificate = $presented;
            if ($connection->encrypted() && $connection->state !== 'paused') {
                $connection->state = $connection->server_certificate ? 'stopped' : 'awaiting_trust';
            }
            $connection->save();
        }

        return ['endpoints' => array_map(fn ($e) => array_merge($e, ['server_certificate' => $this->certificateView($e['server_certificate'] ?? null)]), $offered), 'connection' => $connection->view()];
    }

    public function acceptCertificate(AdapterConnection $connection, string $fingerprint, User $actor): AdapterConnection
    {
        $pending = $connection->pending_server_certificate;
        abort_unless($pending && hash_equals($pending['fingerprint'], strtolower(str_replace(':', '', $fingerprint))), 409, 'That is not the certificate waiting for review. Ask the server again.');
        $connection->server_certificate = $pending + ['accepted_by' => $actor->id, 'accepted_at' => now()->toIso8601String()];
        $connection->pending_server_certificate = null;
        if (in_array($connection->state, ['awaiting_trust', 'stopped'], true)) {
            $connection->state = 'draft';
        }
        $connection->updated_by = $actor->id;
        $connection->save();
        $this->audit('server_certificate_accepted', $connection, $actor, ['fingerprint' => $pending['fingerprint'], 'subject' => $pending['subject'] ?? null]);

        return $connection;
    }

    // Testing and browsing ------------------------------------------------------------------

    /** Connect and sign in once: `connected`, or one reason with its fix. */
    public function test(AdapterConnection $connection): array
    {
        abort_if($connection->state === 'paused', 409, 'Resume the connection before testing it.');
        $result = $this->manager->request('/opcua/test', $this->payload($connection));
        $now = now()->toIso8601String();
        if ($result['connected'] ?? false) {
            $connection->state = 'connected';
            $connection->status = ['since' => $now, 'reason' => null, 'security' => $result['security'] ?? null,
                'limits' => $result['limits'] ?? null, 'clock_difference_ms' => $result['clock_difference_ms'] ?? null, 'checked_at' => $now];
        } else {
            $reason = $result['reason'] ?? 'unreachable';
            if ($reason === 'server_certificate_changed' && filled($result['server_certificate'] ?? null)) {
                $connection->pending_server_certificate = $result['server_certificate'];
            }
            $connection->state = $reason === 'server_certificate_changed' ? 'stopped' : 'unreachable';
            $problems = array_slice(array_merge([['at' => $now, 'reason' => $reason]], $connection->status['problems'] ?? []), 0, 10);
            $connection->status = ['since' => $now, 'reason' => $reason, 'message' => $result['message'] ?? null, 'fix' => $result['fix'] ?? null, 'checked_at' => $now, 'problems' => $problems];
        }
        $connection->save();

        return ['connected' => (bool) ($result['connected'] ?? false)] + array_intersect_key($result, array_flip(['reason', 'message', 'fix', 'limits', 'clock_difference_ms', 'security'])) + ['connection' => $connection->view()];
    }

    public function browse(AdapterConnection $connection, ?array $parent, ?string $cursor): array
    {
        return $this->call('/opcua/browse', $connection, ['parent' => $parent, 'cursor' => $cursor]);
    }

    public function read(AdapterConnection $connection, array $points): array
    {
        return $this->call('/opcua/read', $connection, ['points' => $points]);
    }

    public function search(AdapterConnection $connection, ?array $root, string $text): array
    {
        return $this->call('/opcua/search', $connection, ['root' => $root, 'text' => $text]);
    }

    /** A manager call that needs a working connection; a failure becomes a 422 with its reason and fix. */
    /**
     * Equipment like the one mapped (spec 038 FR-022).
     *
     * @param  array{node_id: ?string, namespace_uri: string, path: list<array{namespace_uri: string, name: string}>}  $equipment
     * @param  list<array{key: string, name?: string, pattern?: string}>  $points
     */
    public function similar(AdapterConnection $connection, array $equipment, array $points, string $by, ?array $root): array
    {
        return $this->call('/opcua/similar', $connection, ['equipment' => $equipment, 'points' => $points, 'by' => $by, 'root' => $root]);
    }

    /** The review check of a point map (research R11): every point found and read once. */
    public function check(AdapterConnection $connection, array $pointMap): array
    {
        return $this->call('/opcua/check', $connection, ['point_map' => $pointMap]);
    }

    private function call(string $path, AdapterConnection $connection, array $extra = []): array
    {
        abort_if($connection->state === 'paused', 409, 'Resume the connection first.');
        $result = $this->manager->request($path, $this->payload($connection) + $extra);
        if (isset($result['reason'])) {
            throw new HttpResponseException(response()->json(['message' => $result['message'] ?? 'The server could not be reached.', 'reason' => $result['reason'], 'fix' => $result['fix'] ?? null], 422));
        }

        return $result;
    }

    /** What the manager needs: the connection, its secrets and the organization's ranges. */
    public function payload(AdapterConnection $connection): array
    {
        $secrets = $connection->secrets ?? [];
        $tenant = AdapterTenant::where('organization_id', $connection->organization_id)->first();

        return [
            'connection' => [
                'uuid' => $connection->uuid,
                'endpoint_url' => $connection->endpoint_url,
                'security_policy' => $connection->security_policy,
                'security_mode' => $connection->security_mode,
                'identity' => $connection->identity,
                'server_fingerprint' => $connection->server_certificate['fingerprint'] ?? null,
            ],
            'secrets' => array_filter([
                'username' => $secrets['username'] ?? null,
                'password' => $secrets['password'] ?? null,
                'user_certificate' => $secrets['user_certificate'] ?? null,
                'user_private_key' => $secrets['user_private_key'] ?? null,
                'client_certificate' => $connection->client_certificate,
                'client_private_key' => $secrets['client_private_key'] ?? null,
            ]),
            'private_ranges' => $tenant?->private_ranges ?? [],
            'platform_ranges' => config('adapters.opcua.platform_ranges'),
        ];
    }

    // Private ranges ---------------------------------------------------------------------

    /** @return list<string> the ranges, checked; refused when one reaches what never may be. */
    public static function checkRanges(array $ranges): array
    {
        $out = [];
        foreach ($ranges as $range) {
            $range = trim((string) $range);
            abort_unless(self::parseRange($range), 422, "{$range} is not a network range such as 10.20.0.0/16.");
            foreach (array_merge(self::NEVER, config('adapters.opcua.platform_ranges')) as $never) {
                abort_if(self::overlaps($range, $never), 422, "{$range} includes {$never}, which an organization can never reach.");
            }
            $out[] = $range;
        }

        return array_values(array_unique($out));
    }

    /** @return array{0: string, 1: int}|null */
    private static function parseRange(string $range): ?array
    {
        $parts = explode('/', $range);
        $bytes = @inet_pton($parts[0]);
        if ($bytes === false || count($parts) > 2) {
            return null;
        }
        $max = strlen($bytes) * 8;
        $bits = isset($parts[1]) && ctype_digit($parts[1]) ? (int) $parts[1] : (isset($parts[1]) ? -1 : $max);

        return $bits >= 0 && $bits <= $max ? [$bytes, $bits] : null;
    }

    private static function overlaps(string $a, string $b): bool
    {
        [$x, $xBits] = self::parseRange($a);
        [$y, $yBits] = self::parseRange($b);
        if (strlen($x) !== strlen($y)) {
            return false;
        }
        $bits = min($xBits, $yBits);
        for ($i = 0; $i < $bits; $i++) {
            $mask = 0x80 >> ($i % 8);
            if ((ord($x[intdiv($i, 8)]) & $mask) !== (ord($y[intdiv($i, 8)]) & $mask)) {
                return false;
            }
        }

        return true;
    }

    // Helpers ----------------------------------------------------------------------------

    private function validate(Organization $organization, array $input, ?AdapterConnection $existing = null): array
    {
        $v = Validator::make($input, [
            'name' => ['required', 'string', 'min:1', 'max:120', Rule::unique('adapter_connections')->where('organization_id', $organization->id)->ignore($existing?->id)],
            'endpoint_url' => ['required', 'string', 'max:512', 'regex:#^opc\.tcp://[^/@\s:]+(:\d{1,5})?(/\S*)?$#i'],
            'security_policy' => ['required', Rule::in(AdapterConnection::POLICIES)],
            'security_mode' => ['required', Rule::in(AdapterConnection::MODES)],
            'unencrypted_confirmed' => ['sometimes', 'boolean'],
            'identity' => ['required', Rule::in(AdapterConnection::IDENTITIES)],
            'username' => ['sometimes', 'nullable', 'string', 'max:255'],
            'password' => ['sometimes', 'nullable', 'string', 'max:255'],
            'user_certificate' => ['sometimes', 'nullable', 'string', 'max:16384'],
            'user_private_key' => ['sometimes', 'nullable', 'string', 'max:16384'],
        ], [
            'endpoint_url.regex' => 'Use an opc.tcp:// address such as opc.tcp://bms.example.com:4840, without a user name or password in it.',
        ])->validate();
        abort_unless(($v['security_policy'] === 'None') === ($v['security_mode'] === 'None'), 422, 'Choose "None" for both the security policy and the mode, or neither.');
        if ($v['security_policy'] === 'None' && ($existing?->security_policy !== 'None')) {
            abort_unless($input['unencrypted_confirmed'] ?? false, 422, 'Confirm that values and sign-in may travel unencrypted.');
        }
        $secrets = $existing?->secrets ?? [];
        if ($v['identity'] === 'username') {
            abort_unless(filled($v['username'] ?? $secrets['username'] ?? null) && filled($v['password'] ?? $secrets['password'] ?? null), 422, 'Enter the user name and password the server expects.');
        }
        if ($v['identity'] === 'certificate') {
            abort_unless(filled($v['user_certificate'] ?? $secrets['user_certificate'] ?? null) && filled($v['user_private_key'] ?? $secrets['user_private_key'] ?? null), 422, 'Add the user certificate and its private key.');
            if (filled($v['user_certificate'] ?? null)) {
                abort_unless(openssl_x509_read($v['user_certificate']) && openssl_pkey_get_private($v['user_private_key'] ?? $secrets['user_private_key']), 422, 'The user certificate and key must be PEM.');
            }
        }

        return $v;
    }

    private function refuseDuplicate(Organization $organization, array $v, ?AdapterConnection $except = null): void
    {
        $twin = AdapterConnection::where('organization_id', $organization->id)
            ->where('endpoint_url', $v['endpoint_url'])->where('security_policy', $v['security_policy'])
            ->where('security_mode', $v['security_mode'])->where('identity', $v['identity'])
            ->when($except, fn ($q) => $q->whereKeyNot($except->id))->first();
        abort_if($twin, 422, "The connection \"{$twin?->name}\" already reaches this server the same way. Use it instead.");
    }

    private function secrets(array $current, array $v): array
    {
        foreach (['username', 'password', 'user_certificate', 'user_private_key'] as $key) {
            if (array_key_exists($key, $v)) {
                $current[$key] = $v[$key];
            }
        }
        if ($v['identity'] !== 'username') {
            unset($current['password']);
        }
        if ($v['identity'] !== 'certificate') {
            unset($current['user_certificate'], $current['user_private_key']);
        }

        return array_filter($current, fn ($value) => $value !== null);
    }

    private function settings(AdapterConnection $connection): array
    {
        return $connection->only(['name', 'endpoint_url', 'security_policy', 'security_mode', 'identity', 'state']);
    }

    private function certificateView(?array $certificate): ?array
    {
        if (! $certificate) {
            return null;
        }
        unset($certificate['der']);

        return $certificate;
    }

    private function audit(string $action, AdapterConnection $connection, User $actor, array $details = []): void
    {
        ActivityLog::record("device.adapter_connection.{$action}", $connection->organization_id, $actor->id, $connection->uuid, $details + ['name' => $connection->name]);
    }

    /**
     * The platform's certificate for one connection: self-signed RSA 2048 for five years,
     * with the application URI urn:iot-os:<organization uuid>:opcua:<connection uuid> a
     * server checks against the client (research R9).
     *
     * @return array{0: string, 1: string, 2: \DateTimeInterface} the certificate and key (PEM) and when it expires
     */
    public function platformCertificate(Organization $organization, string $connection): array
    {
        $uri = "urn:iot-os:{$organization->uuid}:opcua:{$connection}";
        $config = tempnam(sys_get_temp_dir(), 'opcua-cert');
        file_put_contents($config, implode("\n", [
            '[req]', 'distinguished_name = dn', 'prompt = no', '[dn]', 'CN = IoT OS OPC UA connector', '[ext]',
            'basicConstraints = critical,CA:FALSE',
            'keyUsage = critical,digitalSignature,nonRepudiation,keyEncipherment,dataEncipherment',
            'extendedKeyUsage = clientAuth,serverAuth',
            "subjectAltName = URI:{$uri}",
            'subjectKeyIdentifier = hash',
            '',
        ]));
        try {
            $options = ['config' => $config, 'digest_alg' => 'sha256', 'private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA];
            $key = openssl_pkey_new($options);
            $request = openssl_csr_new(['commonName' => 'IoT OS OPC UA connector', 'organizationName' => Str::limit($organization->name, 60, '')], $key, $options);
            $certificate = openssl_csr_sign($request, null, $key, self::CERTIFICATE_DAYS, $options + ['x509_extensions' => 'ext'], random_int(1, PHP_INT_MAX));
            abort_unless($certificate, 500, 'The platform certificate could not be made.');
            openssl_x509_export($certificate, $certificatePem);
            openssl_pkey_export($key, $keyPem, null, $options);
        } finally {
            @unlink($config);
        }

        return [$certificatePem, $keyPem, now()->addDays(self::CERTIFICATE_DAYS)];
    }
}
