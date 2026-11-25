<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Controllers;

use App\Domain\Entities\Permissions\EntityPermission;
use App\Domain\Entities\Permissions\EntityTypePermission;
use App\Domain\Entities\Services\EntityAuthorization;
use App\Domain\Entities\Services\EntityPresets;
use App\Domain\Entities\Services\EntityTypes;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

/** Built-in presets of types and rules (spec 009 US5, FR-007). */
final class EntityPresetController
{
    public function __construct(private readonly EntityAuthorization $authorization, private readonly EntityPresets $presets) {}

    /**
     * Each preset and what applying it here would do to each of its types.
     *
     * @return array{data: list<array{key: string, name: string, description: string, version: int, types: list<array{key: string, name: string, outcome: 'add'|'merge'|'present'}>}>}
     */
    public function index(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization);
        app(EntityTypes::class)->ensureSite($organization);
        $data = [];
        foreach (EntityPresets::definitions() as $key => $definition) {
            $data[] = ['key' => $key, 'name' => $definition['name'], 'description' => $definition['description'], 'version' => EntityPresets::VERSION, 'types' => $this->presets->preview($organization, $key)];
        }

        return ['data' => $data];
    }

    /**
     * Adds the preset's missing types and combines the rules of those already present. Applying it again changes nothing.
     *
     * @return array{data: array{added: list<string>, merged: list<string>}}
     */
    public function apply(Request $request, Organization $organization, string $preset): array
    {
        $this->authorization->authorize($request->user(), EntityTypePermission::MANAGE, $organization);
        abort_unless(isset(EntityPresets::definitions()[$preset]), 404);

        return ['data' => $this->presets->apply($organization, $preset, $request->user())];
    }
}
