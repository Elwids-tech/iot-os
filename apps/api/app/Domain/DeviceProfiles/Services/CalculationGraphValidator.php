<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\DeviceProfiles\Data\ProfileDiagnostic;
use App\Domain\DeviceProfiles\Enums\ProfileParameterKind;
use App\Domain\DeviceProfiles\Models\DeviceProfile;

final class CalculationGraphValidator
{
    public function __construct(private readonly RestrictedExpression $expressions) {}

    /**
     * @return list<ProfileDiagnostic>
     */
    public function validate(DeviceProfile $profile): array
    {
        $profile->loadMissing(['calculations.target', 'calculations.inputs.parameter']);
        $diagnostics = [];
        $edges = [];

        foreach ($profile->calculations as $calculation) {
            $target = $calculation->target;
            $pointer = '/calculations/'.$calculation->uuid;
            $diagnostics = [...$diagnostics, ...$this->expressions->diagnostics($calculation->expression, $calculation->inputs->pluck('alias')->all(), $pointer.'/expression', 'calculation')];

            if ($target === null || $target->device_profile_id !== $profile->getKey()) {
                $diagnostics[] = new ProfileDiagnostic('calculation.invalid_target', 'A calculation target must belong to this profile.', $pointer.'/target_parameter_uuid');

                continue;
            }

            if ($target->kind !== ProfileParameterKind::DERIVED) {
                $diagnostics[] = new ProfileDiagnostic('calculation.target_not_derived', 'Only derived parameters can be calculation targets.', $pointer.'/target_parameter_uuid');
            }

            $edges[$target->uuid] ??= [];
            foreach ($calculation->inputs as $input) {
                $parameter = $input->parameter;
                if ($parameter === null || $parameter->device_profile_id !== $profile->getKey()) {
                    $diagnostics[] = new ProfileDiagnostic('calculation.cross_profile_input', 'Calculation inputs must belong to the same profile.', $pointer.'/inputs/'.$input->id);

                    continue;
                }

                if ($parameter->kind === ProfileParameterKind::DERIVED) {
                    $edges[$target->uuid][] = $parameter->uuid;
                }
            }
        }

        $visiting = [];
        $visited = [];
        foreach (array_keys($edges) as $targetUuid) {
            if ($this->hasCycle($targetUuid, $edges, $visiting, $visited)) {
                $diagnostics[] = new ProfileDiagnostic('calculation.dependency_cycle', 'Calculation dependencies contain a cycle.', '/calculations');
                break;
            }
        }

        return $diagnostics;
    }

    /**
     * @param  array<string, list<string>>  $edges
     * @param  array<string, true>  $visiting
     * @param  array<string, true>  $visited
     */
    private function hasCycle(string $node, array $edges, array &$visiting, array &$visited): bool
    {
        if (isset($visiting[$node])) {
            return true;
        }
        if (isset($visited[$node])) {
            return false;
        }

        $visiting[$node] = true;
        foreach ($edges[$node] ?? [] as $dependency) {
            if ($this->hasCycle($dependency, $edges, $visiting, $visited)) {
                return true;
            }
        }
        unset($visiting[$node]);
        $visited[$node] = true;

        return false;
    }
}
