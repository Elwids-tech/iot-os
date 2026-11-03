<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;

/**
 * Mappings a profile suggests for a Sparkplug source: the mapping-suggestions endpoint
 * and bulk onboarding (spec 026 US5) share them.
 */
final class MappingSuggestions
{
    /**
     * The profile's direct Sparkplug bindings, read against the artifact's pinned
     * parameters. Bindings that transform or decode values are left out.
     *
     * @return list<array{binding_uuid: string, name: string, mappings: list<array{parameter_uuid: string, metric: string, command_metric: string|null}>}>
     */
    public function bindings(DeviceProfileArtifact $artifact): array
    {
        $parameters = collect($artifact->definition['parameters'])->keyBy('uuid');
        $suggestions = [];
        foreach ($artifact->profile->transportBindings()->with('parameterMappings.parameter')->orderBy('id')->limit(100)->get() as $binding) {
            $mappings = [];
            foreach ($binding->parameterMappings as $mapping) {
                $uuid = $mapping->parameter->uuid;
                $parameter = $parameters->get($uuid);
                $metric = $mapping->transport_locator['metric_name'] ?? $mapping->transport_locator['metric'] ?? null;
                if (! $parameter || ! $parameter['reports_state'] || $parameter['kind'] === 'derived' || ! is_string($metric) || $metric === '' || $mapping->transform_config || $mapping->codec_config) {
                    continue;
                }
                $mappings[$uuid] ??= ['parameter_uuid' => $uuid, 'metric' => '', 'command_metric' => null];
                if (in_array($mapping->direction, ['ingress', 'bidirectional'], true)) {
                    $mappings[$uuid]['metric'] = $metric;
                }
                if ($parameter['accepts_command'] && in_array($mapping->direction, ['egress', 'bidirectional'], true)) {
                    $mappings[$uuid]['command_metric'] = $metric;
                }
            }
            $mappings = array_values(array_filter($mappings, fn ($mapping) => $mapping['metric'] !== ''));
            if ($mappings) {
                $suggestions[] = ['binding_uuid' => $binding->uuid, 'name' => $binding->name, 'mappings' => $mappings];
            }
        }

        return $suggestions;
    }

    /**
     * A draft's mappings for one source's birth metrics: for every reported parameter, a
     * binding's metric when the birth has it, else the birth metric named like the
     * parameter's key or label (as the portal's automatic match does). Parameters with
     * no usable metric are returned as problems, for example `missing metric flow_rate`
     * or `datatype String for number parameter level`.
     *
     * @param  list<array{name: string, datatype: string}>  $metrics
     * @return array{mappings: list<array{parameter_uuid: string, metric: string, command_metric: string|null}>, problems: list<string>}
     */
    public function forSource(DeviceProfileArtifact $artifact, array $metrics): array
    {
        $births = collect($metrics)->keyBy('name');
        $byName = collect($metrics)->keyBy(fn ($metric) => self::normalize($metric['name']));
        $suggested = [];
        foreach ($this->bindings($artifact) as $binding) {
            foreach ($binding['mappings'] as $mapping) {
                $suggested[$mapping['parameter_uuid']][] = $mapping;
            }
        }
        $mappings = [];
        $problems = [];
        foreach ($artifact->definition['parameters'] as $parameter) {
            if (! $parameter['reports_state'] || $parameter['kind'] === 'derived') {
                continue;
            }
            $accepted = DeviceConfigurationService::acceptedDatatypes($parameter['data_type'], ($parameter['ingress_conversion'] ?? null) !== null);
            $found = null;
            foreach ($suggested[$parameter['uuid']] ?? [] as $mapping) {
                if ($births->has($mapping['metric'])) {
                    $found = ['metric' => $births[$mapping['metric']], 'command' => $mapping['command_metric']];
                    break;
                }
            }
            $found ??= ($metric = $byName->get(self::normalize($parameter['key'])) ?? $byName->get(self::normalize($parameter['label']))) ? ['metric' => $metric, 'command' => null] : null;
            if (! $found) {
                $problems[] = 'missing metric '.($suggested[$parameter['uuid']][0]['metric'] ?? $parameter['key']);

                continue;
            }
            if (! in_array($found['metric']['datatype'], $accepted, true)) {
                $problems[] = 'datatype '.$found['metric']['datatype'].' for '.$parameter['data_type'].' parameter '.$parameter['key'];

                continue;
            }
            $command = $found['command'] && in_array($births->get($found['command'])['datatype'] ?? null, $accepted, true) ? $found['command'] : null;
            $mappings[] = ['parameter_uuid' => $parameter['uuid'], 'metric' => $found['metric']['name'], 'command_metric' => $command];
        }

        return ['mappings' => $mappings, 'problems' => $problems];
    }

    /** Matches the portal's automatic match: case, spaces, dots, dashes and underscores are ignored. */
    private static function normalize(string $name): string
    {
        return (string) preg_replace('/[\s._-]/', '', mb_strtolower($name));
    }
}
