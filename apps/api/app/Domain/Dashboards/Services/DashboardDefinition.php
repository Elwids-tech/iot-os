<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Services;

use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Geospatial\Models\Geofence;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class DashboardDefinition
{
    /** Bars per consumption panel; "auto" picks one from the dashboard range. */
    public const CONSUMPTION_BUCKETS = ['auto', '15m', '1h', '1d', '1w', '1mo'];

    /** "dashboard" follows the dashboard range; the others are calendar periods in the device's time zone. */
    public const CONSUMPTION_PERIODS = ['dashboard', 'today', '7d', 'month', '12mo'];

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
                'label' => '', 'unit' => null, 'data_type' => 'number', 'format' => null, 'display_widget' => null, 'precision' => null,
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
        return $this->validateDocument($request->all(), $organization, $updating);
    }

    /**
     * Checks a dashboard document without saving it and returns it with each source's
     * metadata taken from the applied profile.
     *
     * @param  array<string, mixed>  $document
     * @return array<string, mixed>
     */
    public function validateDocument(array $document, Organization $organization, bool $updating): array
    {
        $data = Validator::make($document, [
            'name' => ['required', 'string', 'max:120'],
            'revision' => [$updating ? 'required' : 'sometimes', 'integer', 'min:1'],
            'widgets' => ['present', 'array', 'max:100'],
            'widgets.*' => ['array:id,schema_version,type,title,description,config'],
            'widgets.*.id' => ['required', 'string', 'max:100', 'distinct:strict'],
            'widgets.*.schema_version' => ['required', 'integer', 'in:2'],
            'widgets.*.type' => ['required', 'in:status,timeseries,controls,state_history,color_history,location,alerts,gauge,table,text,device_health,consumption'],
            'widgets.*.title' => ['required', 'string', 'max:120'],
            'widgets.*.description' => ['nullable', 'string', 'max:1000'],
            'widgets.*.config' => ['required', 'array:sources,columns,workflow_uuid,min,max,text,devices,location_device_uuids,geofence_uuid,show_trails,show_labels,trail_window,bucket,period'],
            'widgets.*.config.sources' => ['present', 'array', 'max:100'],
            'widgets.*.config.workflow_uuid' => ['sometimes', 'uuid'],
            'widgets.*.config.location_device_uuids' => ['sometimes', 'array', 'max:100'],
            'widgets.*.config.location_device_uuids.*' => ['required', 'uuid'],
            'widgets.*.config.geofence_uuid' => ['sometimes', 'uuid'],
            'widgets.*.config.show_trails' => ['sometimes', 'boolean'],
            'widgets.*.config.show_labels' => ['sometimes', 'boolean'],
            'widgets.*.config.trail_window' => ['sometimes', Rule::in(['1h', '6h', '24h', '7d'])],
            'widgets.*.config.columns' => ['sometimes', Rule::in(['auto', 1, 2, 3, 4])],
            'widgets.*.config.bucket' => ['sometimes', Rule::in(self::CONSUMPTION_BUCKETS)],
            'widgets.*.config.period' => ['sometimes', Rule::in(self::CONSUMPTION_PERIODS)],
            'widgets.*.config.min' => ['required_if:widgets.*.type,gauge', 'numeric'],
            'widgets.*.config.max' => ['required_if:widgets.*.type,gauge', 'numeric'],
            'widgets.*.config.text' => ['required_if:widgets.*.type,text', 'string', 'max:4000'],
            'widgets.*.config.devices' => ['required_if:widgets.*.type,device_health', 'array', 'min:1', 'max:50'],
            'widgets.*.config.devices.*' => ['array:device_uuid,device_name'],
            'widgets.*.config.devices.*.device_uuid' => ['required', 'uuid'],
            'widgets.*.config.devices.*.device_name' => ['sometimes', 'string', 'max:255'],
            'widgets.*.config.sources.*' => ['array:device_uuid,parameter_uuid,device_name,label,unit,data_type,format,display_widget,precision,color,base,thresholds'],
            'widgets.*.config.sources.*.device_uuid' => ['required', 'uuid'],
            'widgets.*.config.sources.*.parameter_uuid' => ['required', 'uuid'],
            'widgets.*.config.sources.*.device_name' => ['sometimes', 'string', 'max:255'],
            'widgets.*.config.sources.*.label' => ['nullable', 'string', 'max:120'],
            'widgets.*.config.sources.*.unit' => ['nullable', 'string', 'max:100'],
            'widgets.*.config.sources.*.data_type' => ['required', 'string'],
            'widgets.*.config.sources.*.format' => ['nullable', 'string', 'max:100'],
            'widgets.*.config.sources.*.display_widget' => ['nullable', 'string', 'max:100'],
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
            'tags' => ['sometimes', 'array', 'max:10'],
            'tags.*' => ['required', 'string', 'max:32'],
            'folder' => ['sometimes', 'nullable', 'string', 'max:60'],
            'defaults' => ['required', 'array:range,timezone,refresh'],
            'defaults.timezone' => ['required', 'in:browser,utc'],
            'defaults.refresh' => ['required', 'integer', 'in:0,5,10,30,60'],
            'defaults.range' => ['required', 'array:mode,preset,from,to'],
            'defaults.range.mode' => ['required', 'in:relative,absolute'],
            'defaults.range.preset' => ['required_if:defaults.range.mode,relative', 'in:15m,1h,6h,24h,7d,30d'],
            'defaults.range.from' => ['required_if:defaults.range.mode,absolute', 'date'],
            'defaults.range.to' => ['required_if:defaults.range.mode,absolute', 'date', 'after:defaults.range.from', 'before_or_equal:now'],
        ])->validate();
        $data['name'] = trim($data['name']);
        if ($data['defaults']['range']['mode'] === 'absolute' && strtotime($data['defaults']['range']['to']) - strtotime($data['defaults']['range']['from']) > 400 * 86400) {
            $this->fail('defaults.range', 'Choose a range of 400 days or less.');
        }
        if ($data['name'] === '') {
            $this->fail('name', 'Enter a dashboard name.');
        }
        if (isset($data['tags'])) {
            $tags = [];
            foreach ($data['tags'] as $ti => $tag) {
                $tag = trim($tag);
                if ($tag === '') {
                    $this->fail("tags.$ti", 'Enter a tag of 1 to 32 characters.');
                }
                $tags[mb_strtolower($tag)] ??= $tag;
            }
            $data['tags'] = array_values($tags);
        }
        if (array_key_exists('folder', $data)) {
            $folder = trim((string) $data['folder']);
            $data['folder'] = $folder === '' ? null : $folder;
        }
        $deviceIds = collect($data['widgets'])->flatMap(fn ($w) => [...array_column($w['config']['sources'], 'device_uuid'), ...array_column($w['config']['devices'] ?? [], 'device_uuid')])->unique();
        $devices = Device::where('organization_id', $organization->id)->whereIn('uuid', $deviceIds)->get()->keyBy('uuid');
        $configurationIds = $devices->map(fn ($d) => $d->applied_configuration_uuid ?? $d->last_applied_configuration_uuid)->filter();
        $configs = DeviceConfiguration::whereIn('uuid', $configurationIds)->get()->keyBy('uuid');
        foreach ($data['widgets'] as $wi => &$widget) {
            $widget['title'] = trim($widget['title']);
            $widget['description'] = $widget['description'] ?? '';
            if ($widget['title'] === '') {
                $this->fail("widgets.$wi.title", 'Enter a panel title.');
            }
            $settings = ['location' => ['sources', 'workflow_uuid', 'location_device_uuids', 'geofence_uuid', 'show_trails', 'show_labels', 'trail_window'], 'gauge' => ['sources', 'min', 'max'], 'table' => ['sources'], 'text' => ['sources', 'text'], 'device_health' => ['sources', 'devices'], 'consumption' => ['sources', 'bucket', 'period']][$widget['type']] ?? ['sources', 'columns', 'workflow_uuid'];
            if (array_diff(array_keys($widget['config']), $settings)) {
                $this->fail("widgets.$wi.config", 'This panel type does not accept these settings.');
            }
            if ($widget['type'] === 'text') {
                if ($widget['config']['sources'] !== []) {
                    $this->fail("widgets.$wi.config", 'Text panels accept no parameter sources.');
                }
                if (trim($widget['config']['text']) === '') {
                    $this->fail("widgets.$wi.config.text", 'Enter the panel text.');
                }

                continue;
            }
            if ($widget['type'] === 'device_health') {
                if ($widget['config']['sources'] !== []) {
                    $this->fail("widgets.$wi.config", 'Device health panels accept devices and no parameter sources.');
                }
                $seen = [];
                foreach ($widget['config']['devices'] as $di => &$entry) {
                    $device = $devices->get($entry['device_uuid']);
                    if (! $device || isset($seen[$device->id])) {
                        $this->fail("widgets.$wi.config.devices.$di", 'Choose each device once from this organization.');
                    }
                    $seen[$device->id] = true;
                    $entry['device_name'] = $device->name;
                }
                unset($entry);

                continue;
            }
            if ($widget['type'] === 'gauge') {
                $widget['config']['min'] = (float) $widget['config']['min'];
                $widget['config']['max'] = (float) $widget['config']['max'];
                if (! is_finite($widget['config']['min']) || ! is_finite($widget['config']['max']) || $widget['config']['min'] >= $widget['config']['max']) {
                    $this->fail("widgets.$wi.config.max", 'Enter a maximum greater than the minimum.');
                }
                if (count($widget['config']['sources']) > 4) {
                    $this->fail("widgets.$wi.config.sources", 'A gauge shows up to 4 parameters.');
                }
            }
            if ($widget['type'] === 'location') {
                if ($widget['config']['sources'] !== [] || isset($widget['config']['columns'])) {
                    $this->fail("widgets.$wi.config", 'GPS map panels accept devices and no parameter sources.');
                }
                $locationDevices = $widget['config']['location_device_uuids'] ?? [];
                if (count(array_unique($locationDevices)) !== count($locationDevices)) {
                    $this->fail("widgets.$wi.config.location_device_uuids", 'Choose each GPS device once per panel.');
                }
                $legacyWorkflow = $widget['config']['workflow_uuid'] ?? null;
                if (! $locationDevices && ! $legacyWorkflow) {
                    $this->fail("widgets.$wi.config.location_device_uuids", 'Choose at least one GPS device.');
                }
                if ($locationDevices && Device::where('organization_id', $organization->id)->whereIn('uuid', $locationDevices)->count() !== count($locationDevices)) {
                    $this->fail("widgets.$wi.config.location_device_uuids", 'Every GPS device must belong to this organization.');
                }
                if (($fence = $widget['config']['geofence_uuid'] ?? null) && ! Geofence::where('organization_id', $organization->id)->where('uuid', $fence)->exists()) {
                    $this->fail("widgets.$wi.config.geofence_uuid", 'Choose a geofence in this organization.');
                }
                if ($legacyWorkflow && ! Workflow::where('organization_id', $organization->id)->where('uuid', $legacyWorkflow)->exists()) {
                    $this->fail("widgets.$wi.config.workflow_uuid", 'Choose a workflow in this organization.');
                }

                continue;
            }
            if ($widget['type'] === 'alerts') {
                if ($widget['config']['sources'] !== [] || isset($widget['config']['columns'])) {
                    $this->fail("widgets.$wi.config", 'Workflow panels accept one workflow and no parameter sources.');
                }
                $workflowId = $widget['config']['workflow_uuid'] ?? null;
                if (! $workflowId || ! Workflow::where('organization_id', $organization->id)->where('uuid', $workflowId)->exists()) {
                    $this->fail("widgets.$wi.config.workflow_uuid", 'Choose a workflow in this organization.');
                }

                continue;
            }
            if (isset($widget['config']['workflow_uuid']) || count($widget['config']['sources']) < 1) {
                $this->fail("widgets.$wi.config", 'Parameter panels require sources and cannot select a workflow.');
            }
            if (array_key_exists('columns', $widget['config'])) {
                if ($widget['type'] !== 'controls') {
                    $this->fail("widgets.$wi.config.columns", 'Cards per row is only available for controls panels.');
                }
                if ($widget['config']['columns'] !== 'auto') {
                    $widget['config']['columns'] = (int) $widget['config']['columns'];
                }
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
                if ($widget['type'] === 'controls') {
                    $mapping = collect($config->definition['mappings'] ?? [])->firstWhere('parameter_uuid', $parameter['uuid']);
                    if ($device->applied_configuration_uuid !== $config->uuid || ($parameter['kind'] ?? '') !== 'state' || ! ($parameter['accepts_command'] ?? false) || ! ($parameter['reports_state'] ?? false) || empty($mapping['command_metric']) || ! in_array($parameter['data_type'], ['boolean', 'integer', 'number', 'enum', 'string'], true)) {
                        $this->fail($path, 'Choose a writable state parameter with an applied command mapping.');
                    }
                    $source['thresholds'] = [];
                }
                $source['data_type'] = $parameter['data_type'];
                $source['format'] = $parameter['format'] ?? null;
                $source['display_widget'] = $parameter['display']['widget'] ?? null;
                $source['device_name'] = $device->name;
                $source['label'] = trim($source['label'] ?? '') ?: $parameter['label'];
                $numeric = in_array($source['data_type'], ['number', 'integer'], true);
                if ($widget['type'] === 'gauge' && ! $numeric) {
                    $this->fail($path, 'Gauges require a numeric parameter.');
                }
                if ($widget['type'] === 'consumption') {
                    if (! $numeric || ($parameter['kind'] ?? null) !== 'counter') {
                        $this->fail($path, 'Consumption requires a counter parameter.');
                    }
                    $source['thresholds'] = [];
                }
                if ($widget['type'] === 'state_history' && ! in_array($source['data_type'], ['boolean', 'enum'], true)) {
                    $this->fail($path, 'State history requires a boolean or enum parameter.');
                }
                if ($widget['type'] === 'color_history' && ! ($source['data_type'] === 'string' && ($source['format'] === 'hex_color' || $source['display_widget'] === 'color'))) {
                    $this->fail($path, 'Colour history requires a string parameter configured as a colour control.');
                }
                if (in_array($widget['type'], ['state_history', 'color_history'], true)) {
                    $source['thresholds'] = [];
                }
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
            if ($widget['type'] === 'consumption') {
                if (count($widget['config']['sources']) > 4) {
                    $this->fail("widgets.$wi.config.sources", 'A consumption panel shows up to 4 counters.');
                }
                if (($widget['config']['period'] ?? 'dashboard') !== 'dashboard' && ($widget['config']['bucket'] ?? 'auto') !== 'auto') {
                    $this->fail("widgets.$wi.config.bucket", 'Calendar periods choose their own bars. Use Auto.');
                }
            }
            if (in_array($widget['type'], ['timeseries', 'consumption'], true) && count(array_unique($units)) > 1) {
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
