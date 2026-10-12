package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/committedconsumer"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/contracts"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/contracts/contractstest"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
)

// Consumer tests for the contracts spec 002 PR 3 corrected (T038, constitution IV):
// every example a consumer must accept (the fixture, valid cases and tolerant-valid
// cases) goes through the runtime's real decoders and is handled as today.

const (
	driftActivation    = "devices/v1/activation.schema.json"
	driftCommand       = "devices/v1/command.schema.json"
	driftConfiguration = "devices/v1/configuration.schema.json"
	driftConfigV2      = "devices/v2/configuration.schema.json"
	driftTelemetry     = "devices/v1/telemetry.schema.json"
	driftCommitted     = "events/v1/telemetry-committed.schema.json"
)

// consumable returns the examples a tolerant consumer must accept.
func consumable(t *testing.T, schema string) []contractstest.Case {
	t.Helper()
	var accepted []contractstest.Case
	for _, example := range contractstest.Cases(t, schema) {
		if example.Accepted(contracts.Tolerant) {
			accepted = append(accepted, example)
		}
	}
	if len(accepted) < 2 {
		t.Fatalf("%s: expected the fixture and at least one more accepted case, got %d", schema, len(accepted))
	}
	return accepted
}

func decoded(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var value map[string]any
	if err := storage.Decode(raw, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

// Device configurations (v1 and v2, with and without an adapter binding) decode into
// devices.Definition and pass devices.ParseProfile, as activation and the snapshot
// read them; an absent conversion_mode or ingress_conversion reads as profile and
// null.
func TestDriftedConfigurationsDecodeAndParseAsToday(t *testing.T) {
	for _, schema := range []string{driftConfiguration, driftConfigV2} {
		for _, example := range consumable(t, schema) {
			t.Run(schema+" "+example.Name, func(t *testing.T) {
				var d devices.Definition
				if err := storage.Decode(example.Data, &d); err != nil {
					t.Fatal(err)
				}
				if _, err := devices.ParseProfile(d); err != nil {
					t.Fatalf("ParseProfile: %v", err)
				}
				checkDefinition(t, decoded(t, example.Data), d)
			})
		}
	}
}

// checkDefinition compares what the runtime decoded with the example's JSON.
func checkDefinition(t *testing.T, raw map[string]any, d devices.Definition) {
	t.Helper()
	if d.SchemaVersion != raw["schema_version"] || d.DeviceUUID != raw["device_uuid"] || d.ConfigurationUUID != raw["configuration_uuid"] {
		t.Fatalf("identity not decoded: %+v", d)
	}
	if adapter, ok := raw["adapter"].(map[string]any); ok {
		if d.Adapter == nil || d.Adapter.InstallationUUID != adapter["installation_uuid"] || d.Adapter.AdapterUUID != adapter["adapter_uuid"] || d.Adapter.ManufacturerSerial != adapter["manufacturer_serial"] {
			t.Fatalf("adapter binding not decoded: %+v", d.Adapter)
		}
	} else if d.Adapter != nil {
		t.Fatalf("native device acquired an adapter binding: %+v", d.Adapter)
	}
	mappings, _ := raw["mappings"].([]any)
	if len(d.Mappings) != len(mappings) {
		t.Fatalf("decoded %d of %d mappings", len(d.Mappings), len(mappings))
	}
	for index, item := range mappings {
		mapping := item.(map[string]any)
		mode, _ := mapping["conversion_mode"].(string)
		if d.Mappings[index].ConversionMode != mode {
			t.Fatalf("mapping %d conversion mode %q, want %q", index, d.Mappings[index].ConversionMode, mode)
		}
		if conversion, _ := mapping["ingress_conversion"].(map[string]any); (conversion == nil) != (d.Mappings[index].IngressConversion == nil) {
			t.Fatalf("mapping %d ingress conversion decoded as %+v", index, d.Mappings[index].IngressConversion)
		}
	}
}

// The internal telemetry message decodes as devices-storage decodes it, keeping the
// fences, the capture, the provenance and the counter events, and storage projects
// it into a committed event that conforms to telemetry.committed.v1.
func TestDriftedTelemetryDecodesAndProjectsAsToday(t *testing.T) {
	for _, example := range consumable(t, driftTelemetry) {
		t.Run(example.Name, func(t *testing.T) {
			telemetry := decodeTelemetry(t, example.Data)
			event := devices.ProjectCommitted(telemetry)
			event.Sequence = "1"
			contractstest.AssertProduced(t, driftCommitted, event)
			for index, r := range telemetry.Readings {
				if event.Readings[index].InstallationUUID != r.InstallationUUID || event.Readings[index].AdapterRevisionUUID != r.AdapterRevisionUUID || event.Readings[index].ManufacturerSerial != r.ManufacturerSerial {
					t.Fatalf("reading %d provenance lost in projection", index)
				}
			}
		})
	}
}

func decodeTelemetry(t *testing.T, raw []byte) devices.Telemetry {
	t.Helper()
	var telemetry devices.Telemetry
	if err := storage.Decode(raw, &telemetry); err != nil {
		t.Fatal(err)
	}
	value := decoded(t, raw)
	if generation, _ := value["generation"].(json.Number).Int64(); telemetry.Generation != int(generation) || telemetry.Generation < 1 {
		t.Fatalf("generation %d not decoded", telemetry.Generation)
	}
	if capture, _ := value["capture_id"].(string); telemetry.CaptureID != capture {
		t.Fatalf("capture id %q, want %q", telemetry.CaptureID, capture)
	}
	if _, err := devices.ParseProfile(telemetry.Definition); err != nil {
		t.Fatalf("ParseProfile: %v", err)
	}
	checkDefinition(t, value["definition"].(map[string]any), telemetry.Definition)
	readings := value["readings"].([]any)
	if len(telemetry.Readings) != len(readings) {
		t.Fatalf("decoded %d of %d readings", len(telemetry.Readings), len(readings))
	}
	for index, item := range readings {
		reading := item.(map[string]any)
		r := telemetry.Readings[index]
		for field, got := range map[string]string{"installation_uuid": r.InstallationUUID, "adapter_revision_uuid": r.AdapterRevisionUUID, "manufacturer_serial": r.ManufacturerSerial, "counter_event": r.CounterEvent, "data_type": r.DataType} {
			if want, _ := reading[field].(string); got != want {
				t.Fatalf("reading %d %s %q, want %q", index, field, got, want)
			}
		}
		if _, set := reading["last_valid_received_at"]; set != (r.LastValidReceivedAt != nil) {
			t.Fatalf("reading %d last_valid_received_at not decoded", index)
		}
	}
	return telemetry
}

// Committed events decode as the workflow evaluator (rule_consumer.go) and the
// example consumer (cmd/committed-consumer) decode them, and the example
// consumer's checkpoint applies and keeps them, provenance included.
func TestDriftedCommittedTelemetryIsConsumedAsToday(t *testing.T) {
	for _, example := range consumable(t, driftCommitted) {
		t.Run(example.Name, func(t *testing.T) {
			var event devices.CommittedTelemetry
			if err := storage.Decode(example.Data, &event); err != nil {
				t.Fatalf("decode (a failure dead-letters the message): %v", err)
			}
			readings := decoded(t, example.Data)["readings"].([]any)
			for index, item := range readings {
				reading := item.(map[string]any)
				r := event.Readings[index]
				for field, got := range map[string]string{"installation_uuid": r.InstallationUUID, "adapter_revision_uuid": r.AdapterRevisionUUID, "manufacturer_serial": r.ManufacturerSerial} {
					if want, _ := reading[field].(string); got != want {
						t.Fatalf("reading %d %s %q, want %q", index, field, got, want)
					}
				}
			}
			path := filepath.Join(t.TempDir(), "checkpoint.json")
			checkpoint, err := committedconsumer.Open(path, "drift", "stream-created")
			if err != nil {
				t.Fatal(err)
			}
			fresh, err := checkpoint.Apply(event, 1)
			checkpoint.Close()
			if err != nil || !fresh {
				t.Fatalf("checkpoint apply: fresh %v, %v", fresh, err)
			}
			reopened, err := committedconsumer.Open(path, "drift", "stream-created")
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			kept, err := json.Marshal(reopened.State.Events[event.EventID])
			if err != nil {
				t.Fatal(err)
			}
			original, _ := json.Marshal(event)
			if string(kept) != string(original) {
				t.Fatalf("checkpoint kept %s, want %s", kept, original)
			}
		})
	}
}

// The command payload decodes into devices.Command as handleControl decodes it; a
// null session reads as an empty session.
func TestDriftedCommandsDecodeAsToday(t *testing.T) {
	for _, example := range consumable(t, driftCommand) {
		t.Run(example.Name, func(t *testing.T) {
			var command devices.Command
			if err := storage.Decode(example.Data, &command); err != nil {
				t.Fatal(err)
			}
			value := decoded(t, example.Data)
			if generation, _ := value["generation"].(json.Number).Int64(); command.Generation != int(generation) || command.Generation < 1 {
				t.Fatalf("generation %d not decoded", command.Generation)
			}
			if session, _ := value["session_id"].(string); command.SessionID != session {
				t.Fatalf("session %q, want %q", command.SessionID, session)
			}
		})
	}
}

// driftApplication is a runtime with storage and an empty Sparkplug engine, so every
// source is offline, as lifecycle_test.go builds it.
func driftApplication(t *testing.T) *Application {
	t.Helper()
	url := os.Getenv("DEVICE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires disposable runtime database")
	}
	if !strings.Contains(url, "/iot_devices_test?") {
		t.Fatal("refusing non-test database")
	}
	ctx := context.Background()
	store, err := storage.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Pool.Close)
	return &Application{ctx: ctx, Store: store, Engine: sparkplug.NewEngine(), definitions: map[string]devices.Definition{}, generations: map[string]int{},
		latest: map[string]map[string]devices.Reading{}, sessions: map[string]string{}, compatible: map[string]bool{}, reviewRequired: map[string]bool{},
		presenceAt: map[string]time.Time{}, pending: map[string]*pendingCommand{}, brokers: map[string]*broker{}}
}

