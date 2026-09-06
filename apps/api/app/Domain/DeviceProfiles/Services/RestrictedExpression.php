<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\DeviceProfiles\Data\ProfileDiagnostic;
use InvalidArgumentException;

/** Bounded JSON Logic; no arbitrary code, I/O, or implicit input lookup. */
final class RestrictedExpression
{
    private const ARITY = ['and' => [1, 100], 'or' => [1, 100], '!' => [1, 1], '==' => [2, 2], '===' => [2, 2], '!=' => [2, 2], '!==' => [2, 2], '>' => [2, 2], '>=' => [2, 2], '<' => [2, 2], '<=' => [2, 2], '+' => [2, 100], '-' => [2, 2], '*' => [2, 100], '/' => [2, 2], 'in' => [2, 2]];

    public function diagnostics(mixed $expression, array $variables, string $pointer, string $prefix = 'validation_logic'): array
    {
        $diagnostics = [];
        $nodes = 0;
        $inspect = function (mixed $node, string $path, int $depth = 0, bool $literal = false) use (&$inspect, &$diagnostics, &$nodes, $variables, $prefix): void {
            $error = function (string $code, string $message) use (&$diagnostics, $prefix, $path): void {
                $diagnostics[] = new ProfileDiagnostic($prefix.'.'.$code, $message, $path);
            };
            if (++$nodes > 1000 || $depth > 32) {
                $error('expression_too_complex', 'Use fewer than 1000 nodes and 32 nesting levels.');

                return;
            }
            if (! is_array($node)) {
                if (! $literal) {
                    $error('invalid_expression', 'An expression must be a JSON Logic object.');
                }

                return;
            }
            if ($literal && array_is_list($node)) {
                foreach ($node as $index => $item) {
                    if ($nodes > 1000) {
                        break;
                    } $inspect($item, $path.'/'.$index, $depth + 1, true);
                }

                return;
            }
            if (count($node) !== 1 || array_is_list($node)) {
                $error('invalid_expression', 'Each expression must contain exactly one operator.');

                return;
            }
            $operator = array_key_first($node);
            $operands = $node[$operator];
            if ($operator === 'var') {
                $variable = is_array($operands) && count($operands) === 1 ? $operands[0] : $operands;
                if (! is_string($variable) || ! in_array($variable, $variables, true)) {
                    $error('unsupported_variable', 'Choose a declared input: '.implode(', ', $variables).'.');
                }

                return;
            }
            if (! isset(self::ARITY[$operator])) {
                $error('unsupported_operator', 'The operator "'.$operator.'" is not supported.');

                return;
            }
            $operands = is_array($operands) && array_is_list($operands) ? $operands : [$operands];
            [$min, $max] = self::ARITY[$operator];
            if (count($operands) < $min || count($operands) > $max) {
                $error('invalid_arity', 'Check the number of inputs for '.$operator.'.');
            }
            foreach ($operands as $index => $operand) {
                if ($nodes > 1000) {
                    break;
                } $inspect($operand, $path.'/'.$operator.'/'.$index, $depth + 1, true);
            }
        };
        $inspect($expression, $pointer);

        return $diagnostics;
    }

    public function evaluate(mixed $expression, array $context): mixed
    {
        if (! is_array($expression)) {
            return $expression;
        }
        if (array_is_list($expression)) {
            return array_map(fn ($item) => $this->evaluate($item, $context), $expression);
        }
        $operator = array_key_first($expression);
        $operands = $expression[$operator];
        if ($operator === 'var') {
            $alias = is_array($operands) ? $operands[0] : $operands;
            if (! array_key_exists($alias, $context)) {
                throw new InvalidArgumentException('Provide a sample value for '.$alias.'.');
            }

            return $context[$alias];
        }
        $operands = is_array($operands) && array_is_list($operands) ? $operands : [$operands];
        $values = array_map(fn ($item) => $this->evaluate($item, $context), $operands);
        if (in_array($operator, ['+', '-', '*', '/'], true)) {
            foreach ($values as $value) {
                if (! is_int($value) && ! is_float($value)) {
                    throw new InvalidArgumentException('Arithmetic inputs must be numbers.');
                }
            }
            if ($operator === '/' && $values[1] == 0) {
                throw new InvalidArgumentException('Division by zero is not defined.');
            }
        }
        $truthy = static fn ($value): bool => ! in_array($value, [false, null, 0, 0.0, '', []], true);
        $result = match ($operator) {
            'and' => ! in_array(false, array_map($truthy, $values), true),
            'or' => in_array(true, array_map($truthy, $values), true),
            '!' => ! $truthy($values[0]),
            '==' => $values[0] == $values[1], '===' => $values[0] === $values[1],
            '!=' => $values[0] != $values[1], '!==' => $values[0] !== $values[1],
            '>' => $values[0] > $values[1], '>=' => $values[0] >= $values[1],
            '<' => $values[0] < $values[1], '<=' => $values[0] <= $values[1],
            '+' => array_sum($values), '-' => $values[0] - $values[1],
            '*' => array_product($values), '/' => $values[0] / $values[1],
            'in' => is_array($values[1]) ? in_array($values[0], $values[1], true) : (is_string($values[1]) && is_string($values[0]) && str_contains($values[1], $values[0])),
            default => throw new InvalidArgumentException('Unsupported expression.'),
        };
        if (is_float($result) && ! is_finite($result)) {
            throw new InvalidArgumentException('The result is outside the supported numeric range.');
        }

        return $result;
    }
}
