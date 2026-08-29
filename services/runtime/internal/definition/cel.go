package definition

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/google/cel-go/cel"
)

type expressionCompiler struct {
	environment *cel.Env
	programs    map[string]cel.Program
	mutex       sync.RWMutex
}

func newExpressionCompiler() (*expressionCompiler, error) {
	environment, err := cel.NewEnv(
		cel.Variable("value", cel.DynType),
		cel.Variable("p", cel.MapType(cel.StringType, cel.DynType)),
		cel.Variable("message", cel.DynType),
		cel.Variable("record", cel.DynType),
		cel.Variable("route", cel.DynType),
		cel.Variable("topic", cel.StringType),
		cel.Variable("command", cel.DynType),
		cel.Variable("route_variables", cel.MapType(cel.StringType, cel.StringType)),
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

	compiler.mutex.RLock()
	_, exists := compiler.programs[source]
	compiler.mutex.RUnlock()
	if exists {
		return nil
	}
	compiler.mutex.Lock()
	defer compiler.mutex.Unlock()
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

	activation := make(map[string]any, len(variables))
	for key, value := range variables {
		activation[key] = normalizeForCEL(value)
	}

	compiler.mutex.RLock()
	program := compiler.programs[source]
	compiler.mutex.RUnlock()
	result, _, err := program.ContextEval(ctx, activation)
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
