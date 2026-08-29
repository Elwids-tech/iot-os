package definition

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
)

func validateOperations(expressions *expressionCompiler, operations []CalibrationOperation) error {
	if len(operations) > 16 {
		return errors.New("calibration pipeline exceeds 16 operations")
	}

	for index, operation := range operations {
		if err := validateOperation(expressions, operation); err != nil {
			return fmt.Errorf("operation %d: %w", index, err)
		}
	}

	return nil
}

func validateOperation(expressions *expressionCompiler, operation CalibrationOperation) error {
	switch operation.Op {
	case "multiply", "add", "subtract":
		if operation.Value == nil {
			return fmt.Errorf("%s requires value", operation.Op)
		}
		if operation.Exponent != nil || operation.Minimum != nil || operation.Maximum != nil || operation.Precision != nil || operation.Expression != "" {
			return fmt.Errorf("%s contains fields from another operation", operation.Op)
		}
	case "divide":
		if operation.Value == nil || *operation.Value == 0 {
			return errors.New("divide requires a non-zero value")
		}
		if operation.Exponent != nil || operation.Minimum != nil || operation.Maximum != nil || operation.Precision != nil || operation.Expression != "" {
			return errors.New("divide contains fields from another operation")
		}
	case "power":
		if operation.Exponent == nil || *operation.Exponent < -16 || *operation.Exponent > 16 {
			return errors.New("power requires exponent between -16 and 16")
		}
		if operation.Value != nil || operation.Minimum != nil || operation.Maximum != nil || operation.Precision != nil || operation.Expression != "" {
			return errors.New("power contains fields from another operation")
		}
	case "clamp":
		if operation.Minimum == nil && operation.Maximum == nil {
			return errors.New("clamp requires minimum or maximum")
		}
		if operation.Minimum != nil && operation.Maximum != nil && *operation.Minimum > *operation.Maximum {
			return errors.New("clamp minimum cannot exceed maximum")
		}
		if operation.Value != nil || operation.Exponent != nil || operation.Precision != nil || operation.Expression != "" {
			return errors.New("clamp contains fields from another operation")
		}
	case "round":
		if operation.Precision == nil || *operation.Precision < 0 || *operation.Precision > 12 {
			return errors.New("round requires precision between 0 and 12")
		}
		if operation.Value != nil || operation.Exponent != nil || operation.Minimum != nil || operation.Maximum != nil || operation.Expression != "" {
			return errors.New("round contains fields from another operation")
		}
	case "cel":
		if operation.Value != nil || operation.Exponent != nil || operation.Minimum != nil || operation.Maximum != nil || operation.Precision != nil {
			return errors.New("cel contains fields from another operation")
		}
		if err := expressions.Compile(operation.Expression); err != nil {
			return fmt.Errorf("compile CEL: %w", err)
		}
	default:
		return fmt.Errorf("unsupported calibration operation %q", operation.Op)
	}

	return nil
}

func applyOperations(
	ctx context.Context,
	expressions *expressionCompiler,
	operations []CalibrationOperation,
	value any,
	variables map[string]any,
) (any, error) {
	current := value
	for _, operation := range operations {
		var err error
		switch operation.Op {
		case "multiply":
			current, err = numericOperation(current, func(number float64) float64 {
				return number * *operation.Value
			})
		case "divide":
			current, err = numericOperation(current, func(number float64) float64 {
				return number / *operation.Value
			})
		case "add":
			current, err = numericOperation(current, func(number float64) float64 {
				return number + *operation.Value
			})
		case "subtract":
			current, err = numericOperation(current, func(number float64) float64 {
				return number - *operation.Value
			})
		case "power":
			current, err = numericOperation(current, func(number float64) float64 {
				return math.Pow(number, *operation.Exponent)
			})
		case "clamp":
			current, err = numericOperation(current, func(number float64) float64 {
				if operation.Minimum != nil && number < *operation.Minimum {
					return *operation.Minimum
				}
				if operation.Maximum != nil && number > *operation.Maximum {
					return *operation.Maximum
				}

				return number
			})
		case "round":
			factor := math.Pow10(*operation.Precision)
			current, err = numericOperation(current, func(number float64) float64 {
				return math.Round(number*factor) / factor
			})
		case "cel":
			activation := make(map[string]any, len(variables)+1)
			for key, item := range variables {
				activation[key] = item
			}
			activation["value"] = current
			current, err = expressions.Evaluate(ctx, operation.Expression, activation)
		default:
			err = fmt.Errorf("unsupported calibration operation %q", operation.Op)
		}

		if err != nil {
			return nil, fmt.Errorf("apply %s: %w", operation.Op, err)
		}
	}

	return current, nil
}

func numericOperation(value any, operation func(float64) float64) (any, error) {
	number, ok := numericValue(value)
	if !ok {
		return nil, errors.New("operation requires a finite numeric value")
	}

	result := operation(number)
	if math.IsNaN(result) || math.IsInf(result, 0) {
		return nil, errors.New("operation produced a non-finite value")
	}

	return result, nil
}

