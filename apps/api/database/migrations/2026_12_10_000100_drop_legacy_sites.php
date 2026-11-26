<?php

declare(strict_types=1);

use App\Domain\Entities\Models\EntityType;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Drops the old sites table (spec 009 T075, research R4).
 *
 * Sites became Site entities in PR 2, which kept the table, unused, as `legacy_sites` so
 * one release could roll back. That release has run on the pilot, so the table goes.
 * `down()` rebuilds it from today's top-level Site entities, by UUID, so the PR 2
 * migration can still be rolled back afterwards; sites archived since are left out.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('legacy_sites');
    }

    public function down(): void
    {
        Schema::create('legacy_sites', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->string('name', 120);
            $t->string('timezone', 64);
            $t->text('address')->nullable();
            $t->decimal('latitude', 9, 6)->nullable();
            $t->decimal('longitude', 9, 6)->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->unique(['organization_id', 'name']);
        });

        $seen = [];
        $sites = DB::table('entities')
            ->join('entity_types', 'entity_types.id', '=', 'entities.entity_type_id')
            ->where('entity_types.key', EntityType::SITE)
            ->whereNull('entities.parent_id')
            ->whereNull('entities.archived_at')
            ->orderBy('entities.id')
            ->get(['entities.*']);
        foreach ($sites as $site) {
            // The old table allowed one site of a name per organization; the first keeps it.
            $key = $site->organization_id.'|'.$site->name;
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            DB::table('legacy_sites')->insert([
                'uuid' => $site->uuid, 'organization_id' => $site->organization_id, 'name' => mb_substr($site->name, 0, 120),
                'timezone' => $site->timezone ?? 'UTC', 'address' => $site->address, 'latitude' => $site->latitude, 'longitude' => $site->longitude,
                'created_by' => $site->created_by, 'updated_by' => $site->updated_by, 'created_at' => $site->created_at, 'updated_at' => $site->updated_at,
            ]);
        }
    }
};
