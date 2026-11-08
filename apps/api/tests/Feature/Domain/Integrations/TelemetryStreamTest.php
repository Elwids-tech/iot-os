<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Integrations;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\Site;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Integrations\Models\IntegrationStreamSession;
use App\Domain\Integrations\Services\StreamRelay;
use App\Domain\Shared\Models\Organization;
use Carbon\Carbon;
use Closure;
use Database\Seeders\DatabaseSeeder;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Psr7\FnStream;
use GuzzleHttp\Psr7\Response as PsrResponse;
use GuzzleHttp\Psr7\Utils;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as RuntimeRequest;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\PersonalAccessToken;
use Psr\Http\Message\StreamInterface;
use Tests\TestCase;

/**
 * The application telemetry stream of spec 030 (US2): refusals, limits, the relayed
 * frames (telemetry-stream-open.v1, telemetry-stream.v1, telemetry-stream-reset.v1),
 * the re-check that ends a stream with telemetry-stream-closed.v1, the device set of a
 * site scope following its devices, and the session row. The runtime is faked by a
 * scripted body: each step is a chunk, or a closure that changes state between chunks.
 */
final class TelemetryStreamTest extends TestCase
{
    use RefreshDatabase;

    private const CLOSED = 'telemetry-stream-closed.v1';

    private Organization $org;

    private Organization $other;

    private Site $hall;

    private Site $yard;

    private Device $pump1;

    private Device $pump2;

    /** At the yard, outside the scope, until a test moves it. */
    private Device $pump3;

    private Device $loose;

    private Device $foreign;

    /** Granted a device list: pump1 and pump2. */
    private IntegrationApplication $listed;

    /** Granted the hall as a scope. */
    private IntegrationApplication $scoped;

    private string $listedToken;

    private PersonalAccessToken $listedTokenRow;

    private string $scopedToken;

    private string $path;

    /** @var list<list<string|Closure>> the bodies of successive runtime streams */
    private array $scripts = [];

    /** @var list<RuntimeRequest> */
    private array $runtimeRequests = [];

    private bool $clientGone = false;