func purgeDevice(t *testing.T, store *storage.Store, device string) {
	t.Helper()
	ctx := context.Background()
	for _, statement := range []string{
		"DELETE FROM device_runtime.commands WHERE device_uuid=$1",
		"DELETE FROM device_runtime.telemetry_outbox WHERE event->>'device_uuid'=$1",
		"DELETE FROM device_runtime.observations WHERE device_uuid=$1",
		"DELETE FROM device_runtime.diagnostics WHERE device_uuid=$1",
		"DELETE FROM device_runtime.latest WHERE device_uuid=$1",
		"DELETE FROM device_runtime.devices WHERE device_uuid=$1",
		"DELETE FROM device_runtime.outbox WHERE event->'payload'->>'device_uuid'=$1",
	} {
		if _, err := store.Pool.Exec(ctx, statement, device); err != nil {
			t.Fatal(err)
		}
	}
}

// Every accepted activation goes through the devices-control path: the message
// decodes into devices.Event and handleControl decodes definition, generation and
// operation_uuid. The source is offline, so the runtime records a failed transition
// for that generation and operation, as it does today.
func TestDriftedActivationsAreHandledAsToday(t *testing.T) {
	a := driftApplication(t)
	for _, example := range consumable(t, driftActivation) {
		t.Run(example.Name, func(t *testing.T) {
			var ev devices.Event
			if err := storage.Decode(example.Data, &ev); err != nil {
				t.Fatal(err)
			}
			payload := decoded(t, ev.Payload)
			definition := payload["definition"].(map[string]any)
			device := definition["device_uuid"].(string)
			generation, _ := payload["generation"].(json.Number).Int64()
			lease, _ := decoded(t, example.Data)["lease_token"].(string)
			if ev.Type != "device.activate.v1" || ev.LeaseToken != lease {
				t.Fatalf("event decoded as %s with lease %q", ev.Type, ev.LeaseToken)
			}
			purgeDevice(t, a.Store, device)
			t.Cleanup(func() { purgeDevice(t, a.Store, device) })
			delete(a.generations, device)

			if err := a.handleControl(ev); err != nil {
				t.Fatalf("handleControl: %v", err)
			}
			if a.generations[device] != int(generation) {
				t.Fatalf("runtime generation %d, want %d", a.generations[device], generation)
			}
			var stored int
			var outcome []byte
			if err := a.Store.Pool.QueryRow(a.ctx, "SELECT generation, outcome FROM device_runtime.devices WHERE device_uuid=$1", device).Scan(&stored, &outcome); err != nil {
				t.Fatal(err)
			}
			var recorded struct {
				Type    string `json:"type"`
				Payload struct {
					OrganizationUUID  string `json:"organization_uuid"`
					ConfigurationUUID string `json:"configuration_uuid"`
					OperationUUID     string `json:"operation_uuid"`
				} `json:"payload"`
			}
			if err := json.Unmarshal(outcome, &recorded); err != nil {
				t.Fatal(err)
			}
			if stored != int(generation) || recorded.Type != "device.failed.v1" || recorded.Payload.OperationUUID != payload["operation_uuid"] ||
				recorded.Payload.OrganizationUUID != definition["organization_uuid"] || recorded.Payload.ConfigurationUUID != definition["configuration_uuid"] {
				t.Fatalf("recorded generation %d outcome %s", stored, outcome)
			}
		})
	}
}

