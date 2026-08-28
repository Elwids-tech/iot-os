package definition

import (
	"errors"
	"fmt"
	"strings"

	"github.com/ohler55/ojg/jp"
)

type pathStepKind uint8

const (
	pathChild pathStepKind = iota
	pathIndex
	pathWildcard
)

type pathStep struct {
	Kind  pathStepKind
	Child string
	Index int
}

type restrictedPath struct {
	Raw      string
	Steps    []pathStep
	Wildcard bool
}

func parseRestrictedPath(value string, allowFinalWildcard bool) (restrictedPath, error) {
	if len(value) == 0 || len(value) > 512 {
		return restrictedPath{}, errors.New("JSONPath length must be between 1 and 512 bytes")
	}

	expression, err := jp.ParseString(value)
	if err != nil {
		return restrictedPath{}, fmt.Errorf("parse JSONPath: %w", err)
	}

	if len(expression) == 0 {
		return restrictedPath{}, errors.New("JSONPath must begin at the root")
	}

	if _, ok := expression[0].(jp.Root); !ok {
		return restrictedPath{}, errors.New("JSONPath must begin with $")
	}

	parsed := restrictedPath{Raw: value, Steps: make([]pathStep, 0, len(expression)-1)}
	for index, fragment := range expression[1:] {
		switch typed := fragment.(type) {
		case jp.Child:
			parsed.Steps = append(parsed.Steps, pathStep{Kind: pathChild, Child: string(typed)})
		case jp.Nth:
			arrayIndex := int(typed)
			if arrayIndex < 0 {
				return restrictedPath{}, errors.New("negative array indexes are not supported")
			}

			parsed.Steps = append(parsed.Steps, pathStep{Kind: pathIndex, Index: arrayIndex})
		case jp.Wildcard:
			if !allowFinalWildcard || index != len(expression[1:])-1 || !strings.HasSuffix(value, "[*]") {
				return restrictedPath{}, errors.New("wildcard is allowed only as the final record selector segment")
			}

			parsed.Wildcard = true
			parsed.Steps = append(parsed.Steps, pathStep{Kind: pathWildcard})
		default:
			return restrictedPath{}, fmt.Errorf("JSONPath fragment %T is not supported", fragment)
		}
	}

	return parsed, nil
}

func (path restrictedPath) Get(source any) (any, bool) {
	current := source
	for _, step := range path.Steps {
		switch step.Kind {
		case pathChild:
			object, ok := current.(map[string]any)
			if !ok {
				return nil, false
			}

			current, ok = object[step.Child]
			if !ok {
				return nil, false
			}
		case pathIndex:
			array, ok := current.([]any)
			if !ok || step.Index >= len(array) {
				return nil, false
			}

			current = array[step.Index]
		case pathWildcard:
			array, ok := current.([]any)
			if !ok {
				return nil, false
			}

			return array, true
		}
	}

	return current, true
}

func (path restrictedPath) Set(target map[string]any, value any) error {
	if len(path.Steps) == 0 {
		return errors.New("placing a value at root $ is not supported")
	}

	_, err := setPathValue(target, path.Steps, value)

	return err
}

func setPathValue(current any, steps []pathStep, value any) (any, error) {
	step := steps[0]
	last := len(steps) == 1
	if step.Kind == pathWildcard {
		return nil, errors.New("wildcard placement is not supported")
	}

	switch step.Kind {
	case pathChild:
		object, ok := current.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("path segment %q requires an object", step.Child)
		}

		if last {
			object[step.Child] = value

			return object, nil
		}

		next, exists := object[step.Child]
		if !exists || next == nil {
			if steps[1].Kind == pathIndex {
				next = []any{}
			} else {
				next = map[string]any{}
			}
		}

		updated, err := setPathValue(next, steps[1:], value)
		if err != nil {
			return nil, err
		}
		object[step.Child] = updated

		return object, nil
	case pathIndex:
		array, ok := current.([]any)
		if !ok {
			return nil, fmt.Errorf("path index %d requires an array", step.Index)
		}

		for len(array) <= step.Index {
			array = append(array, nil)
		}

		if last {
			array[step.Index] = value

			return array, nil
		}

		next := array[step.Index]
		if next == nil {
			if steps[1].Kind == pathIndex {
				next = []any{}
			} else {
				next = map[string]any{}
			}
		}

		updated, err := setPathValue(next, steps[1:], value)
		if err != nil {
			return nil, err
		}
		array[step.Index] = updated

		return array, nil
	}

	return nil, errors.New("unsupported JSONPath placement fragment")
}

func scopedValue(reference PathRef, payload, record any) (any, bool, error) {
	path, err := parseRestrictedPath(reference.JSONPath, false)
	if err != nil {
		return nil, false, err
	}

	switch reference.Scope {
	case "payload":
		value, found := path.Get(payload)

		return value, found, nil
	case "record":
		value, found := path.Get(record)

		return value, found, nil
	default:
		return nil, false, fmt.Errorf("unsupported path scope %q", reference.Scope)
	}
}