    private bool $runtimeDown = false;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->hall = Site::create(['organization_id' => $this->org->id, 'name' => 'Packaging hall', 'timezone' => 'Asia/Colombo']);
        $this->yard = Site::create(['organization_id' => $this->org->id, 'name' => 'Yard', 'timezone' => 'UTC']);
        $this->pump1 = Device::create(['organization_id' => $this->org->id, 'site_id' => $this->hall->id, 'code' => 'P-201', 'name' => 'Pump 1']);
        $this->pump2 = Device::create(['organization_id' => $this->org->id, 'site_id' => $this->hall->id, 'code' => 'P-202', 'name' => 'Pump 2']);
        $this->pump3 = Device::create(['organization_id' => $this->org->id, 'site_id' => $this->yard->id, 'code' => 'P-203', 'name' => 'Pump 3']);
        $this->loose = Device::create(['organization_id' => $this->org->id, 'code' => 'loose', 'name' => 'No site']);
        $this->foreign = Device::create(['organization_id' => $this->other->id, 'code' => 'N-1', 'name' => 'Northstar meter']);
        $abilities = ['telemetry:read', 'telemetry:stream'];
        $this->listed = IntegrationApplication::create(['organization_id' => $this->org->id, 'name' => 'Twin', 'abilities' => $abilities, 'device_uuids' => [$this->pump1->uuid, $this->pump2->uuid]])->fresh();
        $this->scoped = IntegrationApplication::create(['organization_id' => $this->org->id, 'name' => 'Plant twin', 'abilities' => $abilities, 'device_uuids' => [], 'site_uuids' => [$this->hall->uuid]])->fresh();
        [$this->listedToken, $this->listedTokenRow] = $this->token($this->listed, $abilities);
        [$this->scopedToken] = $this->token($this->scoped, $abilities);
        $this->path = '/api/integration/v1/organizations/'.$this->org->uuid.'/telemetry/stream';
        config(['devices.runtime_token' => 'test', 'devices.runtime_url' => 'http://runtime', 'integrations.stream_recheck_seconds' => 0, 'integrations.stream_keepalive_seconds' => 60]);
        Http::fake(function (RuntimeRequest $request) {
            $this->runtimeRequests[] = $request;
            if ($this->runtimeDown) {
                return Http::response(['message' => 'down'], 503);
            }

            return Create::promiseFor(new PsrResponse(200, ['Content-Type' => 'text/event-stream; charset=utf-8'], $this->scripted(array_shift($this->scripts) ?? [])));
        });
        app()->extend(StreamRelay::class, function (StreamRelay $relay): StreamRelay {
            $relay->clientGone = fn (): bool => $this->clientGone;

            return $relay;
        });
    }

    /**
     * @param  list<string>  $abilities
     * @return array{0: string, 1: PersonalAccessToken}
     */
    private function token(IntegrationApplication $application, array $abilities, int $days = 1): array
    {
        $secret = Str::random(40);
        $token = $application->tokens()->create(['name' => 'twin', 'token' => hash('sha256', $secret), 'abilities' => $abilities, 'expires_at' => now()->addDays($days)]);

        return [$token->id.'|'.$secret, $token];
    }

    /**
     * A body that yields one step per read: a string chunk as written, a closure's
     * return after its side effect. The body ends when the steps run out.
     *
     * @param  list<string|Closure>  $steps
     */
    private function scripted(array $steps): StreamInterface
    {
        $index = 0;

        return FnStream::decorate(Utils::streamFor(''), [
            'read' => static function (int $length) use (&$steps, &$index): string {
                if ($index >= count($steps)) {
                    return '';
                }
                $step = $steps[$index++];

                return $step instanceof Closure ? (string) $step() : $step;
            },
            'eof' => static function () use (&$steps, &$index): bool {
                return $index >= count($steps);
            },
            'getMetadata' => static fn (?string $key = null): mixed => $key === 'timed_out' ? false : null,
        ]);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private static function frame(string $event, ?string $id, array $data): string
    {
        return "event: {$event}\n".($id === null ? '' : "id: {$id}\n").'data: '.json_encode($data, JSON_UNESCAPED_SLASHES)."\n\n";
    }

    private static function open(string $position, int $devices): string
    {
        return self::frame('open', null, ['schema_version' => 'telemetry-stream-open.v1', 'position' => $position, 'devices' => $devices, 'opened_at' => '2026-11-07T09:41:58Z']);
    }

    private static function reading(string $position, Device $device): string
    {
        return self::frame('reading', $position, ['schema_version' => 'telemetry-stream.v1', 'position' => $position, 'event_id' => (string) Str::uuid(),
            'device_uuid' => $device->uuid, 'configuration_uuid' => (string) Str::uuid(), 'generation' => 1,
            'readings' => [['parameter_uuid' => (string) Str::uuid(), 'key' => 'flow', 'data_type' => 'number', 'unit' => 'L/min', 'value' => 12.5, 'quality' => 'good',
                'observed_at' => '2026-11-07T09:41:57Z', 'received_at' => '2026-11-07T09:41:58Z', 'historical' => false]]]);
    }

    private static function closed(string $reason, string $position): string
    {
        return self::frame('closed', null, ['schema_version' => self::CLOSED, 'reason' => $reason, 'position' => $position]);
    }

    /**
     * @param  array<string, mixed>  $query
     * @param  array<string, string>  $headers
     */
    private function stream(string $token, array $query = [], array $headers = [], ?Organization $organization = null): TestResponse
    {
        Auth::forgetGuards();
        $path = $organization === null ? $this->path : '/api/integration/v1/organizations/'.$organization->uuid.'/telemetry/stream';

        // call() hands the query to the request as an array, so 1001 devices reach the
        // validator instead of PHP's max_input_vars dropping the extra ones.
        $server = $this->transformHeadersToServerVars($headers + ['Accept' => 'text/event-stream', 'Authorization' => 'Bearer '.$token]);

        return $this->call('GET', $path, $query, [], [], $server);
    }

    /** @param list<string|Closure> $steps */
    private function runtimeStream(array $steps, int $idleTicks = 4): void
    {
        $this->scripts[] = [...$steps, ...array_fill(0, $idleTicks, '')];
    }

    /**
     * @param  list<Device>  $devices
     */
    private static function deviceList(array $devices): string
    {
        $uuids = array_map(static fn (Device $device): string => $device->uuid, $devices);
        sort($uuids, SORT_STRING);

        return implode(',', $uuids);
    }

    public function test_the_ability_and_its_companion_are_required(): void
    {
        [$withoutStream] = $this->token($this->listed, ['telemetry:read']);
        $this->stream($withoutStream)->assertForbidden();
        [$withoutRead] = $this->token($this->listed, ['telemetry:stream']);
        $this->stream($withoutRead)->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_a_client_that_does_not_accept_event_streams_is_refused(): void
    {
        $this->stream($this->listedToken, headers: ['Accept' => 'application/json'])->assertStatus(406);
        Http::assertNothingSent();
    }

    public function test_an_ungranted_or_foreign_device_in_the_subset_refuses_the_whole_request(): void
    {
        $this->stream($this->listedToken, ['devices' => [$this->pump1->uuid, $this->loose->uuid]])->assertNotFound();
        $this->stream($this->listedToken, ['devices' => [$this->pump1->uuid, $this->foreign->uuid]])->assertNotFound();
        $this->stream($this->scopedToken, ['devices' => [$this->pump3->uuid]])->assertNotFound();
        $this->stream($this->listedToken, organization: $this->other)->assertNotFound();
        Http::assertNothingSent();
        $this->assertSame(0, IntegrationStreamSession::count());
    }

    public function test_too_many_devices_and_a_malformed_position_are_invalid_input(): void
    {
        // 1001 devices as the comma form: PHP's max_input_vars (raised to 2500 in the api
        // images) keeps 1001 `devices[]` out of the test process; the validator sees the
        // same array either way.
        $many = array_map(static fn (): string => (string) Str::uuid(), range(1, 1001));
        $this->stream($this->listedToken, ['devices' => implode(',', $many)])->assertUnprocessable()->assertJsonValidationErrors(['devices']);
        $this->stream($this->listedToken, ['devices' => [$this->pump1->uuid, $this->pump1->uuid]])->assertUnprocessable()->assertJsonValidationErrors(['devices.0']);
        $this->stream($this->listedToken, ['after' => 'abc'])->assertUnprocessable()->assertJsonValidationErrors(['after']);
        $this->stream($this->listedToken, ['after' => '042'])->assertUnprocessable()->assertJsonValidationErrors(['after']);
        $this->stream($this->listedToken, headers: ['Last-Event-ID' => '01'])->assertUnprocessable()->assertJsonValidationErrors(['after']);
        Http::assertNothingSent();
    }

    public function test_the_comma_form_names_the_same_devices_as_the_array_form(): void
    {
        $this->scripts[] = [self::open('41', 1)];
        $this->stream($this->listedToken, ['devices' => $this->pump2->uuid.','.$this->pump1->uuid])->assertOk()->streamedContent();
        $this->assertSame(self::deviceList([$this->pump1, $this->pump2]), $this->runtimeRequests[0]['devices']);
    }

    public function test_open_and_readings_are_relayed_byte_for_byte_and_the_runtime_ending_closes_the_stream(): void
    {
        $open = self::open('41', 2);
        $first = self::reading('42', $this->pump1);
        $keepalive = ": keepalive\n\n";
        $second = self::reading('43', $this->pump2);
        // The second reading arrives in two pieces: nothing partial is relayed.
        $this->scripts[] = [$open, $first, $keepalive, substr($second, 0, 20), substr($second, 20)];

        $response = $this->stream($this->listedToken)->assertOk()
            ->assertHeader('Content-Type', 'text/event-stream; charset=utf-8')->assertHeader('X-Accel-Buffering', 'no');
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $this->assertSame($open.$first.$keepalive.$second.self::closed('runtime_unavailable', '43'), $response->streamedContent());

        $this->assertCount(1, $this->runtimeRequests);
        $request = $this->runtimeRequests[0];
        $this->assertSame('http://runtime/internal/telemetry/stream?'.http_build_query(['organization' => $this->org->uuid, 'devices' => self::deviceList([$this->pump1, $this->pump2])]), $request->url());
        $this->assertSame('Bearer test', $request->header('Authorization')[0]);
        $session = IntegrationStreamSession::sole();
        $this->assertSame($this->listed->id, $session->integration_application_id);
        $this->assertSame($this->org->id, $session->organization_id);
        $this->assertSame(2, $session->device_count);
        $this->assertSame('runtime_unavailable', $session->close_reason);
        $this->assertSame('43', $session->last_position);
        $this->assertNotNull($session->closed_at);
        $this->assertSame(0, IntegrationStreamSession::query()->open()->count());
    }

    public function test_a_resumed_stream_passes_the_position_to_the_runtime_and_a_reset_ends_it_quietly(): void
    {
        $reset = self::frame('reset', null, ['schema_version' => 'telemetry-stream-reset.v1', 'position' => '9031']);
        $this->scripts[] = [$reset];
        $this->assertSame($reset, $this->stream($this->listedToken, headers: ['Last-Event-ID' => '40'])->assertOk()->streamedContent());
        $this->assertStringContainsString('after=40', $this->runtimeRequests[0]->url());
        $this->assertSame('reset', IntegrationStreamSession::sole()->close_reason);

        $this->scripts[] = [self::open('7', 2)];
        $this->stream($this->listedToken, ['after' => '7'])->assertOk()->streamedContent();
        $this->assertStringContainsString('after=7', $this->runtimeRequests[1]->url());
    }

    public function test_the_third_stream_of_an_application_and_the_eleventh_of_an_organization_are_refused(): void
    {
        $openRow = fn (IntegrationApplication $application) => IntegrationStreamSession::create([
            'integration_application_id' => $application->id, 'organization_id' => $application->organization_id,
            'opened_at' => now()->subMinutes(5), 'last_seen_at' => now()->subSeconds(10), 'device_count' => 2]);
        $openRow($this->listed);
        $openRow($this->listed);
        $this->stream($this->listedToken)->assertStatus(429)->assertHeader('Retry-After', '30')
            ->assertJsonPath('message', 'This application already has 2 open telemetry streams; the limit is 2 per application.');
        Http::assertNothingSent();
        $this->assertSame(2, IntegrationStreamSession::query()->open()->count(), 'the open streams are left alone');

        // A stale row (a worker that died) frees its slot; a closed one never counted.
        IntegrationStreamSession::query()->first()->update(['last_seen_at' => now()->subMinutes(2)]);
        $this->runtimeStream([self::open('1', 2)], 0);
        $this->stream($this->listedToken)->assertOk()->streamedContent();

        // Ten open streams in the organization across five applications: the eleventh is refused.
        IntegrationStreamSession::query()->delete();
        foreach (range(1, 5) as $n) {
            $application = IntegrationApplication::create(['organization_id' => $this->org->id, 'name' => "App {$n}", 'abilities' => ['telemetry:read', 'telemetry:stream'], 'device_uuids' => [$this->pump1->uuid]]);
            $openRow($application);
            $openRow($application);
        }
        $this->stream($this->listedToken)->assertStatus(429)->assertHeader('Retry-After', '30')
            ->assertJsonPath('message', 'This organization already has 10 open telemetry streams; the limit is 10 per organization.');
        $this->assertSame(10, IntegrationStreamSession::query()->open()->count());

        // The deployment cap counts every organization.
        IntegrationStreamSession::query()->delete();
        config(['integrations.streams_max_open' => 1]);
        $foreignApplication = IntegrationApplication::create(['organization_id' => $this->other->id, 'name' => 'Foreign', 'abilities' => ['telemetry:read'], 'device_uuids' => [$this->foreign->uuid]]);
        $openRow($foreignApplication);
        $this->stream($this->listedToken)->assertStatus(429)
            ->assertJsonPath('message', 'The platform already has 1 open telemetry streams; the limit is 1.');
    }

    public function test_a_grant_change_closes_the_stream_within_the_recheck(): void
    {
        $open = self::open('41', 2);
        $this->runtimeStream([$open, function (): string {
            $this->listed->increment('grant_revision');

            return '';
        }]);

        $this->assertSame($open.self::closed('grant_changed', '41'), $this->stream($this->listedToken)->assertOk()->streamedContent());
        $this->assertSame('grant_changed', IntegrationStreamSession::sole()->close_reason);
        $this->assertSame('41', IntegrationStreamSession::sole()->last_position, 'the open position when no reading was relayed');

        // A manager's save bumps the revision and deletes the token in one go: the client
        // is told the grant changed, which also says its credentials are gone.
        $this->runtimeStream([$open, function (): string {
            $this->listed->increment('grant_revision');
            $this->listed->tokens()->delete();

            return '';
        }]);
        $this->assertSame($open.self::closed('grant_changed', '41'), $this->stream($this->listedToken)->assertOk()->streamedContent());
    }

    public function test_a_device_moving_into_or_out_of_the_granted_site_changes_the_set_with_one_open(): void
    {
        $open = self::open('41', 2);
        $r42 = self::reading('42', $this->pump1);
        $r43 = self::reading('43', $this->pump3);
        $r44 = self::reading('44', $this->pump2);
        $this->runtimeStream([$open, $r42, function (): string {
            $this->pump3->update(['site_id' => $this->hall->id]);

            return '';
        }]);
        $this->runtimeStream([self::open('42', 3), $r43, function (): string {
            $this->pump1->update(['site_id' => $this->yard->id]);

            return '';
        }]);
        $this->scripts[] = [self::open('43', 2), $r44];

        $content = $this->stream($this->scopedToken)->assertOk()->streamedContent();
        $this->assertSame($open.$r42.$r43.$r44.self::closed('runtime_unavailable', '44'), $content);
        $this->assertSame(1, substr_count($content, 'event: open'), 'the client sees one open');
        $this->assertCount(3, $this->runtimeRequests);
        $this->assertSame(self::deviceList([$this->pump1, $this->pump2]), $this->runtimeRequests[0]['devices']);
        $this->assertArrayNotHasKey('after', $this->runtimeRequests[0]->data());
        $this->assertSame(self::deviceList([$this->pump1, $this->pump2, $this->pump3]), $this->runtimeRequests[1]['devices']);
        $this->assertSame('42', $this->runtimeRequests[1]['after']);
        $this->assertSame(self::deviceList([$this->pump2, $this->pump3]), $this->runtimeRequests[2]['devices']);
        $this->assertSame('43', $this->runtimeRequests[2]['after']);
        $session = IntegrationStreamSession::sole();
        $this->assertSame(2, $session->device_count, 'the size at open');
        $this->assertSame('44', $session->last_position);
    }

    public function test_a_subset_follows_the_scope_too_and_a_list_grant_never_reopens(): void
    {
        // The subset names pump1 and pump2; pump1 leaves the hall, so the set shrinks to pump2.
        $this->runtimeStream([self::open('41', 2), function (): string {
            $this->pump1->update(['site_id' => $this->yard->id]);

            return '';
        }]);
        $this->scripts[] = [self::open('41', 1), self::reading('45', $this->pump2)];
        $this->stream($this->scopedToken, ['devices' => [$this->pump1->uuid, $this->pump2->uuid]])->assertOk()->streamedContent();
        $this->assertCount(2, $this->runtimeRequests);
        $this->assertSame($this->pump2->uuid, $this->runtimeRequests[1]['devices']);
        $this->assertSame('41', $this->runtimeRequests[1]['after'], 'the open position when nothing was relayed yet');

        // A device list is static: a move changes nothing until a manager saves the grant.
        $this->runtimeRequests = [];
        $this->runtimeStream([self::open('50', 2), function (): string {
            $this->pump2->update(['site_id' => $this->yard->id]);

            return '';
        }]);
        $this->stream($this->listedToken)->assertOk()->streamedContent();
        $this->assertCount(1, $this->runtimeRequests);
    }

    public function test_revocation_and_token_expiry_close_the_stream_with_credentials_changed(): void
    {
        $open = self::open('41', 2);
        $this->runtimeStream([$open, function (): string {
            $this->listed->update(['revoked_at' => now()]);

            return '';
        }]);
        $this->assertSame($open.self::closed('credentials_changed', '41'), $this->stream($this->listedToken)->assertOk()->streamedContent());

        $this->listed->update(['revoked_at' => null]);
        $this->runtimeStream([$open, self::reading('42', $this->pump1), function (): string {
            $this->listedTokenRow->forceFill(['expires_at' => now()->subMinute()])->save();

            return '';
        }]);
        $content = $this->stream($this->listedToken)->assertOk()->streamedContent();
        $this->assertStringStartsWith($open."event: reading\nid: 42\n", $content, 'readings before the check are relayed');
        $this->assertStringEndsWith(self::closed('credentials_changed', '42'), $content);
        $sessions = IntegrationStreamSession::orderBy('id')->get();
        $this->assertSame(['credentials_changed', 'credentials_changed'], $sessions->pluck('close_reason')->all());
        $this->assertSame('42', $sessions[1]->last_position);
    }

    public function test_the_client_leaving_closes_the_session_without_a_closed_event(): void
    {
        $open = self::open('41', 2);
        $this->runtimeStream([$open, function (): string {
            $this->clientGone = true;

            return '';
        }]);
        $this->assertSame($open, $this->stream($this->listedToken)->assertOk()->streamedContent());
        $this->assertSame('client', IntegrationStreamSession::sole()->close_reason);
    }

    public function test_the_lifetime_closes_the_stream_with_the_last_position(): void
    {
        config(['integrations.stream_lifetime_seconds' => 1]);
        $open = self::open('41', 2);
        $reading = self::reading('42', $this->pump1);
        $this->runtimeStream([$open, $reading, function (): string {
            Carbon::setTestNow(now()->addSeconds(2));

            return '';
        }]);
        $this->assertSame($open.$reading.self::closed('lifetime', '42'), $this->stream($this->listedToken)->assertOk()->streamedContent());
        $session = IntegrationStreamSession::sole();
        $this->assertSame('lifetime', $session->close_reason);
        $this->assertSame('42', $session->last_position);
        $this->assertTrue($session->last_seen_at->greaterThan($session->opened_at), 'the session was touched by the re-check');
        Carbon::setTestNow();
    }

    public function test_a_quiet_relay_writes_its_own_keepalive(): void
    {
        config(['integrations.stream_keepalive_seconds' => 1]);
        $open = self::open('41', 2);
        $this->runtimeStream([$open, function (): string {
            Carbon::setTestNow(now()->addSeconds(2));

            return '';
        }, function (): string {
            $this->clientGone = true;

            return '';
        }]);
        $this->assertSame($open.": keepalive\n\n", $this->stream($this->listedToken)->assertOk()->streamedContent());
        Carbon::setTestNow();
    }

    public function test_a_refusing_runtime_is_service_unavailable_before_any_byte(): void
    {
        $this->runtimeDown = true;
        $this->stream($this->listedToken)->assertStatus(503);
        $this->assertSame('runtime_unavailable', IntegrationStreamSession::sole()->close_reason);
        $this->assertSame(0, IntegrationStreamSession::query()->open()->count());
    }

    public function test_an_emptied_scope_has_nothing_to_stream(): void
    {
        $this->scoped->update(['site_uuids' => []]);
        [$token] = $this->token($this->scoped, ['telemetry:read', 'telemetry:stream']);
        $this->stream($token)->assertNotFound();
        Http::assertNothingSent();
    }
}
