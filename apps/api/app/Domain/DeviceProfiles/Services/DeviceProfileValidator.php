<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\DeviceProfiles\Data\ProfileDiagnostic;
use App\Domain\DeviceProfiles\Enums\ProfileParameterKind;
use App\Domain\DeviceProfiles\Models\DeviceProfile;

final class DeviceProfileValidator
{
    public function __construct(
        private readonly JsonLogicValidator $jsonLogic,
        private readonly CalculationGraphValidator $calculationGraph,
    ) {}

    /**
     * @return list<ProfileDiagnostic>
     */
    public function validate(DeviceProfile $profile): array
    {
        $profile->loadMissing([
            'parameters.group',
            'parameters.calculation',
            'calculations.target',
            'calculations.inputs.parameter',
            'alarmTemplates.parameterReferences.parameter',
        ]);

        $diagnostics = [];
        if ($profile->parameters->isEmpty()) {
            $diagnostics[] = new ProfileDiagnostic('profile.no_parameters', 'Add at least one parameter before publishing.', '/parameters');
        }
        foreach ($profile->parameters as $parameter) {
            $pointer = '/parameters/'.$parameter->uuid;
            foreach (app(ProfileConfigurationValidator::class)->errors($parameter->only(['display_config', 'reporting_config', 'counter_config'])) as $field => $messages) {
                foreach ($messages as $message) {
                    $diagnostics[] = new ProfileDiagnostic('parameter.invalid_configuration', $parameter->label.': '.$message, $pointer.'/'.str_replace('.', '/', $field));
                }
            }
            if ($parameter->kind === ProfileParameterKind::DERIVED && $parameter->calculation === null) {
                $diagnostics[] = new ProfileDiagnostic('calculation.missing_expression', 'Configure a calculation for '.$parameter->label.'.', $pointer.'/calculation');
            }

            if ($parameter->group !== null && $parameter->group->device_profile_id !== $profile->getKey()) {
                $diagnostics[] = new ProfileDiagnostic('parameter.cross_profile_group', 'A parameter group must belong to the same profile.', $pointer.'/parameter_group_uuid');
            }

            if ($parameter->kind === ProfileParameterKind::DERIVED && $parameter->accepts_command) {
                $diagnostics[] = new ProfileDiagnostic('parameter.derived_commandable', 'Derived parameters cannot accept commands.', $pointer.'/accepts_command');
            }

            $diagnostics = [...$diagnostics, ...$this->jsonLogic->validateDefinition($parameter->validation_logic, $pointer.'/validation_logic')];
        }

        $diagnostics = [...$diagnostics, ...$this->calculationGraph->validate($profile)];

        foreach ($profile->alarmTemplates as $template) {
            foreach ($template->parameterReferences as $reference) {
                if ($reference->parameter === null || $reference->parameter->device_profile_id !== $profile->getKey()) {
                    $diagnostics[] = new ProfileDiagnostic(
                        'alarm_template.cross_profile_parameter',
                        'Alarm template parameters must belong to the same profile.',
                        '/alarm_templates/'.$template->uuid.'/parameters/'.$reference->id,
                    );
                }
            }
        }

        return $diagnostics;
    }
}
