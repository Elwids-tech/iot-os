<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\Entities\Models\EntityChange;
use App\Domain\Entities\Models\EntityType;
use App\Domain\Entities\Services\EntityTypes;
use App\Domain\Entities\Services\PathNames;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;

/**
 * A site: an active entity of the organization's Site type (spec 009, research R4).
 *
 * This is the compatibility view every reader of sites keeps using: the sites API, a
 * device's `site`, the `site_uuid` filters, moves, grants and agent tools. Sites live in
 * `entities`; the hierarchy (App\Domain\Entities) owns them. Its time zone still cuts
 * calendar periods for the devices placed in its branch.
 *
 * Creating one directly (tests, old fixtures) makes a top-level Site entity with a free
 * path name; product code creates and changes sites through the hierarchy's services.
 */
final class Site extends DeviceModel
{
    protected $table = 'entities';

    protected static function booted(): void
    {
        parent::booted();
        self::addGlobalScope('site', fn (Builder $query) => $query
            ->whereNull($query->qualifyColumn('archived_at'))
            ->whereIn($query->qualifyColumn('entity_type_id'), EntityType::query()->select('id')->where('key', EntityType::SITE)));
        self::creating(function (Site $site): void {
            $organization = Organization::query()->findOrFail($site->organization_id);
            $site->entity_type_id ??= app(EntityTypes::class)->ensureSite($organization)->id;
            $site->path_name ??= self::freePathName($site->organization_id, (string) $site->name);
            $site->path ??= $site->path_name;
            $site->depth ??= 0;
        });
        self::created(function (Site $site): void {
            DB::table('entity_closure')->insert(['ancestor_id' => $site->id, 'descendant_id' => $site->id, 'depth' => 0]);
            EntityChange::create(['organization_id' => $site->organization_id, 'entity_id' => $site->id, 'kind' => EntityChange::CREATED,
                'new_path_name' => $site->path_name, 'new_type_id' => $site->entity_type_id, 'user_id' => $site->created_by, 'changed_at' => now()]);
        });
    }

    protected function casts(): array
    {
        return ['latitude' => 'float', 'longitude' => 'float'];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /** Devices whose nearest Site entity this is, archived ones included. */
    public function devices(): HasMany
    {
        return $this->hasMany(Device::class);
    }

    /** @return array<string, mixed> */
    public function toView(): array
    {
        return [
            ...$this->only(['uuid', 'name', 'timezone', 'address', 'latitude', 'longitude']),
            'devices_count' => $this->devices_count ?? null,
        ];
    }

    /** The suggested path name, or `Site<n>`, free among the active top-level entities. */
    public static function freePathName(int $organizationId, string $name): string
    {
        $taken = fn (string $candidate): bool => DB::table('entities')->where('organization_id', $organizationId)->whereNull('parent_id')
            ->whereNull('archived_at')->whereRaw('lower(path_name) = ?', [strtolower($candidate)])->exists();
        $suggested = PathNames::suggest($name);
        if ($suggested !== '' && ! $taken($suggested)) {
            return $suggested;
        }
        for ($n = 1; ; $n++) {
            if (! $taken('Site'.$n)) {
                return 'Site'.$n;
            }
        }
    }
}
