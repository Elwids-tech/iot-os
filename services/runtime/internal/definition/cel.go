package definition

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/cel-go/cel"
)

type expressionCompiler struct {
	environment *cel.Env
	programs    map[string]cel.Program
}

func newExpressionCompiler() (*expressionCompiler, error) {
	environment, err := cel.NewEnv(
		cel.Variable("payload", cel.DynType),
		cel.Variable("record", cel.DynType),
		cel.Variable("value", cel.DynType),
		cel.Variable("values", cel.MapType(cel.StringType, cel.DynType)),
		cel.Variable("topic", cel.StringType),
		cel.Variable("observed_at", cel.DynType),
		cel.Variable("received_at", cel.DynType),
		cel.Variable("device", cel.DynType),
		cel.Variable("message", cel.DynType),
		cel.Variable("bundle", cel.DynType),
	)
	if err != nil {
		return nil, fmt.Errorf("create CEL environment: %w", err)
	}

	return &expressionCompiler{
		environment: environment,
		programs:    map[string]cel.Program{},
	}, nil
}

func (compiler *expressionCompiler) Compile(source string) error {
	if strings.TrimSpace(source) == "" {
		return errors.New("CEL expression cannot be empty")
	}

	if len(source) > 4_096 {
		return errors.New("CEL expression exceeds 4096 bytes")
	}

	if _, exists := compiler.programs[source]; exists {
		return nil
	}

	abstractSyntaxTree, issues := compiler.environment.Compile(source)
	if issues != nil && issues.Err() != nil {
		return issues.Err()
	}

	program, err := compiler.environment.Program(
		abstractSyntaxTree,
		cel.CostLimit(maximumCELCost),
	)
	if err != nil {
		return err
	}

	compiler.programs[source] = program

	return nil
}

func (compiler *expressionCompiler) Evaluate(
	ctx context.Context,
	source string,
	variables map[string]any,
) (any, error) {
	if err := compiler.Compile(source); err != nil {
		return nil, err
	}

	program := compiler.programs[source]
	result, _, err := program.ContextEval(ctx, variables)
	if err != nil {
		return nil, err
	}

	native := result.Value()
	canonical, err := canonicalBytes(native)
	if err != nil {
		return nil, fmt.Errorf("CEL result is not JSON compatible: %w", err)
	}

	if len(canonical) > maximumOutputBytes {
		return nil, fmt.Errorf("CEL result exceeds %d bytes", maximumOutputBytes)
	}

	return native, nil
}

func (compiler *expressionCompiler) ApplyTransform(
	ctx context.Context,
	transform *Transform,
	value any,
	variables map[string]any,
) (any, error) {
	if transform == nil {
		return value, nil
	}

	transformed := value
	if transform.Preset != "" {
		presetValue, err := applyPreset(transform.Preset, transformed)
		if err != nil {
			return nil, err
		}
		transformed = presetValue
	}

	if transform.CEL != "" {
		activation := make(map[string]any, len(variables)+1)
		for key, item := range variables {
			activation[key] = normalizeForCEL(item)
		}
		activation["value"] = normalizeForCEL(transformed)

		return compiler.Evaluate(ctx, transform.CEL, activation)
	}

	return transformed, nil
}

func applyPreset(name string, value any) (any, error) {
	switch name {
	case "identity":
		return value, nil
	case "trim":
		text, ok := value.(string)
		if !ok {
			return nil, errors.New("trim preset requires a string")
		}

		return strings.TrimSpace(text), nil
	case "lowercase":
		text, ok := value.(string)
		if !ok {
			return nil, errors.New("lowercase preset requires a string")
		}

		return strings.ToLower(text), nil
	case "uppercase":
		text, ok := value.(string)
		if !ok {
			return nil, errors.New("uppercase preset requires a string")
		}

		return strings.ToUpper(text), nil
	case "celsius_to_fahrenheit":
		number, ok := numericValue(value)
		if !ok {
			return nil, errors.New("celsius_to_fahrenheit preset requires a number")
		}

		return (number * 9 / 5) + 32, nil
	case "fahrenheit_to_celsius":
		number, ok := numericValue(value)
		if !ok {
			return nil, errors.New("fahrenheit_to_celsius preset requires a number")
		}

		return (number - 32) * 5 / 9, nil
	default:
		return nil, fmt.Errorf("transform preset %q is not supported by %s", name, celEnvironment)
	}
}