// Every accepted command payload goes through the devices-control path for a device
// active at the command's generation. Every example expired before today, so the
// runtime records it as timed out (a generation it failed to decode would cancel it).
func TestDriftedCommandsAreHandledAsToday(t *testing.T) {
	a := driftApplication(t)
	for _, example := range consumable(t, driftCommand) {
		t.Run(example.Name, func(t *testing.T) {
			payload := decoded(t, example.Data)
			device, command := payload["device_uuid"].(string), payload["command_uuid"].(string)
			generation, _ := payload["generation"].(json.Number).Int64()
			expires, err := time.Parse(time.RFC3339, payload["expires_at"].(string))
			if err != nil || expires.After(time.Now()) {
				t.Fatalf("this test needs an expired example: %v %v", expires, err)
			}
			raw, err := json.Marshal(devices.Event{UUID: storage.UUID(), Type: "device.command.v1", Payload: example.Data})
			if err != nil {
				t.Fatal(err)
			}
			var ev devices.Event
			if err = storage.Decode(raw, &ev); err != nil {
				t.Fatal(err)
			}
			purgeDevice(t, a.Store, device)
			t.Cleanup(func() { purgeDevice(t, a.Store, device) })
			a.definitions[device] = devices.Definition{DeviceUUID: device, OrganizationUUID: payload["organization_uuid"].(string), ConfigurationUUID: payload["configuration_uuid"].(string)}
			a.generations[device] = int(generation)

			if err = a.handleControl(ev); err != nil {
				t.Fatalf("handleControl: %v", err)
			}
			var status, diagnostic string
			if err = a.Store.Pool.QueryRow(a.ctx, "SELECT status, diagnostic FROM device_runtime.commands WHERE command_uuid=$1", command).Scan(&status, &diagnostic); err != nil {
				t.Fatal(err)
			}
			if status != "timed_out" {
				t.Fatalf("command %s (%s), want timed_out", status, diagnostic)
			}
		})
	}
}

