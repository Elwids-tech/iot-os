package telemetry

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func fixture(t *testing.T) (*Manager, *time.Time) {
	t.Helper()
	m := New()
	now := time.Now()
	m.now = func() time.Time { return now }
	device := "sensor"
	_, err := m.Start("capture", Scope{Organization: "org", Connection: "connection", Edge: "edge", SourceDevice: &device, Device: "device"}, 60)
	if err != nil {
		t.Fatal(err)
	}
	return m, &now
}
func TestTenantScopeAndSourceFiltering(t *testing.T) {
	m, _ := fixture(t)
	if _, ok := m.Get("other", "capture"); ok {
		t.Fatal("cross tenant read")
	}
	if err := m.Change("other", "capture", "stop"); err == nil {
		t.Fatal("cross tenant write")
	}
	for i, org := range []string{"other", "org"} {
		m.Record(org, "connection", "edge", Sample{ID: fmt.Sprint(i), SourceDevice: "sensor"})
	}
	m.Record("org", "connection", "edge", Sample{ID: "other-device", SourceDevice: "other"})
	m.Record("org", "connection", "edge", Sample{ID: "node-birth", SourceDevice: ""})
	s, _ := m.Get("org", "capture")
	if len(s.Samples) != 2 {
		t.Fatalf("scope leaked: %+v", s.Samples)
	}
}
func TestSuspensionExpiresStopsAndRejectsGatewayWideCapture(t *testing.T) {
	m, now := fixture(t)
	if err := m.Change("org", "capture", "suspend"); err != nil {
		t.Fatal(err)
	}
	if !m.Suspended("org", "device") || m.Suspended("other", "device") {
		t.Fatal("invalid suspension scope")
	}
	*now = now.Add(60 * time.Second)
	if m.Suspended("org", "device") {
		t.Fatal("suspension did not expire")
	}
	if m.Watching("org", "connection", "edge", "sensor") {
		t.Fatal("capture did not expire")
	}
	if err := m.Change("org", "capture", "suspend"); err == nil {
		t.Fatal("expired session suspended")
	}
	_, _ = m.Start("wide", Scope{Organization: "org", Connection: "connection", Edge: "edge"}, 60)
	if err := m.Change("org", "wide", "suspend"); err == nil {
		t.Fatal("gateway-wide suspension allowed")
	}
	*now = now.Add(31 * time.Minute)
	if _, ok := m.Get("org", "capture"); ok {
		t.Fatal("expired evidence retained")
	}
}
func TestBoundsAndCopiesAndPersistenceUpdates(t *testing.T) {
	m, _ := fixture(t)
	for i := 0; i < MaxSamples+3; i++ {
		m.Record("org", "connection", "edge", Sample{ID: fmt.Sprint(i), SourceDevice: "sensor", Outcomes: []Outcome{{Device: "device", Status: "pending"}}})
	}
	id := fmt.Sprint(MaxSamples + 2)
	s, _ := m.Get("org", "capture")
	if len(s.Samples) != MaxSamples || s.Dropped != 3 {
		t.Fatal("buffer unbounded")
	}
	s.Samples[0].Outcomes[0].Status = "tampered"
	m.Stored(id, "device", "stored", "")
	after, _ := m.Get("org", "capture")
	if after.Samples[0].Outcomes[0].Status == "tampered" || after.Samples[len(after.Samples)-1].Outcomes[0].Status != "stored" {
		t.Fatal("copy/correlation failed")
	}
	m.Record("org", "connection", "edge", Sample{ID: "huge", SourceDevice: "sensor", Wire: strings.Repeat("x", MaxSampleBytes)})
	after, _ = m.Get("org", "capture")
	if after.Dropped != 4 {
		t.Fatal("oversized packet not counted")
	}
	m.Update(id, func(s *Sample) { s.Diagnostic = strings.Repeat("x", MaxSampleBytes) })
	after, _ = m.Get("org", "capture")
	if after.Dropped != 5 || len(after.Samples) != MaxSamples-1 {
		t.Fatal("trace growth unbounded")
	}
}
func TestSessionLimitsAndConcurrentReaders(t *testing.T) {
	m, _ := fixture(t)
	for i := 0; i < 3; i++ {
		_, err := m.Start(fmt.Sprint(i), Scope{Organization: "org", Connection: "c", Edge: "e"}, 60)
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := m.Start("overflow", Scope{Organization: "org", Connection: "c", Edge: "e"}, 60); err == nil {
		t.Fatal("session limit missing")
	}
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := 0; n < 100; n++ {
				m.Record("org", "connection", "edge", Sample{ID: fmt.Sprint(n), SourceDevice: "sensor"})
				m.Get("org", "capture")
				m.List("org")
			}
		}()
	}
	wg.Wait()
}