func coerceValue(value any, dataType string) (any, error) {
	switch dataType {
	case "float64":
		number, ok := numericValue(value)
		if !ok {
			return nil, errors.New("expected a finite number")
		}

		return number, nil
	case "int64":
		return coerceInt64(value)
	case "uint64":
		return coerceUint64(value)
	case "boolean":
		boolean, ok := value.(bool)
		if !ok {
			return nil, errors.New("expected a boolean")
		}

		return boolean, nil
	case "string", "state":
		text, ok := value.(string)
		if !ok {
			return nil, errors.New("expected a string")
		}

		return text, nil
	case "bytes":
		switch typed := value.(type) {
		case string:
			if _, err := base64.StdEncoding.DecodeString(typed); err != nil {
				return nil, errors.New("expected a base64-encoded string")
			}

			return typed, nil
		case []byte:
			return base64.StdEncoding.EncodeToString(typed), nil
		default:
			return nil, errors.New("expected a base64-encoded string")
		}
	default:
		return nil, fmt.Errorf("unsupported data type %q", dataType)
	}
}

func coerceInt64(value any) (int64, error) {
	switch typed := value.(type) {
	case json.Number:
		if integer, err := typed.Int64(); err == nil {
			return integer, nil
		}
	case int:
		return int64(typed), nil
	case int64:
		return typed, nil
	case int32:
		return int64(typed), nil
	case uint:
		if uint64(typed) <= math.MaxInt64 {
			return int64(typed), nil
		}
	case uint64:
		if typed <= math.MaxInt64 {
			return int64(typed), nil
		}
	case float64:
		if typed >= math.MinInt64 && typed <= math.MaxInt64 && math.Trunc(typed) == typed {
			return int64(typed), nil
		}
	case string:
		if integer, err := strconv.ParseInt(typed, 10, 64); err == nil {
			return integer, nil
		}
	}

	return 0, errors.New("expected an integer within int64 range")
}

func coerceUint64(value any) (uint64, error) {
	switch typed := value.(type) {
	case json.Number:
		if integer, err := strconv.ParseUint(typed.String(), 10, 64); err == nil {
			return integer, nil
		}
	case int:
		if typed >= 0 {
			return uint64(typed), nil
		}
	case int64:
		if typed >= 0 {
			return uint64(typed), nil
		}
	case uint:
		return uint64(typed), nil
	case uint64:
		return typed, nil
	case float64:
		if typed >= 0 && typed <= math.MaxUint64 && math.Trunc(typed) == typed {
			return uint64(typed), nil
		}
	case string:
		if integer, err := strconv.ParseUint(typed, 10, 64); err == nil {
			return integer, nil
		}
	}

	return 0, errors.New("expected an integer within uint64 range")
}

func validateSemanticValue(value any, schema ValueSchema) (any, error) {
	coerced, err := coerceValue(value, schema.DataType)
	if err != nil {
		return nil, err
	}

	constraints := schema.Constraints
	if constraints.Minimum != nil || constraints.Maximum != nil || constraints.MultipleOf != nil {
		number, ok := numericValue(coerced)
		if !ok {
			return nil, errors.New("numeric constraints require a numeric data type")
		}
		if constraints.Minimum != nil {
			if constraints.ExclusiveMinimum && number <= *constraints.Minimum {
				return nil, fmt.Errorf("value must be greater than %v", *constraints.Minimum)
			}
			if !constraints.ExclusiveMinimum && number < *constraints.Minimum {
				return nil, fmt.Errorf("value must be at least %v", *constraints.Minimum)
			}
		}
		if constraints.Maximum != nil {
			if constraints.ExclusiveMaximum && number >= *constraints.Maximum {
				return nil, fmt.Errorf("value must be less than %v", *constraints.Maximum)
			}
			if !constraints.ExclusiveMaximum && number > *constraints.Maximum {
				return nil, fmt.Errorf("value must be at most %v", *constraints.Maximum)
			}
		}
		if constraints.MultipleOf != nil {
			quotient := number / *constraints.MultipleOf
			if math.Abs(quotient-math.Round(quotient)) > 1e-9 {
				return nil, fmt.Errorf("value must be a multiple of %v", *constraints.MultipleOf)
			}
		}
	}

	if constraints.MinLength != nil || constraints.MaxLength != nil || constraints.Pattern != nil {
		text, ok := coerced.(string)
		if !ok {
			return nil, errors.New("string constraints require a string-compatible data type")
		}
		if constraints.MinLength != nil && len([]rune(text)) < *constraints.MinLength {
			return nil, fmt.Errorf("value must contain at least %d characters", *constraints.MinLength)
		}
		if constraints.MaxLength != nil && len([]rune(text)) > *constraints.MaxLength {
			return nil, fmt.Errorf("value must contain at most %d characters", *constraints.MaxLength)
		}
		if constraints.Pattern != nil {
			pattern, err := regexp.Compile(*constraints.Pattern)
			if err != nil {
				return nil, fmt.Errorf("invalid constraint pattern: %w", err)
			}
			if !pattern.MatchString(text) {
				return nil, errors.New("value does not match the required pattern")
			}
		}
	}

	if len(constraints.AllowedValues) > 0 {
		allowed := false
		for _, candidate := range constraints.AllowedValues {
			if scalarEqual(coerced, candidate) {
				allowed = true
				break
			}
		}
		if !allowed {
			return nil, errors.New("value is not in the allowed set")
		}
	}

	return coerced, nil
}

func clampToSchema(value any, schema ValueSchema) (any, error) {
	number, ok := numericValue(value)
	if !ok {
		return nil, errors.New("clamp policy requires a numeric value")
	}
	if schema.Constraints.Minimum != nil && number < *schema.Constraints.Minimum {
		number = *schema.Constraints.Minimum
	}
	if schema.Constraints.Maximum != nil && number > *schema.Constraints.Maximum {
		number = *schema.Constraints.Maximum
	}

	return validateSemanticValue(number, schema)
}
