package app

import (
	"net/http"
	"net/http/httptest"
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

func TestHistoryRefusesABucketWidthItCannotServe(t *testing.T) {
	a := &Application{Control: &ControlClient{Token: "history-test-token"}}
	now := time.Now().UTC()
	for _, width := range []string{"0", "-60", "ten", "31622401", "60"} {
		query := url.Values{
			"organization_uuid": {"organization"}, "device_uuid": {"device"}, "parameter_uuid": {"parameter"},
			// A day at one-minute buckets is 1440 buckets, more than max_points.
			"from": {now.Add(-24 * time.Hour).Format(time.RFC3339)}, "to": {now.Format(time.RFC3339)},
			"retention_days": {"30"}, "max_points": {"500"}, "bucket_seconds": {width},
		}
		req := httptest.NewRequest(http.MethodGet, "/internal/measurements/history?"+query.Encode(), nil)
		req.Header.Set("Authorization", "Bearer history-test-token")
		response := httptest.NewRecorder()
		a.Handler().ServeHTTP(response, req)
		if response.Code != 422 {
			t.Fatalf("bucket_seconds=%s answered %d: %s", width, response.Code, response.Body.String())
		}
	}
}
