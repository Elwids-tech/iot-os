<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

final class DashboardDefinition
{
    public static function defaults(): array
    {
        return ['range' => ['mode' => 'relative', 'preset' => '6h'], 'timezone' => 'browser', 'refresh' => 5];
    }

    /** Read compatibility only: opening a legacy dashboard must not write it. */
    public static function normalize(array $widgets): array
    {
        return array_map(function (array $widget): array {
            $legacy = ($widget['schema_version'] ?? 1) < 2;
            $rules = $widget['config']['thresholds'] ?? [];
            $widget['schema_version'] = 2;
            $widget['title'] ??= 'Status';
            $widget['description'] ??= 'Live parameter state';
            $widget['config']['sources'] = array_map(fn (array $source): array => [
                'label' => '', 'unit' => null, 'data_type' => 'number', 'precision' => null,
                'color' => '#2563eb',
                'base' => ['label' => $legacy ? 'Below range' : 'Current', 'color' => '#64748b'],
                'thresholds' => $legacy ? $rules : [], ...$source,
            ], $widget['config']['sources'] ?? []);
            unset($widget['config']['thresholds']);

            return $widget;
        }, $widgets);
    }

    public function validate(Request $request, Organization $organization, bool $updating): array
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'revision' => [$updating ? 'required' : 'sometimes', 'integer', 'min:1'],
            'widgets' => ['present', 'array', 'max:100'],
            'widgets.*' => ['array:id,schema_version,type,title,description,config'],
            'widgets.*.id' => ['required', 'string', 'max:100', 'distinct:strict'],
            'widgets.*.schema_version' => ['required', 'integer', 'in:2'],
            'widgets.*.type' => ['required', 'in:status,timeseries'],
            'widgets.*.title' => ['required', 'string', 'max:120'],
            'widgets.*.description' => ['nullable', 'string', 'max:1000'],
            'widgets.*.config' => ['required', 'array:sources'],
            'widgets.*.config.sources' => ['required', 'array', 'min:1', 'max:100'],
            'widgets.*.config.sources.*' => ['array:device_uuid,parameter_uuid,device_name,label,unit,data_type,precision,color,base,thresholds'],
            'widgets.*.config.sources.*.device_uuid' => ['required', 'uuid'],
            'widgets.*.config.sources.*.parameter_uuid' => ['required', 'uuid'],
            'widgets.*.config.sources.*.device_name' => ['sometimes', 'string', 'max:255'],
            'widgets.*.config.sources.*.label' => ['nullable', 'string', 'max:120'],
            'widgets.*.config.sources.*.unit' => ['nullable', 'string', 'max:100'],
            'widgets.*.config.sources.*.data_type' => ['required', 'string'],
            'widgets.*.config.sources.*.precision' => ['nullable', 'integer', 'between:0,10'],
            'widgets.*.config.sources.*.color' => ['required', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'widgets.*.config.sources.*.base' => ['required', 'array:label,color'],
            'widgets.*.config.sources.*.base.label' => ['required', 'string', 'max:80'],
            'widgets.*.config.sources.*.base.color' => ['required', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'widgets.*.config.sources.*.thresholds' => ['present', 'array', 'max:100'],
            'widgets.*.config.sources.*.thresholds.*' => ['array:value,label,color'],
            'widgets.*.config.sources.*.thresholds.*.value' => ['required', 'numeric'],
            'widgets.*.config.sources.*.thresholds.*.label' => ['required', 'string', 'max:80'],
            'widgets.*.config.sources.*.thresholds.*.color' => ['required', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'layouts' => ['present', 'array:lg,md,sm,xs,xxs'],
            'layouts.*' => ['array', 'max:100'],
            'layouts.*.*' => ['array:i,x,y,w,h'],
            'layouts.*.*.i' => ['required', 'string'],
            'layouts.*.*.x' => ['required', 'integer', 'between:0,12'],
            'layouts.*.*.y' => ['required', 'integer', 'between:0,100000'],
            'layouts.*.*.w' => ['required', 'integer', 'between:1,12'],
            'layouts.*.*.h' => ['required', 'integer', 'between:1,100'],
            'defaults' => ['required', 'array:range,timezone,refresh'],
            'defaults.timezone' => ['required', 'in:browser,utc'],
            'defaults.refresh' => ['required', 'integer', 'in:0,5,10,30,60'],
            'defaults.range' => ['required', 'array:mode,preset,from,to'],
            'defaults.range.mode' => ['required', 'in:relative,absolute'],
            'defaults.range.preset' => ['required_if:defaults.range.mode,relative', 'in:15m,1h,6h,24h,7d,30d'],
            'defaults.range.from' => ['required_if:defaults.range.mode,absolute', 'date'],
            'defaults.range.to' => ['required_if:defaults.range.mode,absolute', 'date', 'after:defaults.range.from', 'before_or_equal:now'],
        ]);
        $data['name'] = trim($data['name']);
        if ($data['defaults']['range']['mode'] === 'absolute' && strtotime($data['defaults']['range']['to']) - strtotime($data['defaults']['range']['from']) > 90 * 86400) {
            $this->fail('defaults.range', 'Choose a range of 90 days or less.');
        }
        if ($data['name'] === '') {
            $this->fail('name', 'Enter a dashboard name.');
        }
        $deviceIds = collect($data['widgets'])->flatMap(fn ($w) => array_column($w['config']['sources'], 'device_uuid'))->unique();
        $devices = Device::where('organization_id', $organization->id)->whereIn('uuid', $deviceIds)->get()->keyBy('uuid');
        $configurationIds = $devices->map(fn ($d) => $d->applied_configuration_uuid ?? $d->last_applied_configuration_uuid)->filter();
        $configs = DeviceConfiguration::whereIn('uuid', $configurationIds)->get()->keyBy('uuid');
        foreach ($data['widgets'] as $wi => &$widget) {
            $widget['title'] = trim($widget['title']);
            $widget['description'] = $widget['description'] ?? '';
            if ($widget['title'] === '') {
                $this->fail("widgets.$wi.title", 'Enter a panel title.');
            }
            $seen = [];
            $units = [];
            foreach ($widget['config']['sources'] as $si => &$source) {
                $path = "widgets.$wi.config.sources.$si";
                $key = $source['device_uuid'].':'.$source['parameter_uuid'];
                if (isset($seen[$key])) {
                    $this->fail($path, 'This parameter is already in the panel.');
                }
                $seen[$key] = true;
                $device = $devices->get($source['device_uuid']);
                $config = $device ? $configs->get($device->applied_configuration_uuid ?? $device->last_applied_configuration_uuid) : null;
                $definition = json_decode($config?->definition['profile_canonical_json'] ?? '{}', true);
                $parameter = collect($definition['parameters'] ?? [])->firstWhere('uuid', $source['parameter_uuid']);
                if (! $parameter || $config->device_id !== $device->id) {
                    $this->fail($path, 'Choose a parameter from an applied device profile in this organization.');
                }
                $source['unit'] = $parameter['unit'] ?? null;
                $source['data_type'] = $parameter['data_type'];
                $source['device_name'] = $device->name;
                $source['label'] = trim($source['label'] ?? '') ?: $parameter['label'];
                $numeric = in_array($source['data_type'], ['number', 'integer'], true);
                if (! $numeric && ($source['thresholds'] || $widget['type'] === 'timeseries')) {
                    $this->fail($path, 'Charts and numeric thresholds require a numeric parameter.');
                }
                $units[] = $source['unit'] ?? '';
                $boundaries = [];
                foreach ($source['thresholds'] as $ri => &$rule) {
                    $rule['value'] = (float) $rule['value'];
                    if (! is_finite($rule['value']) || in_array($rule['value'], $boundaries, true)) {
                        $this->fail("$path.thresholds.$ri.value", 'Enter a finite, unique threshold boundary.');
                    }
                    $boundaries[] = $rule['value'];
                }
                unset($rule);
                usort($source['thresholds'], fn ($a, $b) => $a['value'] <=> $b['value']);
            }
            unset($source);
            if ($widget['type'] === 'timeseries' && count(array_unique($units)) > 1) {
                $this->fail("widgets.$wi.config.sources", 'Use parameters with the same unit, or create a separate chart.');
            }
        }
        unset($widget);
        $ids = array_column($data['widgets'], 'id');
        sort($ids);
        foreach ($data['layouts'] as $breakpoint => $layout) {
            $layoutIds = array_column($layout, 'i');
            sort($layoutIds);
            if ($layoutIds !== $ids) {
                $this->fail("layouts.$breakpoint", 'Each panel must appear exactly once in each saved layout.');
            }
            $cols = ['lg' => 12, 'md' => 10, 'sm' => 6, 'xs' => 1, 'xxs' => 1][$breakpoint];
            foreach ($layout as $item) {
                if ($cols < $item['x'] + $item['w']) {
                    $this->fail("layouts.$breakpoint", 'Panels must fit inside the grid.');
                }
            }
        }

        return $data;
    }

    private function fail(string $field, string $message): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}
