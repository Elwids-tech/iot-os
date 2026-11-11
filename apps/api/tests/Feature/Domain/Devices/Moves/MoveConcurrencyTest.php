<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceMove;
use App\Domain\Devices\Services\Moves\MovePreview;
use App\Domain\Devices\Services\Moves\MoveRequests;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Tests\Feature\Domain\Billing\ForksProcesses;

/**
 * Moves are idempotent and race-safe (spec 031, research R10): one `operation_uuid` is
 * one move, a stale review is refused with a fresh one, and of two people confirming the
 * same device at once exactly one moves it.
 */
final class MoveConcurrencyTest extends MoveTestCase
{
    use ForksProcesses;

    public function test_a_repeated_operation_uuid_returns_the_same_move_and_a_changed_body_is_refused(): void
    {
        $x = $this->unsourced('Meter one');
        $hash = $this->review($this->a, $this->b, [$x])->json('preview_hash');
        $body = ['target_organization_uuid' => $this->b->uuid, 'device_uuids' => [$x->uuid], 'operation_uuid' => (string) Str::uuid(), 'preview_hash' => $hash];

        $first = $this->postJson($this->in($this->a).'/device-moves', $body)->assertAccepted()->json('data');
        $again = $this->postJson($this->in($this->a).'/device-moves', $body)->assertOk()->json('data');

        $this->assertSame($first['uuid'], $again['uuid']);
        $this->postJson($this->in($this->a).'/device-moves', [...$body, 'devices' => [['uuid' => $x->uuid, 'name' => 'Renamed']]])->assertConflict();
        // Someone else can't reuse it either.
        $this->as($this->bOnly, fn () => $this->postJson($this->in($this->b).'/device-moves', $body)->assertStatus(409));
        $this->assertSame(1, DeviceMove::count());
        $this->assertSame(1, Device::where('organization_id', $this->b->id)->count());
    }

    public function test_a_stale_review_is_refused_with_a_fresh_one(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $hash = $this->review($this->a, $this->b, [$x])->json('preview_hash');
        // The device changes after the review.
        $this->deactivated($x);

        $response = $this->postJson($this->in($this->a).'/device-moves', ['target_organization_uuid' => $this->b->uuid, 'device_uuids' => [$x->uuid], 'operation_uuid' => (string) Str::uuid(), 'preview_hash' => $hash])->assertConflict();

        $this->assertSame('The move changed since you reviewed it. Review it again before confirming.', $response->json('message'));
        $this->assertSame([false], array_column($response->json('review.devices'), 'arrives_active'));
        $this->assertNotSame($hash, $response->json('review.preview_hash'));
        $this->assertSame(0, DeviceMove::count());
    }

    public function test_the_second_of_two_confirmations_of_one_device_is_refused_with_nothing_changed(): void
    {
        $x = $this->unsourced('Meter one');
        $body = fn (string $hash) => ['target_organization_uuid' => $this->b->uuid, 'device_uuids' => [$x->uuid], 'operation_uuid' => (string) Str::uuid(), 'preview_hash' => $hash];
        $hash = $this->review($this->a, $this->b, [$x])->json('preview_hash');

        $this->postJson($this->in($this->a).'/device-moves', $body($hash))->assertAccepted();
        $this->postJson($this->in($this->a).'/device-moves', $body($hash))->assertConflict();

        $this->assertSame(1, DeviceMove::count());
        $this->assertSame(1, Device::where('organization_id', $this->b->id)->count());
    }

    /**
     * Two processes on their own connections confirm the same reviewed move at once, each
     * with its own operation: the organization locks serialize them, and the second finds
     * the device archived and the review stale.
     */
    public function test_two_movers_confirming_the_same_device_at_once_make_one_move(): void
    {
        $this->skipUnlessForkable();
        $setup = $this->committedConnection();
        $now = now();
        $accountId = $setup->table('billing_accounts')->insertGetId(['uuid' => (string) Str::uuid(), 'name' => 'Concurrent moves', 'created_at' => $now, 'updated_at' => $now]);
        $organizations = [];
        foreach (['source', 'target'] as $name) {
            $organizations[] = $setup->table('organizations')->insertGetId(['uuid' => (string) Str::uuid(), 'name' => 'Concurrent '.$name, 'slug' => 'concurrent-'.$name.'-'.Str::lower(Str::random(6)),
                'billing_account_id' => $accountId, 'created_at' => $now, 'updated_at' => $now]);
        }
        $userId = $setup->table('users')->insertGetId(['name' => 'Concurrent mover', 'email' => 'concurrent-'.Str::lower(Str::random(6)).'@example.test', 'password' => 'unused', 'is_super_admin' => true, 'created_at' => $now, 'updated_at' => $now]);
        $deviceUuid = (string) Str::uuid();
        $deviceId = $setup->table('devices')->insertGetId(['uuid' => $deviceUuid, 'organization_id' => $organizations[0], 'code' => 'meter-1', 'name' => 'Meter one', 'created_at' => $now, 'updated_at' => $now]);
        $input = ['target_organization_uuid' => $setup->table('organizations')->where('id', $organizations[1])->value('uuid'), 'device_uuids' => [$deviceUuid]];

        try {
            $source = Organization::findOrFail($organizations[0]);
            $user = User::findOrFail($userId);
            $preview = app(MovePreview::class);
            $hash = $preview->review($source, $preview->target($source, $user, $input['target_organization_uuid']), $user, $input)['preview_hash'];
            $outcomes = $this->inForkedProcesses(2, function (int $index, callable $ready) use ($organizations, $userId, $input, $hash): string {
                $source = Organization::findOrFail($organizations[0]);
                $user = User::findOrFail($userId);
                $ready();
                try {
                    app(MoveRequests::class)->confirm($source, $user, [...$input, 'operation_uuid' => (string) Str::uuid(), 'preview_hash' => $hash]);

                    return 'moved';
                } catch (HttpExceptionInterface $exception) {
                    return (string) $exception->getStatusCode();
                } catch (HttpResponseException $exception) {
                    return (string) $exception->getResponse()->getStatusCode();
                }
            });

            sort($outcomes);
            $this->assertSame(['409', 'moved'], $outcomes);
            $this->assertSame(1, DB::table('device_moves')->where('source_organization_id', $organizations[0])->count());
            $this->assertSame(1, DB::table('devices')->where('organization_id', $organizations[1])->count());
            $this->assertSame('archived', DB::table('devices')->where('id', $deviceId)->value('lifecycle'));
        } finally {
            $moves = $setup->table('device_moves')->whereIn('source_organization_id', $organizations)->pluck('id');
            $setup->table('device_links')->whereIn('source_organization_id', $organizations)->delete();
            $setup->table('device_move_devices')->whereIn('device_move_id', $moves)->delete();
            $setup->table('device_moves')->whereIn('id', $moves)->delete();
            $setup->table('activity_log')->whereIn('organization_id', $organizations)->delete();
            $setup->table('devices')->whereIn('organization_id', $organizations)->delete();
            $setup->table('organizations')->whereIn('id', $organizations)->delete();
            $setup->table('billing_device_peaks')->where('billing_account_id', $accountId)->delete();
            $setup->table('billing_accounts')->where('id', $accountId)->delete();
            $setup->table('users')->where('id', $userId)->delete();
            $setup->disconnect();
        }
    }
}
