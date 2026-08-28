package definition

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"

	"github.com/gowebpki/jcs"
)

func decodeStrict(payload []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()

	if err := decoder.Decode(target); err != nil {
		return err
	}

	if decoder.More() {
		return errors.New("multiple JSON values are not allowed")
	}

	return nil
}

func canonicalBytes(value any) ([]byte, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("marshal canonical input: %w", err)
	}

	canonical, err := jcs.Transform(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize JSON: %w", err)
	}

	return canonical, nil
}

func canonicalHash(value any) (string, error) {
	canonical, err := canonicalBytes(value)
	if err != nil {
		return "", err
	}

	digest := sha256.Sum256(canonical)

	return hex.EncodeToString(digest[:]), nil
}

func canonicalEqual(left, right any) bool {
	leftBytes, leftErr := canonicalBytes(left)
	rightBytes, rightErr := canonicalBytes(right)

	return leftErr == nil && rightErr == nil && bytes.Equal(leftBytes, rightBytes)
}

func deepCopyMap(source map[string]any) (map[string]any, error) {
	payload, err := json.Marshal(source)
	if err != nil {
		return nil, err
	}

	var clone map[string]any
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	if err := decoder.Decode(&clone); err != nil {
		return nil, err
	}

	return clone, nil
}

func normalizeForCEL(value any) any {
	switch typed := value.(type) {
	case json.Number:
		if integer, err := typed.Int64(); err == nil {
			return integer
		}

		if decimal, err := typed.Float64(); err == nil {
			return decimal
		}
	case map[string]any:
		normalized := make(map[string]any, len(typed))
		for key, item := range typed {
			normalized[key] = normalizeForCEL(item)
		}

		return normalized
	case []any:
		normalized := make([]any, len(typed))
		for index, item := range typed {
			normalized[index] = normalizeForCEL(item)
		}

		return normalized
	}

	return value
}

func validateValueDepth(value any, depth int, nodes *int) error {
	if depth > 64 {
		return errors.New("JSON input exceeds maximum depth of 64")
	}

	*nodes++
	if *nodes > 100_000 {
		return errors.New("JSON input exceeds maximum node count of 100000")
	}

	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if len(key) > 1_024 {
				return errors.New("JSON object key exceeds 1024 bytes")
			}

			if err := validateValueDepth(child, depth+1, nodes); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := validateValueDepth(child, depth+1, nodes); err != nil {
				return err
			}
		}
	case string:
		if len(typed) > 1_048_576 {
			return errors.New("JSON string exceeds 1 MiB")
		}
	}

	return nil
}

func localKey(qualified string) string {
	parts := strings.Split(qualified, ".")

	return parts[len(parts)-1]
}

func numericValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, !math.IsNaN(typed) && !math.IsInf(typed, 0)
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	case json.Number:
		number, err := typed.Float64()

		return number, err == nil && !math.IsNaN(number) && !math.IsInf(number, 0)
	}

	return 0, false
}

func scalarEqual(left, right any) bool {
	if leftNumber, ok := numericValue(left); ok {
		rightNumber, rightOK := numericValue(right)

		return rightOK && leftNumber == rightNumber
	}

	return reflect.DeepEqual(left, right)
}
