package sparkplug

import (
	"encoding/base64"
	"encoding/json"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"os"
	"testing"
	"time"
)

// This test consumes actual broker packets from the disposable Node-RED verification.
func TestLiveVendorAdapterCapture(t *testing.T) {
	file := os.Getenv("ADAPTER_CAPTURE_PATH")
	if file == "" {
		t.Skip("run services/adapters integration verification")
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var packets []struct {
		Topic   string `json:"topic"`
		Payload string `json:"payload_base64"`
	}
	if err = json.Unmarshal(raw, &packets); err != nil {
		t.Fatal(err)
	}
	engine := NewEngine()
	stored := false
	for _, packet := range packets {
		data, err := base64.StdEncoding.DecodeString(packet.Payload)
		if err != nil {
			t.Fatal(err)
		}
		got, err := engine.Accept("connection", packet.Topic, data, time.Now())
		if err != nil {
			t.Fatal(packet.Topic, err)
		}
		if got.Topic.Kind != "DDATA" {
			continue
		}
		d := devices.Definition{DeviceUUID: "stable-virtual-device", Adapter: &devices.AdapterBinding{InstallationUUID: "40000000-0000-4000-8000-000000000001", ManufacturerSerial: "WM-1042"}, Mappings: []devices.Mapping{{ParameterUUID: "flow", Metric: "flow_rate", Datatype: "Double", ConversionMode: "none"}, {ParameterUUID: "volume", Metric: "total_volume", Datatype: "Double", ConversionMode: "none"}}}
		p := devices.Profile{Parameters: []devices.Parameter{{UUID: "flow", Key: "flow_rate", Kind: "measurement", DataType: "number", ReportsState: true}, {UUID: "volume", Key: "total_volume", Kind: "measurement", DataType: "number", ReportsState: true}}}
		readings := devices.Readings(d, p, got.Metrics, map[string]devices.Reading{}, time.Now())
		if len(readings) != 2 || readings[0].Quality != "good" || readings[1].Quality != "good" {
			t.Fatal(readings)
		}
		flow, _ := devices.Number(readings[0].Value)
		volume, _ := devices.Number(readings[1].Value)
		if flow != 12 || volume != 8400 {
			t.Fatal(readings)
		}
		event := devices.ProjectCommitted(devices.Telemetry{Definition: d, Readings: readings})
		if event.DeviceUUID != "stable-virtual-device" || event.Readings[0].AdapterRevisionUUID != "20000000-0000-4000-8000-000000000001" {
			t.Fatal(event)
		}
		stored = true
	}
	if !stored {
		t.Fatal("no activated telemetry was received")
	}
}
