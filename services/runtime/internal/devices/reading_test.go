package devices

import (
	"encoding/json"
	"testing"
	"time"
)

func TestRetainedValueReceiptSurvivesSerialization(t *testing.T) {
	raw := []byte(`{"value":42,"quality":"invalid","received_at":"2026-09-09T12:05:00Z","last_valid_received_at":"2026-09-09T12:00:00Z"}`)
	var reading Reading
	if err := json.Unmarshal(raw, &reading); err != nil {
		t.Fatal(err)
	}
	expected, _ := time.Parse(time.RFC3339, "2026-09-09T12:00:00Z")
	if reading.LastValidReceivedAt == nil || !reading.LastValidReceivedAt.Equal(expected) {
		t.Fatal("retained receipt was lost")
	}
	encoded, err := json.Marshal(reading)
	if err != nil {
		t.Fatal(err)
	}
	var response map[string]any
	if err = json.Unmarshal(encoded, &response); err != nil {
		t.Fatal(err)
	}
	if response["last_valid_received_at"] != "2026-09-09T12:00:00Z" || response["received_at"] != "2026-09-09T12:05:00Z" {
		t.Fatalf("receipt timestamps conflated: %s", encoded)
	}
}
