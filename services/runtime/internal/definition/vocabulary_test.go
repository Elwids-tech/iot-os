package definition_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/definition"
)

type commonSchema struct {
	Definitions map[string]struct {
		Enum []string `json:"enum"`
	} `json:"$defs"`
}

func TestSharedVocabularyMatchesCommonSchema(t *testing.T) {
	t.Parallel()

	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not locate vocabulary test file")
	}

	schemaPath := filepath.Clean(filepath.Join(
		filepath.Dir(filename),
		"../../../../contracts/definitions/common/v1/schema.json",
	))

	payload, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("read common schema: %v", err)
	}

	var schema commonSchema
	if err := json.Unmarshal(payload, &schema); err != nil {
		t.Fatalf("decode common schema: %v", err)
	}

	schemaVocabulary := make(map[string][]string)
	for name, item := range schema.Definitions {
		if len(item.Enum) > 0 {
			schemaVocabulary[name] = item.Enum
		}
	}

	if !reflect.DeepEqual(definition.SharedVocabulary, schemaVocabulary) {
		t.Fatalf("Go vocabulary does not match common schema\nGo: %#v\nSchema: %#v", definition.SharedVocabulary, schemaVocabulary)
	}
}

func TestSharedVocabularyV2MatchesCommonSchema(t *testing.T) {
	t.Parallel()

	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not locate vocabulary test file")
	}

	schemaPath := filepath.Clean(filepath.Join(
		filepath.Dir(filename),
		"../../../../contracts/definitions/common/v2/schema.json",
	))

	payload, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("read common v2 schema: %v", err)
	}

	var schema commonSchema
	if err := json.Unmarshal(payload, &schema); err != nil {
		t.Fatalf("decode common v2 schema: %v", err)
	}

	schemaVocabulary := make(map[string][]string)
	for name, item := range schema.Definitions {
		if len(item.Enum) > 0 {
			schemaVocabulary[name] = item.Enum
		}
	}

	if !reflect.DeepEqual(definition.SharedVocabularyV2, schemaVocabulary) {
		t.Fatalf("Go v2 vocabulary does not match common schema\nGo: %#v\nSchema: %#v", definition.SharedVocabularyV2, schemaVocabulary)
	}
}
