package app

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
)

func TestHistoryCursorIsSignedAndBoundToTheRequest(t *testing.T) {
	query := url.Values{
		"organization_uuid": {"organization"},
		"device_uuid":       {"device"},
		"parameter_uuid":    {"parameter"},
		"from":              {"2026-09-12T00:00:00Z"},
		"to":                {"2026-09-12T01:00:00Z"},
	}
	scope := historyCursorScope(query, 500)
	cursor := &storage.HistoryCursor{
		At:        time.Date(2026, 9, 12, 0, 30, 0, 0, time.UTC),
		EventUUID: "11111111-1111-4111-8111-111111111111",
		Consumed:  50,
		Scope:     scope,
	}
	encoded := encodeHistoryCursor(cursor, "secret")
	decoded, err := decodeHistoryCursor(encoded, "secret")
	if err != nil || decoded.EventUUID != cursor.EventUUID || decoded.Consumed != 50 || decoded.Scope != scope {
		t.Fatalf("cursor did not round trip: %#v / %v", decoded, err)
	}
	if strings.Contains(encoded, cursor.EventUUID) {
		t.Fatal("cursor exposed its payload")
	}
	if _, err = decodeHistoryCursor(encoded, "different-secret"); err == nil {
		t.Fatal("cursor accepted a signature from another runtime")
	}

	parts := strings.Split(encoded, ".")
	if parts[1][0] == 'A' {
		parts[1] = "B" + parts[1][1:]
	} else {
		parts[1] = "A" + parts[1][1:]
	}
	if _, err = decodeHistoryCursor(strings.Join(parts, "."), "secret"); err == nil {
		t.Fatal("cursor signature accepted a modified token")
	}
	if historyCursorScope(query, 100) == scope {
		t.Fatal("cursor scope did not bind the selected total limit")
	}
	query.Set("parameter_uuid", "another-parameter")
	if historyCursorScope(query, 500) == scope {
		t.Fatal("cursor scope did not bind the selected parameter")
	}
}

func TestHistoryWindowClipsRetentionAndFutureRanges(t *testing.T) {
	now := time.Now().UTC()
	query := url.Values{
		"from":           {now.Add(-90 * 24 * time.Hour).Format(time.RFC3339)},
		"to":             {now.Add(24 * time.Hour).Format(time.RFC3339)},
		"retention_days": {"30"},
	}
	from, to, err := historyWindow(query)
	if err != nil {
		t.Fatal(err)
	}
	if from.Before(now.Add(-31*24*time.Hour)) || from.After(now.Add(-29*24*time.Hour)) {
		t.Fatalf("retention was not applied: %s", from)
	}
	if to.After(time.Now().UTC()) {
		t.Fatalf("future range was not clipped: %s", to)
	}
}
