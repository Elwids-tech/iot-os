package devices

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"strconv"
	"strings"
)

func Number(v any) (float64, bool) {
	switch n := v.(type) {
	case json.Number:
		f, e := n.Float64()
		return f, e == nil && !math.IsNaN(f) && !math.IsInf(f, 0)
	case float64:
		return n, !math.IsNaN(n) && !math.IsInf(n, 0)
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case uint64:
		return float64(n), true
	}
	return 0, false
}
func truth(v any) bool {
	if v == nil {
		return false
	}
	if b, ok := v.(bool); ok {
		return b
	}
	if n, ok := Number(v); ok {
		return n != 0
	}
	if s, ok := v.(string); ok {
		return s != ""
	}
	if a, ok := v.([]any); ok {
		return len(a) > 0
	}
	return true
}
func Equal(a, b any) bool {
	if x, ok := Number(a); ok {
		if y, ok := Number(b); ok {
			return x == y
		}
	}
	return reflect.DeepEqual(a, b)
}

// JSON numbers preserve PHP's integer/floating distinction for strict comparisons.
func integerType(v any) bool {
	switch n := v.(type) {
	case json.Number:
		return !strings.ContainsAny(string(n), ".eE")
	case int, int64, uint64:
		return true
	default:
		return false
	}
}
func strictEqual(a, b any) bool {
	if x, ok := Number(a); ok {
		if y, ok := Number(b); ok {
			return integerType(a) == integerType(b) && x == y
		}
	}
	return reflect.DeepEqual(a, b)
}
func ordered(a, b any) (int, error) {
	compare := func(x, y float64) int {
		if x < y {
			return -1
		}
		if x > y {
			return 1
		}
		return 0
	}
	if _, ok := a.(bool); ok {
		return compare(boolNumber(phpTruth(a)), boolNumber(phpTruth(b))), nil
	}
	if _, ok := b.(bool); ok {
		return compare(boolNumber(phpTruth(a)), boolNumber(phpTruth(b))), nil
	}
	if a == nil {
		if _, ok := b.(string); ok {
			a = ""
		} else {
			a = int(0)
		}
	}
	if b == nil {
		if _, ok := a.(string); ok {
			b = ""
		} else {
			b = int(0)
		}
	}
	if x, ok := numericString(a); ok {
		if y, ok := numericString(b); ok {
			return compare(x, y), nil
		}
	}
	_, astr := a.(string)
	_, bstr := b.(string)
	_, anum := Number(a)
	_, bnum := Number(b)
	if (astr || anum) && (bstr || bnum) {
		return strings.Compare(fmt.Sprint(a), fmt.Sprint(b)), nil
	}
	return 0, errors.New("ordered comparisons require scalar values")
}
func boolNumber(v bool) float64 {
	if v {
		return 1
	}
	return 0
}

func looseEqual(a, b any) bool {
	if _, ok := a.(bool); ok {
		return phpTruth(a) == phpTruth(b)
	}
	if _, ok := b.(bool); ok {
		return phpTruth(a) == phpTruth(b)
	}
	if a == nil || b == nil {
		other := a
		if a == nil {
			other = b
		}
		if other == nil {
			return true
		}
		if s, ok := other.(string); ok {
			return s == ""
		}
		return !phpTruth(other)
	}
	x, xok := numericString(a)
	y, yok := numericString(b)
	if xok && yok {
		return x == y
	}
	return reflect.DeepEqual(a, b)
}
func phpTruth(v any) bool {
	if s, ok := v.(string); ok {
		return s != "" && s != "0"
	}
	return truth(v)
}
func numericString(v any) (float64, bool) {
	if s, ok := v.(string); ok {
		f, e := strconv.ParseFloat(strings.TrimSpace(s), 64)
		return f, e == nil
	}
	return Number(v)
}

