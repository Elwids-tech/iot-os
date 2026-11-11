<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceAdapters;

use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\Devices\Models\Device;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Domain\Devices\Moves\MoveTestCase;

/**
 * Adapter installations end (spec 031, research R3): archiving a device ends its
 * installation, so its source can serve another device, and deploys stop binding it.
 */
final class InstallationLifecycleTest extends MoveTestCase
{
    public function test_archiving_ends_the_installation_frees_the_source_and_deploys_stop_binding_it(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $adapter = $this->adapter();
        $candidate = AdapterCandidate::where('source_device_id', 'WM-1001')->firstOrFail();
        $this->deactivated($x);
        $this->postJson($this->in($this->a).'/devices/'.$x->uuid.'/archive', ['draft_revision' => $x->fresh()->draft_revision])->assertOk();

        $ended = DeviceInstallation::where('device_id', $x->id)->firstOrFail();
        $this->assertNotNull($ended->ended_at);
        $this->assertSame('archived', $ended->ended_reason);
        $this->assertNull(collect($this->getJson($this->in($this->a).'/device-adapters/'.$adapter->uuid.'/candidates')->json('data'))->firstWhere('uuid', $candidate->uuid)['device']);

        $this->deploys = [];
        $device = $this->postJson($this->in($this->a).'/device-adapters/'.$adapter->uuid.'/candidates/'.$candidate->uuid.'/activate', ['name' => 'Tracker X again'])->assertAccepted()->json('data.device');

        $installations = DeviceInstallation::where('device_adapter_candidate_id', $candidate->id)->orderBy('id')->get();
        $this->assertSame([$x->id, Device::where('uuid', $device['uuid'])->value('id')], $installations->pluck('device_id')->all());
        $this->assertSame([true, false], $installations->map(fn ($installation) => $installation->ended_at !== null)->all());
        $this->assertSame([$installations[1]->uuid], array_column(end($this->deploys)['bindings'], 'installation_uuid'));
        // Only one installation per source is open at a time.
        $this->expectException(UniqueConstraintViolationException::class);
        DeviceInstallation::create(['organization_id' => $this->a->id, 'device_id' => $this->unsourced('Spare meter')->id, 'device_adapter_candidate_id' => $candidate->id,
            'adapter_revision_uuid' => $adapter->applied_revision_uuid, 'manufacturer_serial' => 'WM-1001', 'started_at' => now(), 'created_by' => $this->mover->id]);
    }

    public function test_the_migration_ends_the_installations_of_archived_devices_only(): void
    {
        $archived = $this->adapterFed('WM-1001', 'Tracker X');
        $active = $this->adapterFed('WM-1002', 'Tracker Y');
        $migration = require database_path('migrations/2026_11_20_000003_end_device_installations.php');
        $migration->down();
        // Before it, archiving left the installation open.
        DB::table('devices')->where('id', $archived->id)->update(['lifecycle' => 'archived']);

        $migration->up();

        $rows = DB::table('device_installations')->orderBy('id')->get(['device_id', 'ended_at', 'ended_reason'])->keyBy('device_id');
        $this->assertNotNull($rows[$archived->id]->ended_at);
        $this->assertSame('archived', $rows[$archived->id]->ended_reason);
        $this->assertNull($rows[$active->id]->ended_at);
        $this->assertNull($rows[$active->id]->ended_reason);
    }
}
