package app

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug"
	"google.golang.org/protobuf/proto"
)

// The embedded SDK decodes these with its own reader (firmware/sdk/tests/test_commands.c),
// so the bytes come from the runtime's real command encoding at a fixed time.
// Regenerate with: go test ./internal/app/ -run TestSDKCommandFixtures -update
var updateSDKFixtures = flag.Bool("update", false, "rewrite contracts/sparkplug/fixtures/sdk/commands")

const sdkFixtureTime = 1712345000000

func TestSDKCommandFixtures(t *testing.T) {
	at := time.UnixMilli(sdkFixtureTime)
	dir := filepath.Join("..", "..", "..", "..", "contracts", "sparkplug", "fixtures", "sdk", "commands")
	command := func(name, datatype string, value any) []byte {
		t.Helper()
		metric, err := sparkplug.EncodeMetric(name, datatype, value)
		if err != nil {
			t.Fatal(err)
		}
		metric.Timestamp = proto.Uint64(sdkFixtureTime)
		raw, err := commandPayload(metric, at)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	fixtures := map[string][]byte{
		"ncmd-rebirth.bin": rebirthPayload(at),
		"dcmd-bool.bin":    command("on", "Boolean", true),
		"dcmd-double.bin":  command("scale", "Double", 0.75),
		"dcmd-string.bin":  command("mode", "String", "eco"),
	}
	if *updateSDKFixtures {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for name, raw := range fixtures {
		path := filepath.Join(dir, name)
		if *updateSDKFixtures {
			if err := os.WriteFile(path, raw, 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		committed, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("%s: %v (regenerate with -update)", name, err)
		}
		if !bytes.Equal(committed, raw) {
			t.Fatalf("%s no longer matches the runtime's command encoding (regenerate with -update and rerun the SDK tests)", name)
		}
	}
}