func Evaluate(expression any, context map[string]any) (any, error) {
	nodes := 0
	var eval func(any, int) (any, error)
	eval = func(node any, depth int) (any, error) {
		nodes++
		if nodes > 1000 || depth > 32 {
			return nil, errors.New("expression complexity limit exceeded")
		}
		object, ok := node.(map[string]any)
		if !ok {
			if list, ok := node.([]any); ok {
				result := make([]any, 0, len(list))
				for _, item := range list {
					v, e := eval(item, depth+1)
					if e != nil {
						return nil, e
					}
					result = append(result, v)
				}
				return result, nil
			}
			return node, nil
		}
		if len(object) != 1 {
			return nil, errors.New("expression must contain one operator")
		}
		var op string
		var operand any
		for k, v := range object {
			op, operand = k, v
		}
		if op == "var" {
			if list, ok := operand.([]any); ok && len(list) == 1 {
				operand = list[0]
			}
			name, ok := operand.(string)
			if !ok {
				return nil, errors.New("invalid variable")
			}
			v, ok := context[name]
			if !ok {
				return nil, fmt.Errorf("missing input %s", name)
			}
			return v, nil
		}
		input, ok := operand.([]any)
		if !ok {
			input = []any{operand}
		}
		min, max := 2, 2
		switch op {
		case "and", "or":
			min, max = 1, 100
		case "!":
			min, max = 1, 1
		case "+", "*":
			max = 100
		case "==", "===", "!=", "!==", ">", ">=", "<", "<=", "-", "/", "in":
		default:
			return nil, fmt.Errorf("unsupported operator %s", op)
		}
		if len(input) < min || len(input) > max {
			return nil, errors.New("invalid operator arity")
		}
		values := make([]any, len(input))
		for i, v := range input {
			r, e := eval(v, depth+1)
			if e != nil {
				return nil, e
			}
			values[i] = r
		}
		switch op {
		case "and":
			for _, v := range values {
				if !truth(v) {
					return false, nil
				}
			}
			return true, nil
		case "or":
			for _, v := range values {
				if truth(v) {
					return true, nil
				}
			}
			return false, nil
		case "!":
			return !truth(values[0]), nil
		case "==":
			return looseEqual(values[0], values[1]), nil
		case "!=":
			return !looseEqual(values[0], values[1]), nil
		case "===":
			return strictEqual(values[0], values[1]), nil
		case "!==":
			return !strictEqual(values[0], values[1]), nil
		case "in":
			if hay, ok := values[1].([]any); ok {
				for _, v := range hay {
					if strictEqual(values[0], v) {
						return true, nil
					}
				}
				return false, nil
			}
			a, aok := values[0].(string)
			b, bok := values[1].(string)
			return aok && bok && strings.Contains(b, a), nil
		}
		if op == ">" || op == ">=" || op == "<" || op == "<=" {
			comparison, e := ordered(values[0], values[1])
			if e != nil {
				return nil, e
			}
			switch op {
			case ">":
				return comparison > 0, nil
			case ">=":
				return comparison >= 0, nil
			case "<":
				return comparison < 0, nil
			default:
				return comparison <= 0, nil
			}
		}
		numbers := make([]float64, len(values))
		for i, v := range values {
			n, ok := Number(v)
			if !ok {
				return nil, errors.New("arithmetic and ordered comparison inputs must be numbers")
			}
			numbers[i] = n
		}
		a, b := numbers[0], numbers[1]
		var result float64
		switch op {
		case ">":
			return a > b, nil
		case ">=":
			return a >= b, nil
		case "<":
			return a < b, nil
		case "<=":
			return a <= b, nil
		case "+":
			for _, n := range numbers {
				result += n
			}
		case "-":
			result = a - b
		case "*":
			result = 1
			for _, n := range numbers {
				result *= n
			}
		case "/":
			if b == 0 {
				return nil, errors.New("division by zero")
			}
			result = a / b
		}
		if math.IsInf(result, 0) || math.IsNaN(result) {
			return nil, errors.New("non-finite result")
		}
		integral := true
		for _, value := range values {
			integral = integral && integerType(value)
		}
		if integral && math.Trunc(result) == result && math.Abs(result) <= 9007199254740991 {
			return json.Number(strconv.FormatInt(int64(result), 10)), nil
		}
		return result, nil
	}
	return eval(expression, 0)
}