// Every accepted internal telemetry message is stored by storage for a device active
// at its generation and configuration, and the committed event storage writes
// conforms to telemetry.committed.v1.
func TestDriftedTelemetryIsStoredAsToday(t *testing.T) {
	a := driftApplication(t)
	for _, example := range consumable(t, driftTelemetry) {
		t.Run(example.Name, func(t *testing.T) {
			telemetry := decodeTelemetry(t, example.Data)
			device := telemetry.Definition.DeviceUUID
			purgeDevice(t, a.Store, device)
			t.Cleanup(func() { purgeDevice(t, a.Store, device) })
			if err := a.Store.Apply(a.ctx, telemetry.Definition, telemetry.Generation, "device.applied.v1"); err != nil {
				t.Fatal(err)
			}

			stored, err := a.Store.PersistResult(a.ctx, telemetry)
			if err != nil || !stored {
				t.Fatalf("persist: stored %v, %v", stored, err)
			}
			var raw []byte
			var sequence int64
			if err = a.Store.Pool.QueryRow(a.ctx, "SELECT sequence, event FROM device_runtime.telemetry_outbox WHERE telemetry_uuid=$1", telemetry.UUID).Scan(&sequence, &raw); err != nil {
				t.Fatal(err)
			}
			var event devices.CommittedTelemetry
			if err = storage.Decode(raw, &event); err != nil {
				t.Fatal(err)
			}
			event.Sequence = strconv.FormatInt(sequence, 10) // as the relay sets it (storage.CommittedPending)
			contractstest.AssertProduced(t, driftCommitted, event)
			var rows int
			if err = a.Store.Pool.QueryRow(a.ctx, "SELECT (SELECT count(*) FROM device_runtime.observations WHERE event_uuid=$1) + (SELECT count(*) FROM device_runtime.diagnostics WHERE event_uuid=$1)", telemetry.UUID).Scan(&rows); err != nil {
				t.Fatal(err)
			}
			if rows != len(telemetry.Readings) {
				t.Fatalf("stored %d of %d readings", rows, len(telemetry.Readings))
			}
		})
	}
}
