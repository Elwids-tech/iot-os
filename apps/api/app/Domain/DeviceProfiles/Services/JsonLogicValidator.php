<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\DeviceProfiles\Data\ProfileDiagnostic;
use InvalidArgumentException;

final class JsonLogicValidator
{
    public function __construct(private readonly RestrictedExpression $expressions) {}

    public function validateDefinition(?array $definition, string $pointer): array
    {
        if ($definition === null) {
            return [];
        }
        $diagnostics = [];
        if (($definition['engine'] ?? null) !== 'json_logic') {
            $diagnostics[] = new ProfileDiagnostic('validation_logic.unsupported_engine', 'Validation must use the json_logic engine.', $pointer.'/engine');
        }
        if (! isset($definition['rule']) || ! is_array($definition['rule'])) {
            $diagnostics[] = new ProfileDiagnostic('validation_logic.missing_rule', 'Validation requires a rule object.', $pointer.'/rule');
        } else {
            if (in_array(array_key_first($definition['rule']), ['+', '-', '*', '/'], true)) {
                $diagnostics[] = new ProfileDiagnostic('validation_logic.non_boolean_rule', 'Wrap arithmetic in a comparison so validation produces a Boolean result.', $pointer.'/rule');
            }
            $diagnostics = [...$diagnostics, ...$this->expressions->diagnostics($definition['rule'], ['value', 'previous_value'], $pointer.'/rule')];
        }
        foreach (['diagnostic_code', 'message'] as $field) {
            if (! is_string($definition[$field] ?? null) || trim($definition[$field]) === '') {
                $diagnostics[] = new ProfileDiagnostic('validation_logic.missing_'.$field, 'Provide a '.str_replace('_', ' ', $field).'.', $pointer.'/'.$field);
            }
        }

        return $diagnostics;
    }

    public function evaluate(array $definition, mixed $value, mixed $previousValue = null): array
    {
        if ($this->validateDefinition($definition, '/validation_logic') !== []) {
            return ['valid' => false, 'diagnostic_code' => 'validation_logic.invalid_expression', 'message' => 'The validation expression is invalid.'];
        }
        try {
            $valid = $this->expressions->evaluate($definition['rule'], ['value' => $value, 'previous_value' => $previousValue]) === true;

            return ['valid' => $valid, 'diagnostic_code' => $valid ? null : $definition['diagnostic_code'], 'message' => $valid ? null : $definition['message']];
        } catch (InvalidArgumentException $exception) {
            return ['valid' => false, 'diagnostic_code' => 'validation_logic.evaluation_failed', 'message' => $exception->getMessage()];
        }
    }
}
