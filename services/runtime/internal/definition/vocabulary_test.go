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

func TestSharedVocabularyMatchesCanonicalCommonSchema(t *testing.T) {
	t.Parallel()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve vocabulary test source path")
	}

	schemaPath := filepath.Join(
		filepath.Dir(sourceFile),
		"../../../../contracts/definitions/common/v1/schema.json",
	)
	payload, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("read canonical common schema: %v", err)
	}

	var schema commonSchema
	if err := json.Unmarshal(payload, &schema); err != nil {
		t.Fatalf("decode canonical common schema: %v", err)
	}

	schemaVocabulary := make(map[string][]string, len(definition.SharedVocabulary))
	for name := range definition.SharedVocabulary {
		schemaVocabulary[name] = schema.Definitions[name].Enum
	}

	if !reflect.DeepEqual(definition.SharedVocabulary, schemaVocabulary) {
		t.Fatalf(
			"Go vocabulary does not match canonical common schema\nGo: %#v\nSchema: %#v",
			definition.SharedVocabulary,
			schemaVocabulary,
		)
	}
}
