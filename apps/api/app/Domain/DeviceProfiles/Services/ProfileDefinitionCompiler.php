<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\DeviceProfiles\Data\CompiledProfileDefinition;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use App\Domain\DeviceProfiles\Support\CanonicalJson;

final class ProfileDefinitionCompiler
{
    public function __construct(private readonly CanonicalJson $canonicalJson) {}

    public function compile(DeviceProfile $profile, ?int $revision = null): CompiledProfileDefinition
    {
        $profile->loadMissing([
            'parameters',
            'calculations.target',
            'calculations.inputs.parameter',
            'alarmTemplates.parameterReferences.parameter',
        ]);

        $parameters = $profile->parameters
            ->sortBy(fn (ProfileParameter $parameter): string => sprintf('%010d:%s', $parameter->sort_order, $parameter->key))
            ->values()
            ->map(fn (ProfileParameter $parameter): array => [
                'accepts_command' => $parameter->accepts_command,
                'counter' => $parameter->counter_config,
                'data_type' => $parameter->data_type->value,
                'display' => $parameter->display_config,
                'format' => $parameter->format,
                'key' => $parameter->key,
                'kind' => $parameter->kind->value,
                'label' => $parameter->label,
                'reporting' => $parameter->reporting_config,
                'reports_state' => $parameter->reports_state,
                'unit' => $parameter->unit,
                'uuid' => $parameter->uuid,
                'validation' => $parameter->validation_logic,
            ])->all();

        $calculations = $profile->calculations
            ->sortBy(fn ($calculation): string => $calculation->target?->key ?? $calculation->uuid)
            ->values()
            ->map(fn ($calculation): array => [
                'engine' => $calculation->engine,
                'expression' => $calculation->expression,
                'failure_policy' => $calculation->failure_policy,
                'inputs' => $calculation->inputs
                    ->sortBy('alias')
                    ->map(fn ($input): array => [
                        'alias' => $input->alias,
                        'parameter_uuid' => $input->parameter->uuid,
                    ])->values()->all(),
                'target_parameter_uuid' => $calculation->target->uuid,
                'trigger' => $calculation->trigger,
            ])->all();

        $alarms = $profile->alarmTemplates
            ->sortBy('code')
            ->values()
            ->map(fn ($template): array => [
                'code' => $template->code,
                'condition' => $template->condition_config,
                'enabled_by_default' => $template->enabled_by_default,
                'name' => $template->name,
                'parameters' => $template->parameterReferences
                    ->sortBy(fn ($reference): string => $reference->role.':'.$reference->parameter->uuid)
                    ->map(fn ($reference): array => [
                        'parameter_uuid' => $reference->parameter->uuid,
                        'role' => $reference->role,
                    ])->values()->all(),
                'severity' => $template->severity,
                'type' => $template->type,
                'uuid' => $template->uuid,
            ])->all();

        $definition = [
            'alarm_templates' => $alarms,
            'calculations' => $calculations,
            'profile' => [
                'category' => $profile->category,
                'code' => $profile->code,
                'name' => $profile->name,
                'revision' => $revision ?? $profile->revision,
                'uuid' => $profile->uuid,
            ],
            'parameters' => $parameters,
            'schema_version' => 'device-profile.v1',
        ];
        foreach ($definition as $section => $value) {
            $definition[$section] = $this->canonicalJson->normalize($value);
        }
        $canonicalJson = $this->canonicalJson->encode($definition);

        return new CompiledProfileDefinition($definition, $canonicalJson, hash('sha256', $canonicalJson));
    }
}
